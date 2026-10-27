// The Jobs batch dialog's copy, eligibility and dispatch from the canonical Settings → Apply choice.
import {MODES, applyChosen, applyOf} from './apply-settings-model.js';

const modeById = new Map(MODES.map(mode => [mode.id, mode]));

// Returns the actual mode and action the Jobs dialog can offer without inventing a second selector.
export function applyDialogCopy(settings) {
  const apply = applyOf(settings), mode = apply.mode, chosen = applyChosen(settings);
  const title = modeById.get(mode)?.title || modeById.get('check').title;
  const available = mode === 'check';   // Why (27 Oct 2026, owner): only check has a batch runner in this build; fill and auto must not launch visible Chrome.
  const description = mode === 'check'
    ? 'Standard automation uses a visible Chrome tab. Jobadabra does not submit forms in this mode.'
    : mode === 'fill'
      ? 'Background filling is not available in this build. No jobs start in this mode.'
      : 'Full automation is not available in this build. No jobs start in this mode.';
  return {mode, title, description, available, chosen, canStart: available || !chosen};   // Why (27 Oct 2026, owner): an unconfirmed saved choice still needs to reach the first-Apply gate.
}

// Saves a card choice through the same Settings → Apply writer and verifies the returned canonical mode.
export async function applyDialogSelectMode({mode, save}) {
  if (!modeById.has(mode)) return {ok: false, error: 'Choose one of the available Apply modes.'};
  const saved = await save({mode});
  return saved?.apply && applyOf(saved).mode === mode ? {ok: true, settings: saved} : {ok: false, error: 'Could not save the selected Apply mode.'};
}

// Validates a requested batch and passes a settings token so the main process reads the mode again after the first-choice gate.
export async function applyDialogStart({settings, count, cancelled = false, start}) {
  if (cancelled) return {cancelled: true};
  const n = Number(count), copy = applyDialogCopy(settings);
  if (!Number.isInteger(n) || n < 1 || n > 10) return {ok: false, error: 'Choose between 1 and 10 jobs.'};
  if (!copy.canStart) return {ok: false, error: copy.description};   // Why (27 Oct 2026, owner): a confirmed unsupported mode cannot start any batch.
  return start({n, mode: 'settings'});   // Why (27 Oct 2026, owner): main resolves the mode after first-choice confirmation, before selecting a runner.
}

// Prevents overlapping batch starts while leaving later deliberate starts available after completion.
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
