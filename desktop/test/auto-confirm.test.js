// Full automation is a mode the person picks and confirms: its runner is always 'background', and the confirmation is stamped on the mode and cleared when they leave it (renderer/apply-settings-model.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {applyOf, applyPatch, autoConfirmed, modeBuilt, modeRunner, needsAutoConfirm} from '../renderer/apply-settings-model.js';

test('Full automation has its runner in every build, and the old test seam is gone', () => {
  assert.equal(modeRunner('auto'), 'background');
  assert.equal(modeBuilt('auto'), true);
});

test('a confirmation is kept only while the mode is Full automation', () => {
  const confirmed = applyPatch({}, {mode: 'auto', autoConfirmedAt: '2026-10-29T10:00:00.000Z'}, {}).apply;
  assert.equal(confirmed.mode, 'auto');
  assert.equal(autoConfirmed({apply: confirmed}), true);
  const left = applyPatch({apply: confirmed}, {mode: 'check'}, {}).apply;
  assert.equal(left.autoConfirmedAt, '', 'leaving Full automation clears the confirmation');
  assert.equal(autoConfirmed({apply: left}), false);
});

test('a saved confirmation with another mode saved reads as not confirmed', () => {
  assert.equal(autoConfirmed({apply: {mode: 'fill', autoConfirmedAt: '2026-10-29T10:00:00.000Z'}}), false);
  assert.equal(applyOf({apply: {mode: 'auto'}}).autoConfirmedAt, '', 'no confirmation saved yet');
});

test('turning Full automation on asks first unless it is already confirmed or the change is not Full automation', () => {
  assert.equal(needsAutoConfirm({mode: 'auto'}, {apply: {mode: 'check'}}), true, 'a pick with no confirmation asks');
  assert.equal(needsAutoConfirm({mode: 'auto', autoConfirmedAt: '2026-10-29T10:00:00.000Z'}, {}), false, 'the dialog already stamped it');
  assert.equal(needsAutoConfirm({mode: 'auto'}, {apply: {mode: 'auto', autoConfirmedAt: '2026-10-29T10:00:00.000Z'}}), false, 'already confirmed');
  assert.equal(needsAutoConfirm({mode: 'fill'}, {}), false, 'another mode never asks');
});
