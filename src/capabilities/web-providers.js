import { TOOL_WEB_FETCH, TOOL_WEB_SEARCH, ZAI_PROVIDER_ID } from '../gateway/protocol-constants.js';
import { ZaiError } from '../gateway/client.js';
import { mapReaderResult, mapSearchResults } from '../gateway/payload-mapper.js';

export class WebError extends Error {
  constructor(message, code = 'WEB_PROVIDER_ERROR', options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'WebError';
    this.code = code;
  }
}

export const SEARCH_PROVIDER_ID = ZAI_PROVIDER_ID;
export const FETCH_PROVIDER_ID = ZAI_PROVIDER_ID;

export const DEFAULT_SEARCH_RESULTS = 10;
export const MAX_SEARCH_RESULTS = 50;

function toWebError(error, fallbackCode = 'WEB_PROVIDER_ERROR') {
  if (error instanceof ZaiError) {
    const code =
      error.code === 'ZAI_ABORTED'
        ? 'WEB_ABORTED'
        : error.code === 'ZAI_CREDENTIAL_MISSING'
          ? 'WEB_PROVIDER_CREDENTIAL_MISSING'
          : fallbackCode;
    return new WebError(error.message, code, { cause: error });
  }
  return new WebError(
    error instanceof Error ? error.message : `Z.AI request failed: ${String(error)}`,
    fallbackCode,
    { cause: error },
  );
}

export class ZaiSearchProvider {
  constructor(client, hasCredential) {
    this.client = client;
    this.hasCredential = hasCredential;
    this.id = SEARCH_PROVIDER_ID;
  }

  available() {
    return this.hasCredential() === true;
  }

  async search(request, signal) {
    const query = String(request?.query ?? '').trim();
    if (query.length === 0) {
      throw new WebError('the search query must not be empty', 'WEB_PROVIDER_ERROR');
    }

    const maxResults = clampResults(request?.maxResults);
    try {
      const payload = await this.client.runServerTool(
        TOOL_WEB_SEARCH,
        'web_search_prime',
        `Search the web for this query and return the results: ${query}`,
        { search_query: query, count: maxResults },
        signal,
      );
      const { sources } = mapSearchResults(payload);
      return { sources, truncated: false };
    } catch (error) {
      throw toWebError(error);
    }
  }
}

export class ZaiFetchProvider {
  constructor(client, hasCredential) {
    this.client = client;
    this.hasCredential = hasCredential;
    this.id = FETCH_PROVIDER_ID;
  }

  available() {
    return this.hasCredential() === true;
  }

  async fetch(request, signal) {
    const url = String(request?.url ?? '').trim();
    if (!isAbsoluteHttpUrl(url)) {
      throw new WebError(`"${url}" is not an absolute HTTP(S) URL`, 'WEB_INVALID_URL');
    }

    try {
      const payload = await this.client.runServerTool(
        TOOL_WEB_FETCH,
        'webReader',
        `Read this URL and return the page content: ${url}`,
        { url },
        signal,
      );
      return mapReaderResult(payload, url);
    } catch (error) {
      if (error instanceof ZaiError && error.code === 'ZAI_TOOL_ERROR' && /fetch failed/i.test(error.message)) {
        throw new WebError(`the reader could not retrieve ${url}`, 'WEB_PROVIDER_ERROR', { cause: error });
      }
      throw toWebError(error);
    }
  }
}

function clampResults(value) {
  if (!Number.isFinite(value)) return DEFAULT_SEARCH_RESULTS;
  return Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.trunc(value)));
}

function isAbsoluteHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
