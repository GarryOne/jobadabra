// Session actions retire background automation before removal and never replace the site's observed receipt with a UI assertion.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerSessionHandlers} from '../lib/session-handlers.js';
import * as terminals from '../lib/terminals.js';

function actions(background) {
  const handlers = new Map();
  registerSessionHandlers({ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, appLog() {}, storage: {}, background: () => background});
  return (name, ...args) => handlers.get(name)({}, ...args);
}
function session() {
  terminals._reset();
  const row = terminals.startForm({id: 'fictional-action', url: 'https://jobs.example.test/app'});
  terminals.record(row.id).background = {mode: 'auto', state: 'waiting_to_submit'};
  return row;
}

test('removing a background session persists cancellation before forgetting its runtime identity', async () => {
  const row = session(), calls = [];
  const act = actions({cancel: async id => { assert.ok(terminals.get(id)); calls.push(id); return {ok: true}; }});
  await act('sessionRemove', row.id);
  assert.deepEqual(calls, [row.id]);
  assert.equal(terminals.get(row.id), null);
  terminals._reset();
});

test('a failed durable cancellation keeps the background session visible rather than leaving orphan automation', async () => {
  const row = session(), act = actions({cancel: async () => { throw new Error('store unavailable'); }});
  await assert.rejects(act('sessionRemove', row.id), /store unavailable/);
  assert.ok(terminals.get(row.id));
  terminals._reset();
});

test('the session finish button cannot mark a background application Applied without the site receipt', async () => {
  const row = session(), act = actions({});
  const result = await act('sessionFinish', row.id);
  assert.equal(result.ok, false);
  assert.match(result.error, /site.*confirm/i);
  assert.ok(terminals.get(row.id));
  terminals._reset();
});

test('Open in my browser on a hidden session keeps its hand-off for the job\'s addresses, then starts the same job in Chrome', async () => {
  const handlers = new Map(), kept = [], started = [];
  registerSessionHandlers({ipcMain: {handle: (name, fn) => handlers.set(name, fn)}, appLog() {}, storage: {}, extensionGate: () => null, review: {},
    apply: {applyOne: async (_storage, url) => { started.push(url); return {ok: true, session: terminals.startForm({id: 'chrome-1', url})}; }},
    keepHandoff: (handoff, addresses) => { kept.push([handoff.url, addresses]); return true; },
    background: () => ({handOver: async (id, read) => { assert.equal(typeof read, 'function'); return {ok: true, handoff: {url: 'https://jobs.example.test/app/step-2'}}; }})});
  for (const [name, ...rest] of [['sessionRestart'], ['sessionReopen', false]]) {
    kept.length = 0; started.length = 0;
    const row = session();
    const result = await handlers.get(name)({}, row.id, ...rest);
    assert.equal(result.ok, true, name);
    assert.equal(kept.length, 1, `${name}: one hand-off kept`);
    assert.equal(kept[0][0], 'https://jobs.example.test/app/step-2');
    assert.ok(kept[0][1].includes('https://jobs.example.test/app'), `${name}: kept under the job's own address`);
    assert.deepEqual(started, ['https://jobs.example.test/app'], `${name}: the same job opens in Chrome`);
    assert.equal(terminals.get(row.id), null, `${name}: the hidden session is gone`);
    assert.equal(terminals.get('chrome-1')?.background, null, `${name}: the new session is a Chrome one`);
  }
  terminals._reset();
});
