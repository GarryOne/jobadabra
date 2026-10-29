// The page loading wait reports the first visible indicator on timeout without changing its result or success delay.
import assert from 'node:assert/strict';
import test from 'node:test';
import {settle} from '../lib/app.mjs';

test('a timeout names the first visible indicator and still returns false without sleeping', async t => {
  const lines = [];
  t.mock.method(console, 'log', line => lines.push(line));
  const hidden = {offsetParent: null}, visible = {offsetParent: {}, id: '', className: 'spinner small', parentElement: {id: 'iv-setup'}};
  const before = globalThis.document;
  t.after(() => { if (before === undefined) delete globalThis.document; else globalThis.document = before; });
  globalThis.document = {querySelectorAll: () => [hidden, visible]};
  const page = {waitForFunction: async (_fn, _arg, options) => { assert.equal(options.timeout, 20000); throw new Error('Timeout'); },
    evaluate: async fn => fn(), waitForTimeout: () => assert.fail('no sleep after timeout')};
  assert.equal(await settle(page), false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /20.*#iv-setup.*spinner small/);
});

test('a settled page keeps its 400 ms delay and returns true', async () => {
  const delays = [];
  assert.equal(await settle({waitForFunction: async () => {}, waitForTimeout: async ms => delays.push(ms)}), true);
  assert.deepEqual(delays, [400]);
});

test('a closed page still returns false and logs just one diagnostic', async t => {
  const lines = [];
  t.mock.method(console, 'log', line => lines.push(line));
  const page = {waitForFunction: async () => { throw new Error('closed'); }, evaluate: async () => { throw new Error('closed'); }};
  assert.equal(await settle(page), false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /unavailable/);
});

test('a successful read with no loader reports none visible now', async t => {
  const lines = [];
  t.mock.method(console, 'log', line => lines.push(line));
  const page = {waitForFunction: async () => { throw new Error('Timeout'); }, evaluate: async () => null};
  assert.equal(await settle(page), false);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /none visible now/);
  assert.doesNotMatch(lines[0], /unavailable/);
});
