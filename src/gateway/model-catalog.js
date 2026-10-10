import { ZCODE_DEFAULT_ORIGIN } from './protocol-constants.js';

const CONFIGS_PATH = '/api/v1/client/configs';

export async function fetchModelCatalog(options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    origin = ZCODE_DEFAULT_ORIGIN,
    appVersion = '',
    platform = `${process.platform}-${process.arch}`,
    headers = {},
    signal,
    timeoutMs = 15_000,
  } = options;
  const base = String(origin).replace(/\/+$/, '');
  const query = `?app_version=${encodeURIComponent(appVersion)}&platform=${encodeURIComponent(platform)}`;

  let payload;
  try {
    const response = await fetchImpl(`${base}${CONFIGS_PATH}${query}`, {
      headers: {
        accept: 'application/json',
        ...(appVersion ? { 'x-zcode-app-version': appVersion, 'user-agent': `ZCode/${appVersion}` } : {}),
        ...headers,
      },
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return undefined;
    payload = await response.json();
  } catch {
    return undefined;
  }

  const catalog = parseCatalog(payload);
  if (!catalog) return undefined;
  return { ...catalog, source: `${base}${CONFIGS_PATH}` };
}

export function parseCatalog(payload) {
  const data = payload?.data;
  if (!data || typeof data !== 'object') return undefined;

  const declared = Array.isArray(data.builtinModels) ? data.builtinModels : [];
  const providers = Array.isArray(data.builtinProviders) ? data.builtinProviders : [];

  const byId = new Map();
  for (const entry of declared) {
    const id = typeof entry?.modelId === 'string' ? entry.modelId.trim() : '';
    if (!id) continue;
    byId.set(id, {
      id,
      vision: entry?.capabilities?.vision === true,
      priority: Number.isFinite(entry?.priority) ? entry.priority : undefined,
      contextWindow: Number.isFinite(entry?.contextWindow) ? entry.contextWindow : undefined,
    });
  }
  for (const provider of providers) {
    for (const id of provider?.models ?? []) {
      const text = typeof id === 'string' ? id.trim() : '';
      if (!text || byId.has(text)) continue;
      byId.set(text, { id: text, vision: false });
    }
  }
  if (byId.size === 0) return undefined;

  const models = [...byId.values()].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const defaultModel = providers
    .map((provider) => provider?.defaultModel)
    .find((id) => typeof id === 'string' && byId.has(id.trim()));

  return {
    models: models.map((entry) => entry.id),
    vision: models.filter((entry) => entry.vision).map((entry) => entry.id),
    ...(defaultModel ? { defaultModel: defaultModel.trim() } : {}),
  };
}

export function idAcceptsImages(catalog, id) {
  const target = String(id ?? '').toLowerCase();
  return (catalog?.vision ?? []).some((candidate) => candidate.toLowerCase() === target);
}

export function modelsFromEntitlements(billing) {
  const found = [];
  const seen = new Set();
  for (const plan of billing?.plans ?? []) {
    for (const entry of plan?.entitlements ?? []) {
      for (const capability of entry?.capabilities ?? []) {
        const text = String(capability).trim();
        if (!text.toLowerCase().startsWith('model:')) continue;
        const id = text.slice('model:'.length).trim();
        const key = id.toLowerCase();
        if (!id || seen.has(key)) continue;
        seen.add(key);
        found.push({ id, showName: entry.show_name ?? id });
      }
    }
  }
  return found;
}

export function selectModel({ catalog, preferred, available = [], requireVision = false }) {
  const usable = (id) => {
    const text = String(id ?? '').trim();
    if (!text) return false;
    if (available.length === 0) return true;
    return available.some((candidate) => candidate.toLowerCase() === text.toLowerCase());
  };
  const visionIds = catalog?.vision ?? [];
  const isVision = (id) =>
    visionIds.some((candidate) => candidate.toLowerCase() === String(id).toLowerCase());

  if (preferred && usable(preferred) && (!requireVision || isVision(preferred))) return preferred;

  const pool = (catalog?.models ?? []).filter(usable);
  if (requireVision) return pool.find(isVision) ?? visionIds.find(usable) ?? preferred;
  return pool.find((id) => !isVision(id)) ?? pool[0] ?? preferred;
}
