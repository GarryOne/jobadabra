// Why (27 Oct 2026 owner follow-up to Gitar review): address the review's setup-cost concern; entering setup must not generate before the person chooses Draft with AI.
// The wizard reuses the base-letter editor, explicit approval, PDF and fallback choice; no second editing state.
import {$} from './core.js';
import {loadLetter} from './base-letter.js';
let home = null, next = null;

/** Move the existing editor into setup; generation stays behind the editor's explicit Draft with AI action. */
export async function showLetterStep() {
  const editor = $('setting-letter'), slot = $('setup-letter-slot');
  if (!editor || !slot) return;
  if (!home) { home = editor.parentNode; next = editor.nextSibling; }
  slot.append(editor);
  editor.hidden = false;
  await loadLetter();
}

/** Restore the very same editor to Profile when setup leaves the cover-letter step. */
export function hideLetterStep() {
  if (!home) return;
  const editor = $('setting-letter');
  home.insertBefore(editor, next);
  editor.hidden = true;
  home = next = null;
}
