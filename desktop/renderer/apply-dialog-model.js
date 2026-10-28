// The Jobs "Apply to jobs" dialog, pure: the count's bounds, the primary button's words, a mode pick and what Start sends. Guard: test/apply-dialog-mode.test.js.
import {modeBuilt} from './apply-settings-model.js';

/** The count as a whole number of jobs from 1 to 10, or null for anything else (empty, 0, 11, 1.5). */
export function validCount(value) {
  const n = value === '' || value == null ? NaN : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

/** The primary button: "Apply to 3 jobs" (owner, 28 Oct 2026: the dialog applies to jobs; it is not a settings editor). */
export function applyButtonLabel(count) {
  const n = validCount(count);
  return n ? `Apply to ${n} job${n === 1 ? '' : 's'}` : 'Apply to jobs';
}

/** A card pick: saved through Settings → Apply's writer (`save`), only for a built mode; the saved settings come back to draw. */
export async function applyDialogSelectMode({mode, save}) {
  if (!modeBuilt(mode)) return {ok: false};   // Why (28 Oct 2026, owner): a mode that does nothing yet can never be chosen or saved
  const saved = await save({mode});
  return saved?.apply ? {ok: true, settings: saved} : {ok: false, error: 'Could not save how Jobadabra applies. Try again.'};
}

/** Start: a valid count goes to the main process, which reads the saved mode itself after the first-choice gate (lib/apply-handlers.js). */
export async function applyDialogStart({count, cancelled = false, start}) {
  if (cancelled) return {cancelled: true};
  const n = validCount(count);
  if (!n) return {ok: false, error: 'Choose between 1 and 10 jobs.'};
  try { return await start({n, mode: 'settings'}); } catch (error) {
    // Why (2026-10-28, owner screenshot): a rejected call arrives as "Error invoking remote method 'apply': Error: <reason>"; the person gets the reason and what to do, not Electron's wrapper.
    const reason = String(error?.message || '').replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '').trim();
    return {ok: false, error: `Could not start applying: ${reason || 'something went wrong.'}${reason.endsWith('.') || !reason ? '' : '.'} Try again in a moment.`};
  }
}

/** One start at a time: a second press while the first batch starts is ignored; a later deliberate start is not. */
export function createApplyStartGate() {
  let starting = false;
  return {
    isStarting: () => starting,
    run: async start => {
      if (starting) return {ignored: true};   // Why (27 Oct 2026): a second click must not launch another set of Chrome tabs.
      starting = true;
      try { return await start(); }
      finally { starting = false; }
    },
  };
}
