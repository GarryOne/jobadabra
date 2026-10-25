// The one rule for every Pro-gated feature (owner, 25 Oct 2026: Pro by promo code and a visible Export while paying is off). Three states, from the licence state alone:
// 'open' = licensed, it works; 'waitlist' = not licensed and paying is off (Pro label, a dialog with the waitlist and "Have a promo code?"); 'buy' = not licensed and paying is on (Pro label, Settings → Plan).
// The window only hints; the main process stays the real check (lib/jobs-export-handlers.js). Guard: test/pro-gate.test.js.
export const payingOn = (state = {}) => ['test', 'live'].includes(state.proMode);
export const proGate = (state = {}) => (state.licensed ? 'open' : payingOn(state) ? 'buy' : 'waitlist');

// Every feature that is shown as Pro to a free person, and what each state does: the test loops over this list, and fails when a page decides by `proMode` on its own.
export const GATED_FEATURES = {
  export: gate => ({shown: true, label: gate !== 'open', press: {open: 'run', waitlist: 'dialog', buy: 'plan'}[gate]}),
  promo: gate => ({shown: gate !== 'open', label: false, press: 'redeem'}),
};

// The Jobs page's Export button: 'open' = licensed (a Pro account, a promo code or an owner key); 'locked' = shown with a Pro label (what a press does is proGate's: dialog or Plan). Never hidden.
export const exportState = (state = {}) => (proGate(state) === 'open' ? 'open' : 'locked');
