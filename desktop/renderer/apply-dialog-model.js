// The Jobs batch dialog's copy, eligibility and dispatch from the canonical Settings → Apply choice.
import {MODES, applyChosen, applyOf} from './apply-settings-model.js';

const modeById = new Map(MODES.map(mode => [mode.id, mode]));

// Returns the actual mode and action the Jobs dialog can offer without inventing a second selector.
export function applyDialogCopy(settings) {
  const apply = applyOf(settings), mode = apply.mode, chosen = applyChosen(settings);
  const title = modeById.get(mode)?.title || modeById.get('check').title;
  const available = mode === 'check';   // Why (27 Oct 2026, owner): only check has a batch runner in this build; fill and auto must not launch visible Chrome.
  const description = mode === 'check'
    ? 'Each selected job opens in a Chrome tab. The extension fills eligible forms; you review every tab and press Submit. No form is submitted for you.'
    : mode === 'fill'
      ? 'Fill for me, I press Submit is saved, but background filling is not available in this build. No jobs start in this mode; change the mode in Settings → Apply to use I check each form.'
      : 'Full automation is saved, but its background fill-and-send runner is not available in this build. No jobs start in this mode; change the mode in Settings → Apply to use I check each form.';
  return {mode, title, description, available, chosen, canStart: available || !chosen};   // Why (27 Oct 2026, owner): an unconfirmed saved choice still needs to reach the first-Apply gate.
}

// Validates a requested batch and passes a settings token so the main process reads the mode again after the first-choice gate.
export async function applyDialogStart({settings, count, cancelled = false, start}) {
  if (cancelled) return {cancelled: true};
  const n = Number(count), copy = applyDialogCopy(settings);
  if (!Number.isInteger(n) || n < 1 || n > 10) return {ok: false, error: 'Choose between 1 and 10 jobs.'};
  if (!copy.canStart) return {ok: false, error: copy.description};   // Why (27 Oct 2026, owner): a confirmed unsupported mode cannot start any batch.
  return start({n, mode: 'settings'});   // Why (27 Oct 2026, owner): main resolves the mode after first-choice confirmation, before selecting a runner.
}
