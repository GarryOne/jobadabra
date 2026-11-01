// A sign-in page's "Sign in" press and the session's stage are waited on under the step's own clock, so a press that lands late is still seen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {boxesOf, missedPressNote} from '../lib/account-press.mjs';
import {stepClock, waitForStage} from '../lib/wait-on-state.mjs';

const clock = () => {
  let ms = 0;
  return {now: () => ms, pause: async tick => { ms += tick; }, log: () => {}};
};

// Main 3bd643e, runs 41262512109 and 41263356357 (1 Nov 2026): the extension's calls to the app took 16-38 s each on the runner, so "Sign in" reached the site
// 63-70 s after its page opened. The step's measured hang cap is 190 s; the step waited 60 s of its own and reported "never pressed".
test('a "Sign in" press that reaches the site 70 s after the page opened is seen, inside the step\'s clock', async () => {
  const time = clock();
  stepClock(190000);
  try {
    const presses = [];
    const read = async () => { if (time.now() >= 70000 && !presses.length) presses.push({email: 'ada.tester@example.test', password: 'x'}); return presses; };
    const {value, ms, error} = await waitForStage(read, list => list.length > 0, time);
    assert.equal(error, '');
    assert.equal(value.length, 1, 'the press was found');
    assert.equal(ms, 70000);
  } finally { stepClock(null); }
});

test('a press that never comes ends at the step\'s clock, not before, and returns what was last read', async () => {
  const time = clock();
  stepClock(190000);
  try {
    const {value, ms} = await waitForStage(async () => [], list => list.length > 0, time);
    assert.deepEqual(value, []);
    assert.ok(ms >= 180000 && ms <= 190000, `waited ${ms} ms`);
  } finally { stepClock(null); }
});

test('a read that keeps throwing ends at the clock and says what it threw', async () => {
  const time = clock();
  stepClock(30000);
  try {
    const {value, error} = await waitForStage(async () => { throw new Error('Execution context was destroyed\n  at x'); }, at => at?.stage === 'form', time);
    assert.equal(value, '');
    assert.equal(error, 'Execution context was destroyed');
  } finally { stepClock(null); }
});

test('a session read that throws while the page moves is read again, not a failure', async () => {
  const time = clock();
  let reads = 0;
  const {value} = await waitForStage(async () => { if (++reads < 3) throw new Error('execution context was destroyed'); return {stage: 'form'}; }, at => at?.stage === 'form', time);
  assert.equal(value.stage, 'form');
});

test('a missed press names the waits, the boxes and the extension\'s slow calls', () => {
  const decisions = [
    '2026-11-01T01:50:34.991Z [extension] page kind: account {"by":"ai"}',
    '2026-11-01T01:50:58.109Z [extension] log: slow push {"postMs":23775}',
    '2026-11-01T01:51:35.671Z [extension] log: slow push {"postMs":22337}',
    '2026-11-01T01:51:44.443Z [extension] fill: account button: pressed {"host":"e2e.recruitee.com"}',
  ].join('\n');
  const note = missedPressNote({what: '"Sign in"', waitedMs: 60000, email: 'filled', password: 'filled', decisions});
  assert.match(note, /"Sign in" was not pressed within 60 s/);
  assert.match(note, /email box filled, password box filled/);
  assert.match(note, /slow push[^\n]*23775/, 'the extension\'s slow calls are in the failure');
  assert.match(note, /account button: pressed/, 'a press the extension made after the wait is named');
});

test('a box that cannot be read says why, not "?"', async () => {
  const tab = {locator: () => ({inputValue: async () => { throw new Error('Target closed'); }})};
  assert.deepEqual(await boxesOf(tab, 'a@b.test'), {email: 'unreadable: Target closed', password: 'unreadable: Target closed'});
  const open = {locator: selector => ({inputValue: async () => (selector === '#signin_email' ? 'a@b.test' : '')})};
  assert.deepEqual(await boxesOf(open, 'a@b.test'), {email: 'filled', password: 'empty'});
});

test('no account-flow wait in the journeys has a number of seconds of its own', () => {
  const source = fs.readFileSync(new URL('../lib/apply-journeys.mjs', import.meta.url), 'utf8');
  const own = source.split('\n').filter(line => /for \(let waited = 0; [^;]*waited < \d+/.test(line) && /pressesOf|\bat\??\.(stage|stuck)/.test(line));
  assert.deepEqual(own, [], 'the step\'s clock is the only clock for the press and the session stage (lib/wait-on-state.mjs waitForStage)');
});
