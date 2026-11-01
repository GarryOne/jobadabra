// The setup wizard's AI step, layer 2, the half the demo window cannot play (it blocks every key check and Free AI, lib/demo.js): what the app's own handlers do with a key or an
// engine the person picked, on a temp folder with a stand-in for the key check and no real network. The step's screen is screen-wizard.test.js. Moved from the e2e `wizard` suite
// (1 Nov 2026): an invalid key is refused without saving, a valid OpenAI key is accepted and saved, Free AI is chosen and the app is on it. The Anthropic key saved by the
// journey ("key saved") STAYS in e2e.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {registerSetupHandlers} from '../../lib/setup-handlers.js';
import {createStorage} from '../../lib/storage.js';

const ANTHROPIC = 'sk-ant-integration-not-a-real-key';
const OPENAI = 'sk-integration-not-a-real-key';

/** The wizard's handlers on a fresh temp folder; `env` is set for the test and put back. -> {storage, invoke}. */
function wizardApp(t, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-wizard-'));
  const saved = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    fs.rmSync(dir, {recursive: true, force: true});
  });
  const storage = createStorage(dir, {encrypt: value => value, decrypt: value => value});
  const handlers = new Map();
  registerSetupHandlers({storage, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, handleImportant: () => {}, toWindow: () => {}});
  return {storage, invoke: (name, ...args) => handlers.get(name)(null, ...args)};
}

/** A stand-in for OpenAI's key check (GET /v1/models): answers 200 for the one valid key and 401 for any other. -> {url, close}. */
async function openAiStandIn(t, valid) {
  const server = http.createServer((req, res) => {
    const ok = req.headers.authorization === `Bearer ${valid}`;
    res.writeHead(ok ? 200 : 401, {'content-type': 'application/json'});
    res.end(JSON.stringify(ok ? {object: 'list', data: []} : {error: {message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key'}}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}

test('an invalid API key is rejected without saving: the words name the key, no secret and no engine change', async t => {
  const {storage, invoke} = wizardApp(t, {JOBADABRA_E2E: '1'});
  storage.saveSettings({anthropicKeyTest: 'reject'});
  const result = await invoke('checkAnthropic', `${ANTHROPIC}-rejected`);
  assert.equal(result.ok, false);
  assert.match(result.error, /This key was rejected\. Copy it again from console\.anthropic\.com\./);
  assert.equal(storage.secret('ANTHROPIC_API_KEY'), '');
  assert.equal(storage.settings().aiEngine, undefined);
});

test('a pasted text that is not a key is refused with words', async t => {
  const {invoke} = wizardApp(t);
  const result = await invoke('checkOpenAI', 'not a key\nnext line');
  assert.equal(result.ok, false);
  assert.ok(result.error, 'no words for the person');
});

test('a valid OpenAI API key is accepted and saved, and the engine becomes OpenAI', async t => {
  const base = await openAiStandIn(t, OPENAI);
  const {storage, invoke} = wizardApp(t, {OPENAI_BASE_URL: base});
  assert.deepEqual(await invoke('checkOpenAI', OPENAI), {ok: true});
  const secrets = await invoke('saveSecret', 'OPENAI_API_KEY', OPENAI);
  assert.equal(secrets.OPENAI_API_KEY, true);
  await invoke('setAiEngine', 'openai');
  assert.equal(storage.secret('OPENAI_API_KEY'), OPENAI);
  assert.equal(storage.settings().aiEngine, 'openai');
});

test('an OpenAI key the check refuses says so in words and is not saved', async t => {
  const base = await openAiStandIn(t, OPENAI);
  const {storage, invoke} = wizardApp(t, {OPENAI_BASE_URL: base});
  const result = await invoke('checkOpenAI', `${OPENAI}-wrong`);
  assert.equal(result.ok, false);
  assert.match(result.error, /This key was rejected\. Copy it again from platform\.openai\.com/);
  assert.equal(storage.secret('OPENAI_API_KEY'), '');
});

test('Free AI is chosen: the app keeps the Free key, is on Free AI, and its engine is the API one', async t => {
  const {storage, invoke} = wizardApp(t, {JOBADABRA_E2E: '1', JOBADABRA_E2E_FREE_AI_KEY: 'JPF1.integration.relay'});
  assert.deepEqual(await invoke('startFreeAi'), {ok: true});
  const {aiFree, aiEngine} = storage.settings();
  assert.deepEqual({aiFree, aiEngine}, {aiFree: true, aiEngine: 'api'});
  assert.equal(storage.secret('ANTHROPIC_API_KEY'), 'JPF1.integration.relay');
});

test('Codex and Claude Code are kept as the engine, each with its one-time notice answered', async t => {
  const {storage, invoke} = wizardApp(t);
  await invoke('setAiEngine', 'codex');
  assert.deepEqual([storage.settings().aiEngine, storage.settings().codexNotice], ['codex', true]);
  await invoke('setAiEngine', 'cli');
  assert.deepEqual([storage.settings().aiEngine, storage.settings().claudeCodeNotice], ['cli', true]);
});
