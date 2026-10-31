// Guard the actual Electron launch boundary against inherited CI credentials without launching the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../lib/app.mjs', import.meta.url), 'utf8');
test('Electron launch options exclude CI secret names and values, including explicit overrides', async () => {
  const secret = 'fake-ci-secret-for-launch-test';
  const inherited = {PATH: '/test/bin', HOME: '/test/home', CI: 'true', DISPLAY: ':99', E2E_NOTION_TOKEN_APPLY: secret, E2E_ANTHROPIC_KEY: secret, ACTIONS_ID_TOKEN_REQUEST_TOKEN: secret, CI_CF_ANALYTICS_TOKEN: secret};
  const expression = source.match(/^    env: (.*),\s*\/\//m)?.[1];
  assert.ok(expression, 'inspect the actual launch env expression');
  const helpers = source.includes("'./app-env.mjs'") ? await import('../lib/app-env.mjs') : {};
  const env = vm.runInNewContext(`(${expression})`, {process: {env: inherited, pid: 123}, env: {TZ: 'UTC', E2E_OPENAI_KEY: secret}, profile: '/test/profile', port: {JOB_PILOTTO_PORT: '12345'}, ownerGuardEnv: () => ({}), hidden: () => '0', zoneOf: env => env.TZ, withoutWrappers: env => env, ...helpers});
  assert.equal(Object.values(env).includes(secret), false, 'no credential value reaches Playwright launch');
  for (const name of Object.keys(inherited).filter(name => !['PATH', 'HOME', 'CI', 'DISPLAY'].includes(name))) assert.equal(name in env, false, name);
  assert.equal(env.CI, 'true');
  assert.equal(env.DISPLAY, ':99');
  assert.equal(env.TZ, 'UTC');
  assert.equal(env.JOB_PILOTTO_PORT, '12345');
});

test('the launch allowlist rejects a real credential smuggled into a product hook', async () => {
  const {appLaunchEnv} = await import('../lib/app-env.mjs');
  assert.throws(() => appLaunchEnv({E2E_ANTHROPIC_KEY: 'fake-inherited-key'}, {JOB_PILOTTO_HOOK: 'fake-inherited-key'}), /CI credential override refused: E2E_ANTHROPIC_KEY/);
});

test('proxy credentials replace exact aliases only and never mutate app headers', async () => {
  const {APP_AI_ALIAS, NOTION_ALIAS, upstreamCredentials} = await import('../lib/proxy-credentials.mjs');
  const headers = {'x-api-key': APP_AI_ALIAS, authorization: `Bearer ${NOTION_ALIAS}`};
  const result = upstreamCredentials(headers, {[APP_AI_ALIAS]: 'fake-upstream-ai-key', [NOTION_ALIAS]: 'fake-upstream-notion-token'});
  assert.equal(result['x-api-key'], 'fake-upstream-ai-key');
  assert.equal(result.authorization, 'Bearer fake-upstream-notion-token');
  assert.equal(headers['x-api-key'], APP_AI_ALIAS);
  assert.equal(headers.authorization, `Bearer ${NOTION_ALIAS}`);
  assert.equal(upstreamCredentials({'x-api-key': `${APP_AI_ALIAS}-rejected`}, {[APP_AI_ALIAS]: 'fake-upstream-ai-key'})['x-api-key'], `${APP_AI_ALIAS}-rejected`);
});

test('both real proxy transports attach credentials only on the upstream hop', async t => {
  const http = await import('node:http');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-secret-proxy-'));
  const saved = {...process.env};
  Object.assign(process.env, {E2E_AI_ANSWERS: 'off', E2E_AI_CACHE: '', E2E_AI_REPLAY: '', E2E_ARTIFACTS: dir});
  t.after(() => { for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, saved); fs.rmSync(dir, {recursive: true, force: true}); });
  const {APP_AI_ALIAS, NOTION_ALIAS} = await import('../lib/proxy-credentials.mjs');
  const {startAiProxy} = await import('../lib/ai-proxy.mjs');
  const {startNotionProxy} = await import('../lib/notion-proxy.mjs');
  const forwarded = [];
  // Every upstream request is intercepted in memory; no provider or real account is contacted.
  t.mock.method(globalThis, 'fetch', async (url, options) => { forwarded.push({url, headers: options.headers}); return new Response('{"ok":true}', {headers: {'content-type': 'application/json'}}); });
  const ai = await startAiProxy({target: 'http://upstream.invalid', credentials: {[APP_AI_ALIAS]: 'fake-upstream-ai-key'}});
  const notion = await startNotionProxy({target: 'http://upstream.invalid', credentials: {[NOTION_ALIAS]: 'fake-upstream-notion-token'}});
  t.after(async () => { await ai.close(); await notion.close(); });
  const request = (url, headers) => new Promise((resolve, reject) => {
    const req = http.request(url, {method: 'POST', headers}, res => { let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve(data)); });
    req.on('error', reject); req.end('{}');
  });
  assert.equal(await request(`${ai.url}/v1/messages`, {'x-api-key': APP_AI_ALIAS}), '{"ok":true}');
  assert.equal(await request(`${notion.url}/v1/users/me`, {authorization: `Bearer ${NOTION_ALIAS}`}), '{"ok":true}');
  assert.equal(forwarded[0].headers['x-api-key'], 'fake-upstream-ai-key');
  assert.equal(forwarded[1].headers.authorization, 'Bearer fake-upstream-notion-token');
  await request(`${ai.url}/v1/responses`, {authorization: `Bearer ${APP_AI_ALIAS}`});
  assert.equal(forwarded[2].headers.authorization, 'Bearer fake-upstream-ai-key');
});

test('context consumers get only the Notion alias while stand-in tokens remain unchanged', async () => {
  const {contextNotionProxy} = await import('../lib/context.mjs');
  const {NOTION_ALIAS} = await import('../lib/proxy-credentials.mjs');
  const real = await contextNotionProxy({store: 'notion', token: 'fake-context-notion-token'});
  try {
    assert.equal(real.token, NOTION_ALIAS);
    assert.match(real.notion.url, /^http:\/\/127\.0\.0\.1:/);
  } finally { await real.notion.close(); }
  const fake = await contextNotionProxy({store: 'standin', standIn: {url: 'http://127.0.0.1:1'}, token: 'fake-standin-token'});
  assert.deepEqual(fake, {token: 'fake-standin-token'});
  assert.deepEqual(await contextNotionProxy({store: 'sqlite'}), {token: ''});
});

test('runtime allowlist preserves Windows names and supplies PATH for launch wrapper filtering', async () => {
  const {appLaunchEnv} = await import('../lib/app-env.mjs');
  const env = appLaunchEnv({ProgramFiles: '/programs', 'ProgramFiles(x86)': '/programs-x86', ProgramData: '/data', windir: '/windows', ComSpec: '/windows/cmd.exe', Path: '/windows/bin', E2E_NOTION_TOKEN: 'fake-windows-ci-token'});
  assert.equal(env.ProgramFiles, '/programs');
  assert.equal(env['ProgramFiles(x86)'], '/programs-x86');
  assert.equal(env.ProgramData, '/data');
  assert.equal(env.windir, '/windows');
  assert.equal(env.ComSpec, '/windows/cmd.exe');
  assert.equal(env.PATH, '/windows/bin');
  assert.equal('E2E_NOTION_TOKEN' in env, false);
});
