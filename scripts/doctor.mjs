#!/usr/bin/env node
import { TokenStore, defaultTokenPath } from '../src/auth/token-store.js';
import { ZaiClient } from '../src/gateway/client.js';
import { resolveAppVersion } from '../src/gateway/version-probe.js';
import { AGENT_PROMPT_PREFIX, IDENTITY_HEAD, ZCODE_DEFAULT_ORIGIN } from '../src/gateway/protocol-constants.js';

const store = new TokenStore();
const line = (label, value) => console.log(`  ${label.padEnd(22)} ${value}`);

console.log('dsh-glm-web-search - diagnostics\n');
console.log('Configuration');
line('origin', ZCODE_DEFAULT_ORIGIN);
line('token file', defaultTokenPath());
line('identity head length', `${IDENTITY_HEAD.length} (expected 42)`);
line('agent prompt length', `${AGENT_PROMPT_PREFIX.length} (expected 1211)`);
line('$ZAI_JWT present', process.env.ZAI_JWT ? 'yes' : 'no');

const status = store.describe();
line('credential', status.configured ? status.source : 'NONE');
if (status.email) line('account', status.email);

console.log('\nVersion probe');
const version = await resolveAppVersion();
line('appVersion', version);

if (!store.read()) {
  console.log('\nNo credential is stored. Run `node scripts/login.mjs`, then re-run this.');
  process.exit(1);
}

console.log('\nLive capabilities');
const client = new ZaiClient({ origin: ZCODE_DEFAULT_ORIGIN, resolveToken: async () => store.read() });

async function check(label, run) {
  const started = Date.now();
  try {
    const detail = await run();
    console.log(`  PASS  ${label} (${Date.now() - started} ms)${detail ? ` - ${detail}` : ''}`);
    return true;
  } catch (error) {
    console.log(`  FAIL  ${label} (${Date.now() - started} ms) - ${error.code ?? ''} ${error.message}`);
    return false;
  }
}

await check('web_search', async () => {
  const payload = await client.runServerTool(
    'web_search_20250305', 'web_search_prime',
    'Search the web for: DeepSeek Harness', { search_query: 'DeepSeek Harness', count: 3 },
  );
  return `${Array.isArray(payload) ? payload.length : 0} result(s)`;
});

await check('web_fetch', async () => {
  const payload = await client.runServerTool(
    'web_fetch_20250910', 'webReader',
    'Read this URL: https://example.com', { url: 'https://example.com' },
  );
  const content = Array.isArray(payload) ? payload[0]?.content : payload?.content;
  return `${String(content ?? '').length} chars`;
});

console.log('\nInterpretation');
console.log('  ZAI_CLIENT_OUTDATED -> Z.AI changed its client contract; re-capture the two');
console.log('                         identity constants in src/gateway/protocol-constants.js from a current ZCode build.');
console.log('  ZAI_UNAUTHENTICATED -> the login expired; run `node scripts/login.mjs` again.');
console.log('  ZAI_BLOCKED         -> the egress IP is rate-limited by the edge WAF, not an auth problem.');
