// The ending and reason class of a left control (extension/ladder/control-ending.js): every fill cause lands in one class, every class in one of next-move's endings (a cause added without a line fails here).
import assert from 'node:assert/strict';
import test from 'node:test';
import {CAUSES} from '../../extension/fill-card.js';
import {ENDINGS, UNRESOLVED} from '../../extension/ladder/endings.js';
import {CAUSE_REASON, REASONS, REASON_ENDING, controlReason, isReason} from '../../extension/ladder/control-ending.js';

test('every fill cause has a reason class and every class names one of the endings', () => {
  for (const cause of CAUSES) assert.ok(isReason(CAUSE_REASON[cause]), `cause ${cause} has no reason class`);
  assert.deepEqual(Object.keys(CAUSE_REASON).filter(cause => !CAUSES.includes(cause)), [], 'no line for a cause that no longer exists');
  for (const reason of REASONS) assert.ok(ENDINGS.includes(REASON_ENDING[reason]), reason);
});

test('the field-level endings: blind for an unread question, data_missing for no answer, the try cap and the rest unresolved', () => {
  assert.deepEqual(controlReason({cause: 'unread'}), {reason: 'unread', ending: 'blind'});
  assert.deepEqual(controlReason({cause: 'no_data'}), {reason: 'no_answer', ending: 'data_missing'});
  assert.deepEqual(controlReason({cause: 'proposed'}), {reason: 'no_answer', ending: 'data_missing'});
  assert.deepEqual(controlReason({gaveUp: 'tries', cause: 'not_taken'}), {reason: 'tries', ending: UNRESOLVED}, 'the try cap names the control first');
  assert.deepEqual(controlReason({unread: true}), {reason: 'unread', ending: 'blind'});
  assert.deepEqual(controlReason({wants: 'phone'}), {reason: 'no_answer', ending: 'data_missing'});
  assert.deepEqual(controlReason({}), {reason: 'unknown', ending: UNRESOLVED});
});
