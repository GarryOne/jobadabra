// Setup key validation stays offline only under the explicit e2e switch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {registerSetupHandlers} from '../lib/setup-handlers.js';
import {createStorage} from '../lib/storage.js';

const KEY = 'sk-ant-e2e-not-a-real-key';
function setup(t, e2e, outcome = 'accept', status = 200) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-setup-key-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const storage = createStorage(dir, {encrypt: value => value, decrypt: value => value});
  storage.saveSettings({anthropicKeyTest: outcome});
  const before = process.env.JOBADABRA_E2E;
  if (e2e) process.env.JOBADABRA_E2E = '1'; else delete process.env.JOBADABRA_E2E;
  t.after(() => { if (before === undefined) delete process.env.JOBADABRA_E2E; else process.env.JOBADABRA_E2E = before; });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({url: String(url), key: new Headers(init.headers).get('x-api-key')});
    return new Response(JSON.stringify(status === 200 ? {data: [], has_more: false, first_id: null, last_id: null} : {error: {type: 'authentication_error', message: 'invalid key'}}),
      {status, headers: {'content-type': 'application/json'}});
  });
  const handlers = new Map();
  registerSetupHandlers({storage, ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, handleImportant: () => {}, toWindow: () => {}});
  return {storage, calls, invoke: (name, ...args) => handlers.get(name)(null, ...args)};
}

test('e2e accepts a valid key and the save handler persists it without Anthropic', async t => {
  const {storage, calls, invoke} = setup(t, true);
  assert.deepEqual(await invoke('checkAnthropic', KEY), {ok: true});
  const saved = await invoke('saveSecret', 'ANTHROPIC_API_KEY', KEY);
  assert.equal(saved.ANTHROPIC_API_KEY, true);
  assert.equal(storage.secret('ANTHROPIC_API_KEY'), KEY);
  assert.equal(calls.length, 0);
});

test('e2e rejects a different key without Anthropic or saving a secret', async t => {
  const {storage, calls, invoke} = setup(t, true, 'reject');
  const result = await invoke('checkAnthropic', `${KEY}-rejected`);
  assert.equal(result.ok, false);
  assert.match(result.error, /This key was rejected/);
  assert.equal(storage.secret('ANTHROPIC_API_KEY'), '');
  assert.equal(calls.length, 0);
});

for (const [e2e, outcome] of [[false, 'accept'], [false, 'reject'], [true, null]]) {
  test(`real validator is called when ${e2e ? 'the key stub' : `e2e (${outcome})`} is off`, async t => {
    const {calls, invoke} = setup(t, e2e, outcome, 401);
    const result = await invoke('checkAnthropic', KEY);
    assert.equal(result.ok, false);
    assert.match(result.error, /This key was rejected/);
    assert.deepEqual(calls, [{url: 'https://api.anthropic.com/v1/models?limit=1', key: KEY}]);
  });
}
