// A job that blocks the app shows one centered dialog over every screen until it ends (owner, 29 Oct 2026: the clear-jobs wait was "a thin strip, misplaced"); the result is a toast.

/**
 * Shows the modal `dialog` with `title` and `note`, runs `work()`, and closes the dialog when it settles (also when it throws).
 * Escape does not close it: the person cannot leave a step that is still writing. Resolves to what `work` returns.
 * Invariant: the dialog is open exactly while `work` runs.
 */
export async function whileBusy(dialog, {title, note = ''}, work) {
  dialog.querySelector('[data-busy-title]').textContent = title;
  dialog.querySelector('[data-busy-note]').textContent = note;
  const keepOpen = event => event.preventDefault();
  dialog.addEventListener('cancel', keepOpen);
  dialog.showModal();
  try { return await work(); }
  finally { dialog.removeEventListener('cancel', keepOpen); dialog.close(); }
}
