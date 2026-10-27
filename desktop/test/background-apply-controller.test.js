// Full automation is not shipped in step A: the controller refuses to queue it, so no browser starts and nothing can reach a submit reservation.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createBackgroundApplyController} from '../lib/background-apply-controller.js';

const touched = [];
const spy = name => (...args) => { touched.push(name); return args; };
const make = (options = {}) => createBackgroundApplyController({}, {
  store: {queue: spy('store.queue')}, browser: {start: spy('browser.start')}, terminals: {list: () => [], byUrl: () => null, startForm: spy('terminals.startForm')},
  config: () => ({mode: 'auto', chosenAt: '2026-10-28T10:00:00Z'}), ...options});

test('Full automation cannot be queued before its gates ship: no store write, no browser, no session', async () => {
  const result = await make().enqueue([{url: 'https://jobs.example.test/a'}], 'auto');
  assert.equal(result.ok, false);
  assert.match(result.error, /Full automation is not available/);
  assert.deepEqual(touched, []);
});
