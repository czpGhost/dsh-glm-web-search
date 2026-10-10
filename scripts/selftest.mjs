#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { TokenStore, defaultTokenPath } from '../src/auth/token-store.js';
import { ZaiClient } from '../src/gateway/client.js';
import { ZaiFetchProvider, ZaiSearchProvider } from '../src/capabilities/web-providers.js';
import { describeImage } from '../src/capabilities/image-analysis.js';
import { ZCODE_DEFAULT_ORIGIN } from '../src/gateway/protocol-constants.js';

const store = new TokenStore();
if (!store.read()) {
  console.error(`No credential found (${defaultTokenPath()}).`);
  console.error('Run `node scripts/login.mjs` first.');
  process.exit(1);
}

const status = store.describe();
console.log(`credential : ${status.source}${status.email ? ` (${status.email})` : ''}`);
console.log(`origin     : ${ZCODE_DEFAULT_ORIGIN}`);
console.log();

const client = new ZaiClient({
  origin: ZCODE_DEFAULT_ORIGIN,
  resolveToken: async () => store.read(),
  deviceMid: () => store.deviceMid(),
});
const search = new ZaiSearchProvider(client, () => true);
const fetchProvider = new ZaiFetchProvider(client, () => true);

let failures = 0;
const ok = (label, detail) => console.log(`  PASS  ${label}${detail ? ` - ${detail}` : ''}`);
const bad = (label, error) => { failures += 1; console.log(`  FAIL  ${label} - ${error}`); };

console.log('[1] web_search -> web_search_prime');
{
  const query = 'DeepSeek Harness plugin architecture';
  let lastError;
  let passed = false;
  for (let attempt = 1; attempt <= 2 && !passed; attempt += 1) {
    try {
      const result = await search.search({ query, maxResults: 5 });
      if (result.sources.length === 0) throw new Error('no sources returned');
      passed = true;
      ok('search', `${result.sources.length} source(s)${attempt > 1 ? ` (retry ${attempt})` : ''}`);
      for (const source of result.sources.slice(0, 3)) {
        console.log(`          ${source.title ?? '(untitled)'}`);
        console.log(`            ${source.url}`);
      }
    } catch (error) {
      lastError = error;
      if (attempt === 1) console.log(`  ....  attempt 1 returned nothing; retrying once`);
    }
  }
  if (!passed) {
    bad('search', `${lastError?.message ?? 'unknown'} (twice - this looks like upstream, not wiring)`);
  }
}

console.log('\n[2] web_fetch -> webReader');
try {
  const result = await fetchProvider.fetch({ url: 'https://example.com' });
  const text = result.body.kind === 'text' ? result.body.content : '';
  if (text.trim().length === 0) throw new Error('empty body');
  ok('fetch', `${text.length} chars, HTTP ${result.statusCode}`);
  console.log(`          ${text.slice(0, 160).replace(/\n/g, ' ')}...`);
} catch (error) { bad('fetch', error.message); }

const visionIndex = process.argv.indexOf('--vision');
if (visionIndex >= 0) {
  const path = process.argv[visionIndex + 1];
  console.log(`\n[3] vision (model resolved from the live catalog)`);
  if (!path || !existsSync(path)) {
    bad('vision', 'pass an existing image path after --vision');
  } else {
    try {
      const bytes = readFileSync(path);
      const result = await describeImage({
        client,
        image: path,
        prompt: process.argv.includes('--transcribe')
          ? 'Transcribe all text in this image verbatim. Output only the text.'
          : undefined,
      });
      ok('vision', `${bytes.byteLength} byte image -> ${result.text.length} char answer`);
      console.log(`          ${result.text.slice(0, 240).replace(/\n/g, ' ')}...`);
    } catch (error) { bad('vision', error.message); }
  }
} else {
  console.log('\n[3] vision - skipped (pass --vision <image path> to include it)');
}

console.log();
console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
