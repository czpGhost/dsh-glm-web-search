import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenStore } from '../src/auth/token-store.js';
import { ZaiSearchProvider } from '../src/capabilities/web-providers.js';
import { LOGIN_COMMAND_NAME, PLUGIN_COMMAND_PREFIX, registerLoginCommand } from '../src/commands/slash-command.js';

function collectCommands(options) {
  const commands = [];
  const ctx = { commands: { register: (definition) => { commands.push(definition); return () => {}; } } };
  registerLoginCommand(ctx, options);
  return commands;
}

function hasUndefinedValue(value, seen = new Set()) {
  if (value === undefined) return true;
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => hasUndefinedValue(entry, seen));
  return Object.values(value).some((entry) => hasUndefinedValue(entry, seen));
}

function tempStore(seed) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-glm-verify-'));
  const path = join(dir, 'token.json');
  if (seed) writeFileSync(path, JSON.stringify(seed), 'utf8');
  return { store: new TokenStore({ path }), path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const fakeJwt = (userId) =>
  `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.`
  + `${Buffer.from(JSON.stringify({ user_id: userId, sub: userId, iat: Math.floor(Date.now() / 1000) })).toString('base64url')}.`
  + 'signature';

const invoke = (definition, rawInput, timeoutMs = 30_000) =>
  definition.handler({
    commandId: 'verify',
    agent: { id: 'verify' },
    rawInput,
    attachments: [],
    signal: AbortSignal.timeout(timeoutMs),
  });

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
};

const real = new TokenStore();
const before = { jwt: real.read(), deviceMid: real.deviceMid() };

console.log('registrations');
{
  const temp = tempStore();
  try {
    const commands = collectCommands({ store: temp.store, origin: 'https://zcode.z.ai' });
    const names = commands.map((command) => command.name);
    check('main command is registered', names.includes(LOGIN_COMMAND_NAME), LOGIN_COMMAND_NAME);
    for (const suffix of ['login', 'logout', 'status']) {
      check(`alias ${PLUGIN_COMMAND_PREFIX}${suffix}`, names.includes(`${PLUGIN_COMMAND_PREFIX}${suffix}`));
    }
    check('every name shares the prefix', names.every((name) => name.startsWith(PLUGIN_COMMAND_PREFIX)));
    check('no duplicate names', new Set(names).size === names.length);
    check('no checkin alias remains', !names.includes(`${PLUGIN_COMMAND_PREFIX}checkin`));
    for (const command of commands) {
      check(`/${command.name} declares a description`, typeof command.description === 'string' && command.description.length > 0);
    }
  } finally {
    temp.cleanup();
  }
}

console.log('\nisolated behaviour (temp stores only)');
{
  const temp = tempStore({ jwt: fakeJwt('verify-user'), savedAt: Date.now(), deviceMid: '11111111-2222-4333-8444-555555555555' });
  try {
    const commands = collectCommands({
      store: temp.store,
      origin: 'https://zcode.z.ai',
      fetchImpl: async () => { throw new Error('network disabled in verify-commands'); },
    });
    const byName = (name) => commands.find((command) => command.name === name);

    check('device id survives logout', temp.store.deviceMid() === '11111111-2222-4333-8444-555555555555');

    const signedIn = await invoke(byName(`${PLUGIN_COMMAND_PREFIX}status`), '');
    check('status with a credential succeeds', signedIn.kind === 'success', String(signedIn.text).split('\n')[0]);
    check(
      'status reports the plan as unavailable, not as auth failure',
      /plan\s+unavailable/.test(String(signedIn.text)),
      String(signedIn.text).split('\n')[0],
    );

    const out = await invoke(byName(`${PLUGIN_COMMAND_PREFIX}logout`), '');
    check('logout reports success', out.kind === 'success', String(out.text).split('\n')[0]);
    check('logout cleared the temp credential', temp.store.read() === undefined);
    check('device id still present after logout', temp.store.deviceMid() === '11111111-2222-4333-8444-555555555555');

    const status0 = await invoke(byName(`${PLUGIN_COMMAND_PREFIX}status`), '');
    check('status without a credential succeeds', status0.kind === 'success', String(status0.text).split('\n')[0]);
    check('status summary names the signed-out state', String(status0.text).startsWith('not signed in'));

    const checkin = await invoke(byName(LOGIN_COMMAND_NAME), 'checkin');
    check('checkin is now an unknown subcommand', checkin.kind === 'error', String(checkin.text).split('\n')[0]);

    const main = await invoke(byName(LOGIN_COMMAND_NAME), 'status');
    check('main command routes "status"', main.kind === 'success' && String(main.text).startsWith('not signed in'));
    const unknown = await invoke(byName(LOGIN_COMMAND_NAME), 'nonsense');
    check('unknown subcommand is an error', unknown.kind === 'error', String(unknown.text).split('\n')[0]);
  } finally {
    temp.cleanup();
  }
}

console.log('\nprovider results are lossless JSON');
{
  const provider = new ZaiSearchProvider(
    {
      runServerTool: async (_type, _name, _prompt, args) =>
        Array.from({ length: Number(args.count) - 6 }, (_, index) => ({
          link: `https://example.com/${index}`,
          title: `title ${index}`,
          content: `snippet ${index}`,
        })),
    },
    () => true,
  );
  const value = await provider.search({ query: 'verify', maxResults: 8 }, undefined);
  check('search result has no undefined-valued key', !hasUndefinedValue(value));
  check('truncated is an explicit boolean', value.truncated === false, `truncated=${String(value.truncated)}`);
  check('every source is fully defined', value.sources.every((source) => !hasUndefinedValue(source)));
  check('result stays within maxResults', value.sources.length <= 8, `${value.sources.length} source(s)`);
}

console.log('\nreal credential untouched');
{
  const after = { jwt: real.read(), deviceMid: real.deviceMid() };
  check('real jwt unchanged', after.jwt === before.jwt, before.jwt ? 'present' : 'was already absent');
  check('real device id unchanged', after.deviceMid === before.deviceMid);
}

const failed = results.filter((entry) => !entry.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length === 0 ? 0 : 1;
