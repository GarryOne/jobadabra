// saveApply is the one save path (Settings, Jobs, first-Apply): a save that turns Full automation on asks first, a decline writes nothing, a confirm stamps the mode before the write (renderer/apply-save.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {saveApply} from '../renderer/apply-save.js';

const now = new Date('2026-10-29T10:00:00.000Z');
const fresh = {apply: {mode: 'check', chosenAt: ''}};

test('Full automation: a decline writes nothing and returns null (Not now)', async () => {
  const writes = [];
  const saved = await saveApply({change: {mode: 'auto'}, current: fresh, confirm: async () => false, write: async patch => { writes.push(patch); return patch; }, now});
  assert.equal(saved, null);
  assert.deepEqual(writes, [], 'nothing is written after a decline');
});

test('Full automation: a confirm stamps autoConfirmedAt on the same write', async () => {
  const writes = [];
  const saved = await saveApply({change: {mode: 'auto'}, current: fresh, confirm: async () => true, write: async patch => { writes.push(patch); return patch; }, now});
  assert.equal(writes.length, 1);
  assert.equal(writes[0].apply.mode, 'auto');
  assert.equal(writes[0].apply.autoConfirmedAt, now.toISOString());
  assert.equal(saved.apply.autoConfirmedAt, now.toISOString());
});

test('any other mode never asks and writes at once', async () => {
  let asked = false;
  const writes = [];
  await saveApply({change: {mode: 'fill'}, current: fresh, confirm: async () => { asked = true; return true; }, write: async patch => { writes.push(patch); return patch; }, now});
  assert.equal(asked, false);
  assert.equal(writes[0].apply.mode, 'fill');
});

test('an already confirmed Full automation saves without asking again', async () => {
  let asked = false;
  const confirmed = {apply: {mode: 'auto', autoConfirmedAt: '2026-10-29T09:00:00.000Z'}};
  await saveApply({change: {auto: {waitMin: 1}}, current: confirmed, confirm: async () => { asked = true; return true; }, write: async patch => patch, now});
  assert.equal(asked, false);
});

test('a failed write returns null, so the page knows nothing was saved', async () => {
  const saved = await saveApply({change: {mode: 'check'}, current: fresh, confirm: async () => true, write: async () => null, now});
  assert.equal(saved, null);
});
