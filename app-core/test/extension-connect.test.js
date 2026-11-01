// The extension reconnects to the app by itself when the app's token changed (reinstall, reset, another
// Notion workspace), and says why when it can't, instead of filling nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const stored = {};
globalThis.chrome = { storage: { local: { set: async (v) => Object.assign(stored, v), get: async () => stored } } };
const { api, NOT_CONNECTED } = await import('../../extension/flow.js');

function app(token) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(url.replace('http://127.0.0.1:47111', ''));
    if (url.endsWith('/extension/pair')) return Response.json({ url: 'http://127.0.0.1:47111', token });
    const ok = init.headers?.Authorization === `Bearer ${token}`;
    return Response.json(ok ? { kit: 'yes' } : { error: 'Wrong token' }, { status: ok ? 200 : 401 });
  };
  return calls;
}

test('a stale token reconnects once, retries and keeps the new token', async () => {
  const calls = app('new');
  const config = { workerUrl: 'http://127.0.0.1:47111', token: 'old' };
  assert.deepEqual(await api(config, '/extension/kit'), { kit: 'yes' });
  assert.deepEqual(calls, ['/extension/kit', '/extension/pair', '/extension/kit']);
  assert.equal(config.token, 'new');
  assert.equal(stored.token, 'new');
});

test('no token yet: connects first', async () => {
  const calls = app('t1');
  assert.deepEqual(await api({ workerUrl: '', token: '' }, '/extension/me'), { kit: 'yes' });
  assert.deepEqual(calls, ['/extension/pair', '/extension/me']);
});

test('still turned down after reconnecting: a clear error, no loop', async () => {
  const calls = app('same');
  globalThis.fetch = ((inner) => async (url, init) => (url.endsWith('/pair') ? inner(url, init)
    : Response.json({ error: 'Wrong token' }, { status: 401 })))(globalThis.fetch);
  await assert.rejects(api({ workerUrl: 'http://127.0.0.1:47111', token: 'x' }, '/extension/kit'), { message: NOT_CONNECTED, status: 401 });
  assert.ok(calls.length <= 3);
});

test('your own Worker never tries to pair with the app', async () => {
  const calls = app('t');
  await assert.rejects(api({ workerUrl: 'https://bot.example', token: 'x' }, '/extension/kit'), { status: 401 });
  assert.deepEqual(calls, ['https://bot.example/extension/kit']);
});
