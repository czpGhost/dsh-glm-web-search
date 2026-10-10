import { Buffer } from 'node:buffer';
import { TokenStore } from '../auth/token-store.js';
import { TOKEN_TTL_MS, fetchBilling } from '../account/billing-reader.js';
import { ZCODE_DEFAULT_ORIGIN } from '../gateway/protocol-constants.js';
import { awaitLogin, initLogin } from '../account/oauth-login.js';
import { openBrowser } from '../auth/browser-launcher.js';
import { checkAuthorizeUrl, looksTruncated } from '../auth/url-integrity.js';
import {
  countdown,
  loginView,
  logoutView,
  statusSummary,
  statusView,
} from '../ui/status-format.js';

export const LOGIN_COMMAND_NAME = 'dsh-glm-web-search';
export const PLUGIN_COMMAND_PREFIX = 'dsh-glm-';

const USAGE = 'Usage: /dsh-glm-web-search [login|logout|status]';

const ACTIONS = ['login', 'logout', 'status'];

const INLINE_WAIT_MS = 25_000;

const logins = new Map();

function success(summaryLine, detail) {
  return { kind: 'success', text: detail ? `${summaryLine}\n\n${detail}` : summaryLine };
}

function failure(summaryLine, detail) {
  return { kind: 'error', text: detail ? `${summaryLine}\n\n${detail}` : summaryLine };
}

export function parseCommandInput(rawInput) {
  const input = String(rawInput ?? '').trim();
  if (input.length === 0) return { action: 'status' };
  const action = input.toLowerCase();
  if (ACTIONS.includes(action)) return { action };
  return { action: 'unknown', input };
}

function tokenIssuedAt(token) {
  try {
    const [, payload] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(claims.iat) ? claims.iat * 1000 : undefined;
  } catch {
    return undefined;
  }
}

async function gatherStatus(store, options) {
  const token = store.read();
  const described = store.describe();
  const issuedAt = token ? tokenIssuedAt(token) : undefined;
  const tokenExpiresAt = issuedAt === undefined ? undefined : issuedAt + TOKEN_TTL_MS;

  const state = {
    configured: token !== undefined,
    email: described.email,
    source: described.source,
    issuedAt,
    tokenExpiresAt,
    tokenExpired: tokenExpiresAt !== undefined ? Date.now() > tokenExpiresAt : false,
  };

  let billing;
  let error;

  if (token) {
    try {
      billing = await fetchBilling({
        token,
        origin: options.origin,
        appVersion: options.appVersion,
        deviceMid: store.deviceMid(),
        signal: options.signal,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
    } catch (caught) {
      if (caught?.code === 'ZAI_UNAUTHENTICATED') {
        state.tokenExpired = true;
        state.tokenRejected = true;
      }
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  return { state, billing, error };
}

async function runStatus(store, options) {
  const gathered = await gatherStatus(store, options);
  return success(statusSummary(gathered), statusView(gathered));
}

function pollInBackground(flow, entry, store, origin) {
  const task = awaitLogin(flow, { origin })
    .then((result) => {
      store.save({ jwt: result.jwt, email: result.email, userId: result.userId });
      entry.state = 'authorized';
      entry.email = result.email;
    })
    .catch((error) => {
      entry.state = 'failed';
      entry.error = error instanceof Error ? error.message : String(error);
    });
  entry.task = task;
  return task;
}

async function runLogin(store, origin, invocation, deps) {
  const flow = await initLogin({ origin, fetchImpl: deps.fetchImpl });

  const integrity = checkAuthorizeUrl(flow.authorizeUrl);
  if (!integrity.ok) {
    const cause = looksTruncated(flow.authorizeUrl)
      ? 'the URL was truncated at its first "&"'
      : 'the URL was built without every required parameter';
    return failure(
      'login URL is incomplete',
      [
        `The authorization URL is missing: ${integrity.missing.join(', ')}`,
        `Cause: ${cause}.`,
        '',
        'If this process started before the plugin was last updated it is running older',
        'code — restart DSH and try again.',
      ].join('\n'),
    );
  }

  const entry = { state: 'pending', startedAt: Date.now() };
  logins.set(LOGIN_COMMAND_NAME, entry);

  const opened = await openBrowser(flow.authorizeUrl, deps);
  const task = pollInBackground(flow, entry, store, origin);

  await Promise.race([
    task,
    new Promise((resolve) => setTimeout(resolve, INLINE_WAIT_MS)),
  ]);

  if (entry.state === 'authorized') {
    return success(
      entry.email ? `signed in · ${entry.email}` : 'signed in',
      [
        `account  ${entry.email ?? '(unknown)'}`,
        '',
        'web_search, web_fetch and zai_vision are ready.',
      ].join('\n'),
    );
  }

  if (entry.state === 'failed') {
    return failure('login failed', `Login failed: ${entry.error}`);
  }

  const remaining = flow.expiresAt - Date.now();
  return success(
    opened
      ? `waiting for approval · ${countdown(remaining)} left`
      : 'approve the login in your browser',
    loginView({ flow, opened }),
  );
}

function runLogout(store) {
  const before = store.describe();
  store.clear();
  const entry = logins.get(LOGIN_COMMAND_NAME);
  if (entry?.state === 'pending') entry.state = 'cancelled';
  logins.delete(LOGIN_COMMAND_NAME);

  return success(
    before.configured ? 'signed out' : 'not signed in',
    logoutView({ configured: before.configured, source: before.source }),
  );
}

export function registerLoginCommand(ctx, options) {
  const { store } = options;
  const origin = options.origin ?? ZCODE_DEFAULT_ORIGIN;
  const deps = {
    fetchImpl: options.fetchImpl,
    spawnImpl: options.spawnImpl,
    platform: options.platform,
  };
  const statusOptions = {
    client: options.client,
    resolveToken: options.resolveToken,
    origin,
    appVersion: options.appVersion,
    fetchImpl: options.fetchImpl,
  };

  const runAction = async (action, invocation) => {
    try {
      switch (action) {
        case 'login':
          return await runLogin(store, origin, invocation, deps);
        case 'logout':
          return runLogout(store);
        case 'status':
          return await runStatus(store, { ...statusOptions, signal: invocation.signal });
        default:
          return failure(
            `unknown subcommand "${action}"`,
            `Unknown subcommand "${action}".\n${USAGE}`,
          );
      }
    } catch (error) {
      return failure(
        'command failed',
        `${error instanceof Error ? error.message : String(error)}\n${USAGE}`,
      );
    }
  };

  const disposers = [];
  const register = (definition) => {
    const dispose = ctx.commands.register(definition);
    if (typeof dispose === 'function') disposers.push(dispose);
  };

  register({
    name: LOGIN_COMMAND_NAME,
    description: 'Sign in to Z.AI, sign out, or show the token and quota status',
    input: { hint: `[${ACTIONS.join('|')}]` },
    async handler(invocation) {
      const parsed = parseCommandInput(invocation.rawInput);
      return runAction(parsed.action === 'unknown' ? parsed.input : parsed.action, invocation);
    },
  });

  for (const [suffix, action, summary] of [
    ['login', 'login', 'Sign in to Z.AI with your email account'],
    ['logout', 'logout', 'Forget the stored Z.AI credential'],
    ['status', 'status', 'Show Z.AI token, plan, quota and refill cycle'],
  ]) {
    register({
      name: `${PLUGIN_COMMAND_PREFIX}${suffix}`,
      description: summary,
      async handler(invocation) {
        return runAction(action, invocation);
      },
    });
  }

  return () => {
    for (const dispose of disposers) dispose();
  };
}

export { USAGE as LOGIN_COMMAND_USAGE, TokenStore, TOKEN_TTL_MS };
