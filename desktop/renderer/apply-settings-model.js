// Settings → Apply (owner, 26 Oct 2026, hybrid fill step 2): how Jobadabra applies for the person, kept in settings.apply and read by the window
// (pages/apply-settings.js, pages/apply-choice.js) and the app (lib/apply-choice-gate.js). Pure. The consent switch (acceptConsents) and accounts
// (accountAutomation) keep their own keys: the extension reads them. Guard: test/apply-settings.test.js.

// Why (27 Oct 2026, owner): approved labels state browser visibility and who submits; persisted mode IDs stay stable.
// runner: the batch runner the main process starts for the mode (lib/apply-handlers.js); a mode with none is not built. Why (28 Oct 2026, owner, #2317
// rework): a mode not built is drawn disabled with "Coming soon" and can never be the saved mode, so no screen offers a choice that does nothing.
// The PR that ships a mode's runner names it here.
export const MODES = Object.freeze([
  {id: 'check', icon: 'eye', title: 'Standard automation', badge: ['Best quality', 'good'], runner: 'chrome',
    text: 'Fills in a visible browser; you review and submit.'},
  {id: 'fill', icon: 'layers', title: 'Background automation', runner: 'background',
    text: 'Fills in a hidden browser; you review and submit when ready.'},
  {id: 'auto', icon: 'zap', title: 'Full automation', badge: ['More applications, lower quality', 'warn'],
    text: 'Fills and submits in a hidden browser when your checks pass.'},
]);
export const MODE_IDS = MODES.map(mode => mode.id);
/** The batch runner of the mode with this id, or '' when it is not built in this version (or unknown). */
export const modeRunner = id => MODES.find(mode => mode.id === id)?.runner || '';
/** True when the mode with this id runs in this version; an unknown id is not built. */
export const modeBuilt = id => !!modeRunner(id);

export const ANSWERS = Object.freeze([
  {id: 'facts', label: 'Only from my saved facts'},
  {id: 'ai', label: 'Let the AI guess the rest'},
]);
export const ANSWERS_TEXT = {
  facts: 'A question your Profile does not answer stays empty for you, with the AI\'s suggestion beside it.',
  ai: 'The AI answers what your Profile does not cover. You see which answers it wrote.',
};

// Full automation's checks: each one the person's to change (CLAUDE.md "The app submits only in Full automation").
export const AUTO_DEFAULTS = Object.freeze({minFit: 80, noEmpty: true, factsOnly: true, perDay: 20, perEmployer: 1, waitMin: 2});   // Why (2026-10-28, owner: "Why 10 minutes? Why not 1 minute?", chose 2): the wait is a review window before an irreversible Submit, not bot evasion; long enough to see the notice and press Stop, short enough for a batch; the person's to change
const LIMITS = {minFit: [0, 100], perDay: [1, 200], perEmployer: [1, 20], waitMin: [0, 120]};
const clamp = (key, value) => {
  const [low, high] = LIMITS[key], n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : AUTO_DEFAULTS[key];
};

// settings -> {mode, answers, auto, chosenAt}: nothing saved yet is Standard automation (pre-selected, owner 26 Oct 2026) with facts only.
// Invariant: mode is always a built mode; an older save of one not built yet reads as Standard automation, the mode that runs and the cards show.
export function applyOf(settings) {
  const saved = settings?.apply || {}, auto = {...AUTO_DEFAULTS};
  for (const key of Object.keys(AUTO_DEFAULTS)) {
    if (!(key in (saved.auto || {}))) continue;
    auto[key] = key in LIMITS ? clamp(key, saved.auto[key]) : saved.auto[key] !== false;
  }
  return {mode: modeBuilt(saved.mode) ? saved.mode : 'check', answers: saved.answers === 'ai' ? 'ai' : 'facts', auto, chosenAt: saved.chosenAt || ''};
}
export const applyChosen = settings => !!settings?.apply?.chosenAt;
/** Background automation (the mode that runs in Jobadabra's own browser) is the saved mode, so the Applying page offers that browser's download. One rule for the start-up and for a change in Settings. */
export const needsBrowser = settings => applyOf(settings).mode === 'fill';

// The settings patch for a change: the whole apply object (saveSettings merges one level). `chosen` stamps the confirmation.
export function applyPatch(settings, change = {}, {chosen = false, now = new Date()} = {}) {
  const current = applyOf(settings);
  const next = {...current, ...change, auto: {...current.auto, ...(change.auto || {})}};
  return {apply: applyOf({apply: {...next, chosenAt: chosen ? now.toISOString() : current.chosenAt}})};
}
