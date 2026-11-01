// lib/row-end.mjs: when a row replay may end (npm run row, the recorded-pages job): the page and the extension are quiet, the live run's presses are made, and no cold ask is waiting out its retries.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {activityOf, mayEnd} from '../../lib/row-end.mjs';

const base = {quietMs: 0, stillMs: 10000, followed: 0, livePresses: 0, firstMissMs: null, nowMs: 100000};

test('a quiet page ends the replay; a page still changing does not', () => {
  assert.equal(mayEnd({...base, quietMs: 10000}), 'still');
  assert.equal(mayEnd({...base, quietMs: 9999}), '');
  assert.equal(mayEnd({...base, quietMs: 0}), '');
});

test('never before the live run\'s last press is made: quiet with presses left waits, up to three times as long', () => {
  assert.equal(mayEnd({...base, quietMs: 10000, followed: 1, livePresses: 2}), '', 'a press is still to come');
  assert.equal(mayEnd({...base, quietMs: 30000, followed: 1, livePresses: 2}), 'still, presses not made', 'it never came: the finding is the unmade press');
  assert.equal(mayEnd({...base, quietMs: 10000, followed: 2, livePresses: 2}), 'still');
});

test('a cold ask (not in the kept answers) is already a failure of the case: the replay ends 15 s after the first, not at the cap', () => {
  assert.equal(mayEnd({...base, firstMissMs: 90000, nowMs: 100000}), '');
  assert.equal(mayEnd({...base, firstMissMs: 80000, nowMs: 95000}), 'cold ask');
});

test('the panel\'s 2 s heartbeat (the same review or tabs body again) is not activity; a new body or any other request is', () => {
  const beat = body => ({route: '/extension/review', body});
  const one = activityOf([beat('a'), {route: '/extension/run', body: '{}'}]);
  assert.equal(activityOf([beat('a'), {route: '/extension/run', body: '{}'}, beat('a'), beat('a')]), one, 'the same body again');
  assert.notEqual(activityOf([beat('a'), beat('b'), {route: '/extension/run', body: '{}'}]), one, 'a changed page state');
  assert.notEqual(activityOf([beat('a'), {route: '/extension/run', body: '{}'}, {route: '/extension/kit', body: '{}'}]), one, 'another route');
  assert.notEqual(activityOf([{route: '/extension/tabs', body: 'x'}]), activityOf([{route: '/extension/tabs', body: 'x'}, {route: '/extension/tabs', body: 'y'}]), 'a new tabs body');
});
