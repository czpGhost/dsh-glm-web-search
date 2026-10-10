#!/usr/bin/env node
import { TokenStore, defaultTokenPath } from '../src/auth/token-store.js';
import { awaitLogin, initLogin } from '../src/account/oauth-login.js';
import { ZCODE_DEFAULT_ORIGIN } from '../src/gateway/protocol-constants.js';

const origin = process.env.ZAI_ORIGIN?.trim() || ZCODE_DEFAULT_ORIGIN;
const store = new TokenStore();

console.log('dsh-glm-web-search — Z.AI login');
console.log(`  origin      : ${origin}`);
console.log(`  token file  : ${defaultTokenPath()}`);
console.log();

const flow = await initLogin({ origin });

console.log('Open this URL and approve access:\n');
console.log(`  ${flow.authorizeUrl}\n`);
console.log(`Waiting for approval (flow ${flow.flowId})...`);

const started = Date.now();
let lastShown = 0;

try {
  const result = await awaitLogin(flow, {
    origin,
    onTick(remainingMs) {
    const elapsed = Math.round((Date.now() - started) / 1000);
      if (elapsed - lastShown < 15) return;
      lastShown = elapsed;
      console.log(`  ...waiting (${Math.round(remainingMs / 1000)}s left)`);
    },
  });

  const saved = store.save({
    jwt: result.jwt,
    email: result.email,
    userId: result.userId,
  });

  console.log();
  console.log('Signed in.');
  if (result.email) console.log(`  account : ${result.email}`);
  if (result.name) console.log(`  name    : ${result.name}`);
  console.log(`  token   : stored (${saved.jwt.length} chars)`);
  console.log();
  console.log('Next: restart DSH (or reload it) so the providers pick up the credential.');
} catch (error) {
  console.error();
  console.error(`Login failed: ${error.message}`);
  if (error.code === 'LOGIN_TIMEOUT') {
    console.error('The authorization window elapsed. Re-run this script to get a fresh link.');
  }
  process.exit(1);
}
