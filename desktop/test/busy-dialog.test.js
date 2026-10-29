// whileBusy keeps the blocking dialog open exactly while the work runs, ignores Escape meanwhile (a second Escape too), reopens a close that gets through, and closes on failure (renderer/busy-dialog.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {whileBusy} from '../renderer/busy-dialog.js';

// The parts of a <dialog> whileBusy touches, recording what happened to it; listeners are kept per event type.
function fakeDialog() {
  const parts = {'[data-busy-title]': {textContent: ''}, '[data-busy-note]': {textContent: ''}};
  const listeners = new Map();
  const dialog = {
    open: false, parts, listeners,
    querySelector: selector => parts[selector],
    addEventListener: (type, listener) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
    fire: (type, event = {}) => { for (const listener of [...(listeners.get(type) || [])]) listener({preventDefault() { event.prevented = true; }, ...event}); return event; },
    showModal() { dialog.open = true; },
    close() { dialog.open = false; dialog.fire('close'); },
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
  return dialog;
}

test('the dialog is open while the work runs and closed after, with the result passed on', async () => {
  const dialog = fakeDialog();
  let seenOpen = null;
  const result = await whileBusy(dialog, {title: 'Backing up…', note: 'Wait.'}, async () => { seenOpen = dialog.open; return {ok: true}; });
  assert.equal(seenOpen, true);
  assert.equal(dialog.open, false);
  assert.deepEqual(result, {ok: true});
  assert.equal(dialog.parts['[data-busy-title]'].textContent, 'Backing up…');
  assert.equal(dialog.parts['[data-busy-note]'].textContent, 'Wait.');
});

test('Escape is stopped while it runs: the cancel and the keydown, so a second Escape cannot close it (Gitar on #2466)', async () => {
  const dialog = fakeDialog();
  await whileBusy(dialog, {title: 'x'}, async () => {
    assert.equal(dialog.fire('cancel').prevented, true);
    assert.equal(dialog.fire('keydown', {key: 'Escape'}).prevented, true);
    assert.equal(dialog.fire('keydown', {key: 'Enter'}).prevented, undefined, 'other keys pass');
  });
  assert.equal(dialog.count(), 0, 'every listener is removed after');
});

test('a close that gets through while it runs reopens the dialog', async () => {
  const dialog = fakeDialog();
  await whileBusy(dialog, {title: 'x'}, async () => { dialog.close(); assert.equal(dialog.open, true); });
  assert.equal(dialog.open, false);
});

test('a work that throws still closes the dialog and removes its listeners', async () => {
  const dialog = fakeDialog();
  await assert.rejects(whileBusy(dialog, {title: 'x'}, async () => { throw new Error('boom'); }), /boom/);
  assert.equal(dialog.open, false);
  assert.equal(dialog.count(), 0);
});
