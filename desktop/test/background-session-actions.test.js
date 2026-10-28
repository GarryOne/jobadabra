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
