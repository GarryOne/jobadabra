// A job that blocks the app shows one centered dialog over every screen until it ends (owner, 29 Oct 2026: the clear-jobs wait was "a thin strip, misplaced"); the result is a toast.

/**
 * Shows the modal `dialog` with `title` and `note`, runs `work()`, and closes the dialog when it settles (also when it throws).
 * Escape does not close it while `work` runs: a Chromium CloseWatcher can take a second Escape after the first is cancelled, so the
 * keydown is stopped too, and a close that gets through reopens the dialog (Gitar on #2466). Resolves to what `work` returns.
 * Invariant: the dialog is open exactly while `work` runs.
 */
export async function whileBusy(dialog, {title, note = ''}, work) {
  dialog.querySelector('[data-busy-title]').textContent = title;
  dialog.querySelector('[data-busy-note]').textContent = note;
  let busy = true;
  const keepOpen = event => event.preventDefault();
  const stopEscape = event => { if (event.key === 'Escape') event.preventDefault(); };
  const reopen = () => { if (busy && !dialog.open) dialog.showModal(); };
  dialog.addEventListener('cancel', keepOpen);
  dialog.addEventListener('keydown', stopEscape);
  dialog.addEventListener('close', reopen);
  dialog.showModal();
  try { return await work(); }
  finally {
    busy = false;
    dialog.removeEventListener('cancel', keepOpen);
    dialog.removeEventListener('keydown', stopEscape);
    dialog.removeEventListener('close', reopen);
    dialog.close();
  }
}
