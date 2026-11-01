// The end-to-end journey records which calls the window made to the app and how long each took (so a click that reaches nothing, or an action that takes seconds with no
// sign of work, can be told apart from a working one). Only with JOBADABRA_E2E: main.js wraps ipcMain.handle with this.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {recordIpc} from '../lib/e2e-ipc.js';

test('a wrapped handler still answers, and its call is logged with its channel and duration', async () => {
  const log = [], registered = {};
  const handle = recordIpc((channel, fn) => { registered[channel] = fn; }, log);
  handle('slow', async (_event, value) => { await new Promise(resolve => setTimeout(resolve, 30)); return value * 2; });
  const pending = registered.slow({}, 21);
  assert.equal(log.length, 1);
  assert.equal(log[0].channel, 'slow');
  assert.equal(log[0].ms, null, 'still running');
  assert.equal(await pending, 42);
  assert.ok(log[0].ms >= 25, `duration ${log[0].ms}`);
});

test('a handler that throws is logged and the error still reaches the window', async () => {
  const log = [], registered = {};
  recordIpc((channel, fn) => { registered[channel] = fn; }, log)('boom', () => { throw new Error('no'); });
  await assert.rejects(async () => registered.boom({}), /no/);
  assert.equal(log[0].failed, true);
  assert.equal(typeof log[0].ms, 'number');
});

test('the log keeps only the newest calls', () => {
  const log = [], registered = {};
  recordIpc((channel, fn) => { registered[channel] = fn; }, log, 5)('a', () => 1);
  for (let i = 0; i < 12; i++) registered.a({});
  assert.equal(log.length, 5);
});

test('calls since a mark still show once the log is full (UI loop #70: every later control looked dead)', () => {
  const log = [], registered = {};
  recordIpc((channel, fn) => { registered[channel] = fn; }, log, 5)('a', () => 1);
  for (let i = 0; i < 12; i++) registered.a({});
  const mark = log.at(-1).seq;
  registered.a({});
  assert.equal(log.length, 5, 'full: the length no longer grows');
  assert.equal(log.filter(call => call.seq > mark).length, 1);
});
