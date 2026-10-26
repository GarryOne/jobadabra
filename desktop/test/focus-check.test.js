// The Focus "quick check" line: shown only while a captcha is held, for the sites waiting. Guard for pages/check-rows.js.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checksOf, checkLine, CHECK_WAIT_MS} from '../renderer/pages/check-rows.js';

test('the line lists the held checks that are not too old, and nothing when none is held', () => {
  const now = 1_000_000_000, fresh = {host: 'jobs.coop.ch', at: now - 60000}, old = {host: 'old.example.ch', at: now - CHECK_WAIT_MS - 1};
  assert.deepEqual(checksOf({refusedCheckWaiting: [fresh, old]}, now), ['jobs.coop.ch']);
  assert.deepEqual(checksOf(undefined, now), []);
  assert.equal(checkLine(['jobs.coop.ch']), 'jobs.coop.ch wants a quick check from you');
  assert.equal(checkLine(['a.ch', 'b.ch']), '2 sites want a quick check from you');
});
