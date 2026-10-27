// A red first try's retry repeats only its red steps and their setup (owner, 27 Oct 2026: "Retry only the red steps"). Main's quality 27 Oct 2026 (run
// 40440720029): one red step on the first try, then a whole-suite retry on fresh AI ran out of the 7-minute budget and called it "a real failure".
import assert from 'node:assert/strict';
import test from 'node:test';
import {onlyRenamedPicks, redSteps} from '../red-steps.mjs';

const record = step => ({suite: 'quality', step, message: 'x'});

test('the retry names exactly the steps that went red', () => {
  assert.deepEqual(redSteps([record('scoring the same jobs again gives the same scores (within 8 points)')]),
    ['scoring the same jobs again gives the same scores (within 8 points)']);
  assert.deepEqual(redSteps([record('a'), record('b'), record('a')]), ['a', 'b']);
});

test('a step not run for lack of time is red too, and is retried', () => {
  assert.deepEqual(redSteps([{suite: 'quality', step: 'no job text, CV text or secret reached the logs', message: 'not run: the suite was over its 7-minute budget'}]),
    ['no job text, CV text or secret reached the logs']);
});

test('the whole suite runs again when the red has no step to name', () => {
  assert.equal(redSteps([]), null);   // red with no failed step (a crash before the first step)
  assert.equal(redSteps(null), null);
  assert.equal(redSteps([record('steps picked for this PR')]), null);   // a picked name matched no step (renamed): only the whole suite can tell
});

test('a red that is only a stale pick (a renamed step) runs the whole suite in the first try, not as a red (26-27 Oct 2026: 19 of 54 reds)', () => {
  assert.equal(onlyRenamedPicks([record('steps picked for this PR')]), true);
  assert.equal(onlyRenamedPicks([record('steps picked for this PR'), record('Automatic backup: the message names the file')]), false, 'a real red too: the retry decides');
  assert.equal(onlyRenamedPicks([]), false, 'a crash before any step is a red');
  assert.equal(onlyRenamedPicks(null), false);
});
