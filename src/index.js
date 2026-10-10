import { boolean, number, object, string } from './config-schema.js';
import { FALLBACK_MODEL, ZAI_PROVIDER_ID, ZCODE_DEFAULT_ORIGIN } from './gateway/protocol-constants.js';
import { TokenStore } from './auth/token-store.js';
import { ZaiClient } from './gateway/client.js';
import { ZaiFetchProvider, ZaiSearchProvider } from './capabilities/web-providers.js';
import { registerVisionTool } from './capabilities/vision-tool.js';
import { LOGIN_COMMAND_NAME, registerLoginCommand } from './commands/slash-command.js';

export { IDENTITY_HEAD, AGENT_PROMPT_PREFIX, ZAI_PROVIDER_ID, ZCODE_DEFAULT_ORIGIN, FALLBACK_MODEL, FALLBACK_VISION_MODEL } from './gateway/protocol-constants.js';
export { TokenStore, JWT_ENV_VAR, defaultTokenPath } from './auth/token-store.js';
export { ZaiClient, ZaiError, parseServerToolResult, DEFAULT_TIMEOUT_MS } from './gateway/client.js';
export { initLogin, awaitLogin, login, LoginError } from './account/oauth-login.js';
export { mapReaderResult, mapSearchResults } from './gateway/payload-mapper.js';
export { fetchModelCatalog, parseCatalog, selectModel, modelsFromEntitlements, idAcceptsImages } from './gateway/model-catalog.js';
export { ZaiFetchProvider, ZaiSearchProvider, SEARCH_PROVIDER_ID, FETCH_PROVIDER_ID } from './capabilities/web-providers.js';
export { describeImage, MAX_IMAGE_BYTES, DEFAULT_VISION_PROMPT } from './capabilities/image-analysis.js';
export { registerVisionTool, VISION_TOOL_NAME } from './capabilities/vision-tool.js';
export { resolveAppVersion } from './gateway/version-probe.js';
export { LOGIN_COMMAND_NAME, PLUGIN_COMMAND_PREFIX, LOGIN_COMMAND_USAGE, parseCommandInput, registerLoginCommand } from './commands/slash-command.js';
export { fetchBilling, describeBilling, formatDuration, TOKEN_TTL_MS } from './account/billing-reader.js';
export { openBrowser, browserOpenEnabled, BROWSER_OPEN_ENV, openerArgs } from './auth/browser-launcher.js';
export { checkAuthorizeUrl, looksTruncated, REQUIRED_AUTHORIZE_PARAMS } from './auth/url-integrity.js';
export { object as configSchema } from './config-schema.js';

export const name = 'dsh-glm-web-search';

export const inject = ['web', 'tools', 'commands'];

export function managedKey(jwtEnv) {
  return `dsh-glm-web-search/${jwtEnv}`;
}

export const Config = object({
  origin: string({ defaultValue: ZCODE_DEFAULT_ORIGIN }),
  model: string({ optional: true }),
  appVersion: string({ optional: true }),
  jwtEnv: string({ defaultValue: 'ZAI_JWT', role: 'credential-ref' }),
  tokenPath: string({ optional: true }),
  vision: boolean({ defaultValue: true }),
  timeoutMs: number({ defaultValue: 90_000, min: 1000, integer: true }),
});

export function resolveConfig(config = {}) {
  const origin = (config.origin ?? ZCODE_DEFAULT_ORIGIN).trim();
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('origin must be an absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('origin must use HTTP or HTTPS');
  }

  const timeoutMs = config.timeoutMs ?? 90_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000) {
    throw new Error('timeoutMs must be an integer of at least 1000');
  }

  return {
    origin: parsed.origin,
    ...(config.model ? { model: config.model.trim() } : {}),
    ...(config.appVersion ? { appVersion: config.appVersion.trim() } : {}),
    jwtEnv: (config.jwtEnv ?? 'ZAI_JWT').trim() || 'ZAI_JWT',
    ...(config.tokenPath ? { tokenPath: config.tokenPath.trim() } : {}),
    vision: config.vision ?? true,
    timeoutMs,
  };
}

export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config);
  const store = new TokenStore({
    ...(resolved.tokenPath ? { path: resolved.tokenPath } : {}),
    envVar: resolved.jwtEnv,
  });
  const key = managedKey(resolved.jwtEnv);

  let managed = false;
  const credentials = ctx.get?.('credentials');

  const resolveToken = async () => {
    if (managed) {
      try {
        const record = await credentials?.readRecord?.(key);
        if (record?.kind === 'api-key' && typeof record.key === 'string' && record.key.trim()) {
          return record.key.trim();
        }
        managed = false;
      } catch {
      }
    }

    const env = process.env[resolved.jwtEnv]?.trim();
    if (env) return env;

    const local = store.read();
    if (local) return local;
    return undefined;
  };

  const primeManaged = async () => {
    try {
      const record = await credentials?.readRecord?.(key);
      managed = record?.kind === 'api-key'
        && typeof record.key === 'string'
        && record.key.trim().length > 0;
    } catch {
      managed = false;
    }
    return managed;
  };
  void primeManaged();

  const hasCredential = () =>
    managed
    || store.read() !== undefined
    || (process.env[resolved.jwtEnv]?.trim().length ?? 0) > 0;

  const client = new ZaiClient({
    origin: resolved.origin,
    model: resolved.model,
    timeoutMs: resolved.timeoutMs,
    ...(resolved.appVersion ? { appVersion: resolved.appVersion } : {}),
    deviceMid: () => store.deviceMid(),
    resolveToken,
  });

  ctx.web.registerSearchProvider(new ZaiSearchProvider(client, hasCredential));
  ctx.web.registerFetchProvider(new ZaiFetchProvider(client, hasCredential));

  if (resolved.vision) registerVisionTool(ctx, { client });

  registerLoginCommand(ctx, {
    origin: resolved.origin,
    store,
    client,
    resolveToken,
    ...(resolved.appVersion ? { appVersion: resolved.appVersion } : {}),
  });

  const status = store.describe();
  ctx.logger?.info?.(
    status.configured
      ? `Z.AI providers registered (credential: ${status.source})`
      : 'Z.AI providers registered, but no credential is stored yet — run /dsh-glm-web-search login to sign in',
  );
}
