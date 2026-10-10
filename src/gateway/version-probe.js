import { FALLBACK_APP_VERSION } from './protocol-constants.js';

const DOC_URLS = [
  'https://zcode.z.ai/en/docs/install',
  'https://zcode.z.ai/cn/docs/install',
];
const RELEASE_URL = 'https://api.github.com/repos/zai-org/ZCode/releases/latest';
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(text) {
  const match = VERSION_PATTERN.exec(String(text).trim().replace(/^v/, ''));
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compare(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function format(v) {
  return `${v.major}.${v.minor}.${v.patch}`;
}

function best(candidates) {
  let winner = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!winner || compare(candidate, winner) > 0) winner = candidate;
  }
  return winner;
}

async function getText(fetchImpl, url, timeoutMs) {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'text/html,application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok ? await response.text() : '';
  } catch {
    return '';
  }
}

export async function resolveAppVersion(options = {}) {
  const { fetchImpl = globalThis.fetch, timeoutMs = 10_000, fallback = FALLBACK_APP_VERSION } = options;
  const [release, ...docs] = await Promise.all([
    getText(fetchImpl, RELEASE_URL, timeoutMs),
    ...DOC_URLS.map((url) => getText(fetchImpl, url, timeoutMs)),
  ]);

  const fromRelease = (() => {
    const match = release.match(/"tag_name"\s*:\s*"v?(\d+\.\d+\.\d+)"/);
    return match ? parseVersion(match[1]) : null;
  })();

  const fromDocs = best(
    docs.flatMap((html) =>
      [...html.matchAll(/releases\/(\d+\.\d+\.\d+)/g)].map((m) => parseVersion(m[1])),
    ),
  );

  const resolved = best([fromRelease, fromDocs]);
  return resolved ? format(resolved) : fallback;
}
