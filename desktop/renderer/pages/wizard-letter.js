// The wizard uses the existing base-letter editor, including its generation, explicit approval, PDF and fallback choice; no second editing state.
import {$} from './core.js';
import {loadLetter, draftLetterForSetup} from './base-letter.js';
let home = null, next = null;

/** Move the existing editor into setup. Start a first draft through the existing action; approval is always the person's. */
export async function showLetterStep() {
  const editor = $('setting-letter'), slot = $('setup-letter-slot');
  if (!editor || !slot) return;
  if (!home) { home = editor.parentNode; next = editor.nextSibling; }
  slot.append(editor);
  editor.hidden = false;
  await loadLetter();
  if (editor.parentNode === slot) await draftLetterForSetup();
}

/** Restore the very same editor to Profile when setup leaves the cover-letter step. */
export function hideLetterStep() {
  if (!home) return;
  const editor = $('setting-letter');
  home.insertBefore(editor, next);
  editor.hidden = true;
  home = next = null;
}
