import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {extensionReady} from '../lib/extension-ready.js';

test('a show asked before the extension checked in waits for it, and gives up after the limit', async () => {
  let calls = 0;
  const sleep = async () => {};
  assert.deepEqual(await extensionReady(() => ({at: 1}), {sleep}), {waited: 0, seen: true});
  assert.deepEqual(await extensionReady(() => (++calls > 3 ? {at: 1} : null), {sleep, step: 500}), {waited: 1000, seen: true});
  assert.deepEqual(await extensionReady(() => null, {sleep, ms: 2000, step: 500}), {waited: 2000, seen: false});
});

test('the form show waits for the first check-in before it looks for a page', () => {
  const source = fs.readFileSync(new URL('../lib/apply-handlers.js', import.meta.url), 'utf8');
  const ready = source.indexOf('await extensionReady(server.extensionHeard'), asked = source.indexOf('let taken = await review.delivered(key, 4000)');
  assert.ok(ready > 0 && ready < asked, 'extensionReady before the page is asked');
});
