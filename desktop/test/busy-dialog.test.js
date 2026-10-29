// whileBusy keeps the blocking dialog open exactly while the work runs, ignores Escape meanwhile, and closes it on failure too (renderer/busy-dialog.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {whileBusy} from '../renderer/busy-dialog.js';

// The parts of a <dialog> whileBusy touches, recording what happened to it.
function fakeDialog() {
  const parts = {'[data-busy-title]': {textContent: ''}, '[data-busy-note]': {textContent: ''}};
  const listeners = new Set();
  const dialog = {
    open: false, parts, listeners,
    querySelector: selector => parts[selector],
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
    showModal() { dialog.open = true; },
    close() { dialog.open = false; },
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

test('Escape is ignored while it runs, and the guard is removed after', async () => {
  const dialog = fakeDialog();
  let prevented = false;
  await whileBusy(dialog, {title: 'x'}, async () => { for (const listener of dialog.listeners) listener({preventDefault: () => { prevented = true; }}); });
  assert.equal(prevented, true);
  assert.equal(dialog.listeners.size, 0);
});

test('a work that throws still closes the dialog', async () => {
  const dialog = fakeDialog();
  await assert.rejects(whileBusy(dialog, {title: 'x'}, async () => { throw new Error('boom'); }), /boom/);
  assert.equal(dialog.open, false);
  assert.equal(dialog.listeners.size, 0);
});
