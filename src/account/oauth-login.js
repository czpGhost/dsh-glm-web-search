import { randomBytes } from 'node:crypto';
import { ZCODE_OAUTH_CLIENT_ID } from '../gateway/protocol-constants.js';

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 15_000;
export const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;

export class LoginError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'LoginError';
    this.code = options.code ?? 'LOGIN_FAILED';
  }
}

function normalizeOrigin(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new LoginError(`${label} must be an absolute URL`, { code: 'INVALID_ORIGIN' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LoginError(`${label} must use HTTP or HTTPS`, { code: 'INVALID_ORIGIN' });
  }
  return url.origin;
}

export async function initLogin(options = {}) {
  const {
    origin = 'https://zcode.z.ai',
    fetchImpl = globalThis.fetch,
    timeoutMs = 30_000,
  } = options;

  const base = normalizeOrigin(origin, 'origin');
  const state = randomBytes(32).toString('hex');

  let response;
  try {
    response = await fetchImpl(`${base}/api/v1/oauth/cli/init`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${state}`,
      },
      body: JSON.stringify({ provider: 'zai' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new LoginError(`could not reach the Z.AI login endpoint: ${message(error)}`, {
      code: 'LOGIN_UNREACHABLE',
      cause: error,
    });
  }

  const payload = await readJson(response);
  const data = payload?.data;
  if (!response.ok || payload?.code !== 0 || !data?.flow_id || !data?.authorize_url) {
    throw new LoginError(
      payload?.msg || `login init failed (HTTP ${response.status})`,
      { code: 'LOGIN_INIT_FAILED' },
    );
  }

  const authorizeUrl = String(data.authorize_url);
  if (!authorizeUrl.includes(ZCODE_OAUTH_CLIENT_ID)) {
    throw new LoginError('authorize URL is missing the expected OAuth client id', {
      code: 'LOGIN_INIT_FAILED',
    });
  }

  return {
    flowId: String(data.flow_id),
    pollToken: String(data.poll_token ?? state),
    authorizeUrl,
    pollIntervalMs:
      Number.isFinite(data.poll_interval_sec) && data.poll_interval_sec > 0
        ? data.poll_interval_sec * 1000
        : DEFAULT_POLL_INTERVAL_MS,
    expiresAt:
      Number.isFinite(data.expires_at) && data.expires_at > 0
        ? data.expires_at * 1000
        : Date.now() + DEFAULT_LOGIN_TIMEOUT_MS,
  };
}

async function pollOnce(flow, options) {
  const { base, fetchImpl, pollTimeoutMs } = options;
  let response;
  try {
    response = await fetchImpl(
      `${base}/api/v1/oauth/cli/poll/${encodeURIComponent(flow.flowId)}`,
      {
        headers: { accept: 'application/json', authorization: `Bearer ${flow.pollToken}` },
        signal: AbortSignal.timeout(pollTimeoutMs),
      },
    );
  } catch {
    return { phase: 'pending' };
  }

  const payload = await readJson(response);
  if (payload?.code !== 0) return { phase: 'pending' };

  const status = payload?.data?.status;
  if (status === 'failed' || status === 'denied') {
    return { phase: 'failed', message: payload.msg || 'authorization was rejected' };
  }
  if (status !== 'ready') return { phase: 'pending' };

  const jwt = String(payload?.data?.token ?? '').trim();
  if (jwt.length === 0) return { phase: 'pending' };

  return {
    phase: 'ready',
    jwt,
    userId: payload?.data?.user?.user_id,
    name: payload?.data?.user?.name,
    email: payload?.data?.user?.email,
  };
}

export async function awaitLogin(flow, options = {}) {
  const {
    origin = 'https://zcode.z.ai',
    fetchImpl = globalThis.fetch,
    signal,
    pollTimeoutMs = POLL_TIMEOUT_MS,
    onTick,
  } = options;

  const base = normalizeOrigin(origin, 'origin');
  const deadline = Math.min(
    flow.expiresAt,
    Date.now() + (options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS),
  );

  for (;;) {
    if (signal?.aborted) throw new LoginError('login was cancelled', { code: 'LOGIN_CANCELLED' });

    const outcome = await pollOnce(flow, { base, fetchImpl, pollTimeoutMs });
    if (outcome.phase === 'ready') return outcome;
    if (outcome.phase === 'failed') {
      throw new LoginError(outcome.message, { code: 'LOGIN_REJECTED' });
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new LoginError('the authorization window closed before it was approved', {
        code: 'LOGIN_TIMEOUT',
      });
    }
    onTick?.(remaining);

    await delay(Math.min(flow.pollIntervalMs, remaining), signal);
  }
}

export async function login(options = {}) {
  const flow = await initLogin(options);
  await options.present?.(flow);
  return awaitLogin(flow, options);
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LoginError('login was cancelled', { code: 'LOGIN_CANCELLED' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LoginError('login was cancelled', { code: 'LOGIN_CANCELLED' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
