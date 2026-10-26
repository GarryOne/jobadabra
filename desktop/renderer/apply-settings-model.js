// Settings → Apply (owner, 26 Oct 2026, hybrid fill step 2): how Jobadabra applies for the person, kept in settings.apply and read by the window
// (pages/apply-settings.js, pages/apply-choice.js) and the app (lib/apply-choice-gate.js). Pure. The consent switch (acceptConsents) and accounts
// (accountAutomation) keep their own keys: the extension reads them. Guard: test/apply-settings.test.js.

export const MODES = Object.freeze([
  {id: 'check', icon: 'eye', title: 'I check each form', badge: ['Best quality', 'good'],
    text: 'Each form opens in a tab, filled. You read it and press Submit.'},
  {id: 'fill', icon: 'layers', title: 'Fill for me, I press Submit',
    text: 'Forms fill in the background. You press Submit from a list, on the Mac or your phone.'},
  {id: 'auto', icon: 'zap', title: 'Full automation', badge: ['More applications, lower quality', 'warn'],
    text: 'Jobadabra fills and sends forms by itself, only those that pass your checks below. Nobody reads a form before it goes.',
    // In the first-Apply dialog there are no checks below: what it means, and the defaults (sketch 8b).
    dialogText: 'Jobadabra fills and sends forms by itself. Nobody reads a form before it goes, and answers your facts don\'t cover can be AI guesses. Defaults: fit 80+, at most 20 a day, a 10-minute wait with Stop.'},
]);
export const MODE_IDS = MODES.map(mode => mode.id);
// What each mode does in this version (background fills and sending by themselves arrive in later steps): said under the choice, never hidden.
export const MODE_TODAY = {
  check: '',
  fill: 'Background fills arrive in a coming update. Until then each form opens in a tab, filled, for you to check.',
  auto: 'Sending by itself arrives in a coming update. Until then each form opens in a tab, filled, and you press Submit.',
};

export const ANSWERS = Object.freeze([
  {id: 'facts', label: 'Only from my saved facts'},
  {id: 'ai', label: 'Let the AI guess the rest'},
]);
export const ANSWERS_TEXT = {
  facts: 'A question your Profile does not answer stays empty for you, with the AI\'s suggestion beside it.',
  ai: 'The AI answers what your Profile does not cover. You see which answers it wrote.',
};

// Full automation's checks: each one the person's to change (CLAUDE.md "The app submits only in Full automation").
export const AUTO_DEFAULTS = Object.freeze({minFit: 80, noEmpty: true, factsOnly: true, perDay: 20, perEmployer: 1, waitMin: 10});
const LIMITS = {minFit: [0, 100], perDay: [1, 200], perEmployer: [1, 20], waitMin: [0, 120]};
const clamp = (key, value) => {
  const [low, high] = LIMITS[key], n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : AUTO_DEFAULTS[key];
};

// settings -> {mode, answers, auto, chosenAt}: nothing saved yet is "I check each form" (pre-selected, owner 26 Oct 2026) with facts only.
export function applyOf(settings) {
  const saved = settings?.apply || {}, auto = {...AUTO_DEFAULTS};
  for (const key of Object.keys(AUTO_DEFAULTS)) {
    if (!(key in (saved.auto || {}))) continue;
    auto[key] = key in LIMITS ? clamp(key, saved.auto[key]) : saved.auto[key] !== false;
  }
  return {mode: MODE_IDS.includes(saved.mode) ? saved.mode : 'check', answers: saved.answers === 'ai' ? 'ai' : 'facts', auto, chosenAt: saved.chosenAt || ''};
}
export const applyChosen = settings => !!settings?.apply?.chosenAt;

// The settings patch for a change: the whole apply object (saveSettings merges one level). `chosen` stamps the confirmation.
export function applyPatch(settings, change = {}, {chosen = false, now = new Date()} = {}) {
  const current = applyOf(settings);
  const next = {...current, ...change, auto: {...current.auto, ...(change.auto || {})}};
  return {apply: applyOf({apply: {...next, chosenAt: chosen ? now.toISOString() : current.chosenAt}})};
}
