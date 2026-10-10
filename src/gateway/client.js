import {
  AGENT_PROMPT_PREFIX,
  FALLBACK_MODEL,
  FALLBACK_VISION_MODEL,
  IDENTITY_HEAD,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  ZCODE_DEFAULT_ORIGIN,
} from './protocol-constants.js';
import { resolveAppVersion } from './version-probe.js';
import { fetchModelCatalog, selectModel } from './model-catalog.js';

export const DEFAULT_TIMEOUT_MS = 90_000;

const CODE_IDENTITY_REJECTED = 3012;

const CONCURRENCY_CODES = new Set([3008, 3009, 3010]);
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 2_000;

export class ZaiError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ZaiError';
    this.code = options.code ?? 'ZAI_ERROR';
    if (options.status !== undefined) this.status = options.status;
    if (options.businessCode !== undefined) this.businessCode = options.businessCode;
  }
}

export function parseServerToolResult(content) {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? null);
  if (text.length === 0) return null;

  const candidates = [];
  const seam = text.lastIndexOf('][');
  if (seam >= 0) candidates.push(text.slice(seam + 1));
  candidates.push(text);

  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (parsed === undefined) continue;
    const normalized = normalizePayload(parsed, 0);
    if (normalized !== undefined) return normalized;
  }
  return null;
}

function normalizePayload(value, depth) {
  if (depth > 8) return value;

  if (isPlainObject(value) && 'text' in value && Object.keys(value).length <= 2) {
    const inner = value.text;
    if (typeof inner === 'string') {
      const parsed = tryParse(inner);
      return normalizePayload(parsed === undefined ? inner : parsed, depth + 1);
    }
    return normalizePayload(inner, depth + 1);
  }

  if (Array.isArray(value) && value.length === 1 && Array.isArray(value[0])) {
    return normalizePayload(value[0], depth + 1);
  }

  return value;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class ZaiClient {
  constructor(options) {
    this.origin = (options.origin ?? ZCODE_DEFAULT_ORIGIN).replace(/\/+$/, '');
    this.model = options.model ?? 'GLM-5.3';
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.resolveToken = options.resolveToken;
    this.baseUrlOverride = options.baseUrlOverride;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.appVersion = options.appVersion;
    this.deviceMid = options.deviceMid;
    this.maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    this.retryBaseMs = options.retryBaseMs ?? RETRY_BASE_MS;
    this.versionPromise = null;
    this.catalogPromise = null;
    this.availableModels = options.availableModels;
  }

  async version() {
    if (this.appVersion) return this.appVersion;
    this.versionPromise ??= resolveAppVersion({ fetchImpl: this.fetchImpl, fallback: this.appVersion });
    return this.versionPromise;
  }

  async catalog() {
    this.catalogPromise ??= (async () => {
      try {
        const [version, token] = await Promise.all([this.version(), this.resolveToken()]);
        return await fetchModelCatalog({
          fetchImpl: this.fetchImpl,
          origin: this.origin,
          appVersion: version,
          ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
          ...(this.deviceMid ? { headers: { authorization: `Bearer ${token}`, 'x-device-mid': this.deviceMid() } } : {}),
        });
      } catch {
        return undefined;
      }
    })();
    return this.catalogPromise;
  }

  async resolveModel({ requireVision = false } = {}) {
    const catalog = await this.catalog();
    const available = (this.availableModels ?? []).map((entry) =>
      typeof entry === 'string' ? entry : entry?.id,
    ).filter(Boolean);
    return selectModel({
      catalog,
      preferred: this.model,
      available,
      requireVision,
    }) ?? (requireVision ? FALLBACK_VISION_MODEL : FALLBACK_MODEL);
  }

  refreshCatalog() {
    this.catalogPromise = null;
  }

  get messagesUrl() {
    const base = (this.baseUrlOverride ?? this.origin).replace(/\/+$/, '');
    return `${base}/api/v1/zcode-plan/anthropic/v1/messages`;
  }

  async runServerTool(toolType, toolName, prompt, toolInput, signal) {
    const block = {
      type: 'text',
      text: `Call the ${toolName} tool with exactly the arguments provided in the user turn. Do not answer from memory.`,
    };
    const body = {
      model: await this.resolveModel(),
      max_tokens: 1024,
      stream: false,
      system: this.identitySystem(block),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'text', text: `Tool arguments: ${JSON.stringify(toolInput)}` },
          ],
        },
      ],
      tools: [{ type: toolType, name: toolName, max_uses: 3 }],
      tool_choice: { type: 'tool', name: toolName },
      thinking: { type: 'disabled' },
    };

    const parsed = await this.request(body, `${toolName}`, signal);

    const blocks = Array.isArray(parsed.content) ? parsed.content : [];
    const serverUse = blocks.find((entry) => entry?.type === 'server_tool_use');
    const result = blocks.find((entry) => entry?.type === 'tool_result');

    if (!serverUse) {
      throw new ZaiError(
        `the gateway did not run ${toolName}; it answered from the model instead`,
        { code: 'ZAI_TOOL_NOT_RUN' },
      );
    }
    if (!result) {
      throw new ZaiError(`the gateway ran ${toolName} but returned no result`, {
        code: 'ZAI_EMPTY_RESULT',
      });
    }

    const payload = parseServerToolResult(result.content);
    if (payload === null) {
      throw new ZaiError(`the ${toolName} result could not be decoded`, {
        code: 'ZAI_MALFORMED_RESULT',
      });
    }
    if (isPlainObject(payload) && 'error' in payload) {
      throw new ZaiError(String(payload.error), { code: 'ZAI_TOOL_ERROR' });
    }
    return payload;
  }

  identitySystem(...extraBlocks) {
    return [
      { type: 'text', text: IDENTITY_HEAD },
      { type: 'text', text: AGENT_PROMPT_PREFIX },
      ...extraBlocks,
    ];
  }

  async request(body, label = 'request', signal) {
    const token = await this.resolveToken();
    if (!token) {
      throw new ZaiError('no Z.AI credential is configured', { code: 'ZAI_CREDENTIAL_MISSING' });
    }
    const version = await this.version();

    let lastError;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const outcome = await this.send(body, token, version, signal);

      if (outcome.ok) return outcome.payload;

      lastError = outcome.error;
      const retryable = CONCURRENCY_CODES.has(outcome.error.businessCode);
      if (!retryable || attempt === this.maxAttempts || signal?.aborted) throw outcome.error;

      await sleep(this.retryBaseMs * attempt, signal);
    }
    throw lastError;
  }

  async send(body, token, version, signal) {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response;
    try {
      response = await this.fetchImpl(this.messagesUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          'user-agent': `ZCode/${version}`,
          'http-referer': this.origin,
          'x-title': 'Z Code@electron',
          'x-zcode-app-version': version,
          'x-platform': `${process.platform}-${process.arch}`,
          'x-release-channel': 'stable',
          'x-client-language': 'zh-CN',
          'x-client-timezone': clientTimezone(),
          'x-os-category': osCategory(),
          'x-request-id': crypto.randomUUID(),
          ...(this.deviceMid ? { 'x-device-mid': this.deviceMid() } : {}),
        },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (error) {
      if (signal?.aborted) {
        return { ok: false, error: new ZaiError('the request was cancelled', { code: 'ZAI_ABORTED', cause: error }) };
      }
      return {
        ok: false,
        error: new ZaiError(`could not reach the ZCode gateway: ${describe(error)}`, {
          code: 'ZAI_UNREACHABLE',
          cause: error,
        }),
      };
    }

    const text = await response.text();
    const payload = tryParse(text);

    const businessCode = pickBusinessCode(payload);
    const failed = !response.ok
      || payload === undefined
      || (payload && typeof payload === 'object' && 'error' in payload)
      || (businessCode !== undefined && businessCode !== 0);

    if (failed) return { ok: false, error: this.mapFailure(response.status, payload, text) };
    return { ok: true, payload };
  }

  mapFailure(status, payload, raw) {
    const businessCode = pickBusinessCode(payload);
    const detail = pickMessage(payload) ?? String(raw ?? '').slice(0, 300).trim();

    if (businessCode === CODE_IDENTITY_REJECTED) {
      return new ZaiError(
        'the gateway rejected the ZCode client identity (code 3012). Z.AI most likely changed its client contract; the identity constants in src/constants.js need re-capturing from a current ZCode build.',
        { code: 'ZAI_CLIENT_OUTDATED', status, businessCode },
      );
    }
    if (status === 405 && businessCode === undefined) {
      return new ZaiError(
        'the gateway blocked the request (HTTP 405), which is the edge WAF rate-limiting this egress IP rather than an authentication failure',
        { code: 'ZAI_BLOCKED', status, businessCode },
      );
    }
    if (businessCode === 1005) {
      return new ZaiError(detail || 'the Z.AI account has no remaining quota for this period', {
        code: 'ZAI_QUOTA_EXHAUSTED',
        status,
        businessCode,
      });
    }
    if (businessCode === 1006) {
      return new ZaiError(detail || 'the Z.AI credential is no longer valid; sign in again', {
        code: 'ZAI_UNAUTHENTICATED',
        status,
        businessCode,
      });
    }
    if (businessCode === 3006) {
      return new ZaiError(detail || `the model "${this.model}" is not available on this plan`, {
        code: 'ZAI_MODEL_UNAVAILABLE',
        status,
        businessCode,
      });
    }
    if (CONCURRENCY_CODES.has(businessCode) || status === 429) {
      return new ZaiError(detail || 'the Z.AI gateway is rate limiting this account', {
        code: 'ZAI_RATE_LIMITED',
        status,
        businessCode,
      });
    }
    if (status === 401 || status === 403) {
      return new ZaiError(detail || 'the Z.AI credential was rejected', {
        code: 'ZAI_UNAUTHENTICATED',
        status,
        businessCode,
      });
    }
    return new ZaiError(detail || `the ZCode gateway returned HTTP ${status}`, {
      code: 'ZAI_UPSTREAM_ERROR',
      status,
      businessCode,
    });
  }
}

function pickBusinessCode(payload) {
  if (!isPlainObject(payload)) return undefined;
  if (typeof payload.code === 'number') return payload.code;
  const nested = payload.error;
  if (isPlainObject(nested) && typeof nested.code === 'number') return nested.code;
  return undefined;
}

function pickMessage(payload) {
  if (!isPlainObject(payload)) return undefined;
  for (const key of ['msg', 'message']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  const nested = payload.error;
  if (isPlainObject(nested) && typeof nested.message === 'string' && nested.message.trim().length > 0) {
    return nested.message.trim();
  }
  return undefined;
}

function clientTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function osCategory() {
  return { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform] ?? process.platform;
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ZaiError('the request was cancelled', { code: 'ZAI_ABORTED' }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ZaiError('the request was cancelled', { code: 'ZAI_ABORTED' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
