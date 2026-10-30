// The judge's answer becomes the mode table's flags; an unknown flag is null, never a guessed false (lib/triage-read.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFromJudge} from '../lib/triage-read.js';

test('a robot check in the judge answer is a captcha flag; the rest stays unknown', () => {
  assert.deepEqual(readFromJudge({answer: 'ready', botCheck: true}), {eligible: true, captcha: true, login: null, accountCreation: null, allFactsSaved: null});
  assert.deepEqual(readFromJudge({answer: 'ready', botCheck: false}).captcha, false);
});

test('a failed judge reads nothing: every flag unknown', () => {
  assert.deepEqual(readFromJudge({error: 'no AI'}), {eligible: true, captcha: null, login: null, accountCreation: null, allFactsSaved: null});
  assert.deepEqual(readFromJudge(undefined, {eligible: false}).eligible, false);
});

test('the judge login and account answers become flags; saved facts come from the caller, not the judge', () => {
  const read = readFromJudge({answer: 'ready', botCheck: false, loginWall: true, accountCreation: false}, {allFactsSaved: true});
  assert.deepEqual([read.login, read.accountCreation, read.allFactsSaved], [true, false, true]);
  assert.equal(readFromJudge({answer: 'ready', botCheck: false}).login, null);
  assert.equal(readFromJudge({answer: 'ready', botCheck: false, loginWall: false, accountCreation: false}).allFactsSaved, null, 'no saved-facts answer: unknown');
});
