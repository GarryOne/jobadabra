// The one save path for the apply settings (Settings, Jobs and the first-Apply dialog): a save that turns Full automation on asks first, and a "Not now" writes nothing (Gitar on #2471). Dependencies are passed in so a test runs this exact function.
import {applyPatch, needsAutoConfirm} from './apply-settings-model.js';

/**
 * Saves `change` onto `current`. When it turns Full automation on without a confirmation, `confirm()` must resolve true first; a decline resolves null and calls `write` never.
 * `write(patch)` receives the whole apply patch and resolves the saved settings, or null when the save failed.
 */
export async function saveApply({change = {}, chosen = false, current, confirm, write, now = new Date()}) {
  let next = change;
  if (needsAutoConfirm(change, current)) {
    if (!await confirm()) return null;
    next = {...change, autoConfirmedAt: now.toISOString()};
  }
  return write(applyPatch(current, next, {chosen, now}));
}
