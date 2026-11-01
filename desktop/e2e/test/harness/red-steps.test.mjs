// A picked step renamed since the coverage map is no red: the suite's only try runs the whole suite once (26-27 Oct 2026: 19 of 54 reds). There is no retry of red steps any more.
import assert from 'node:assert/strict';
import test from 'node:test';
import {onlyRenamedPicks} from '../../red-steps.mjs';

const record = step => ({suite: 'quality', step, message: 'x'});

test('a suite-level stored-answer guard is a real red, never a renamed pick', () => {
  const guard = {suite: 'activityfailures', step: 'every backbone AI question had a stored answer',
    message: 'E2E_AI_ANSWER_MISSING: activityfailures: app.decide zürich has no stored answer'};
  assert.equal(onlyRenamedPicks([guard]), false, 'a genuine guard failure is not a renamed pick');
});

test('a red that is only a stale pick (a renamed step) runs the whole suite in the only try, not as a red (26-27 Oct 2026: 19 of 54 reds)', () => {
  assert.equal(onlyRenamedPicks([record('steps picked for this PR')]), true);
  assert.equal(onlyRenamedPicks([record('steps picked for this PR'), record('Automatic backup: the message names the file')]), false, 'a real red too: it stays red');
  assert.equal(onlyRenamedPicks([]), false, 'a crash before any step is a red');
  assert.equal(onlyRenamedPicks(null), false);
});
