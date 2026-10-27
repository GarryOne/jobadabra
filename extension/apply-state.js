// The one owner of "this tab is in an Apply" (owner, 27 Oct 2026: "When we open a webpage, we start with dark/glow background and the panel in the middle. We keep it like that until we have a very
// clear verdict that the extension finished all its work... Why we're so reactive and changing our state every 10 ms? It causes glitches"). Intended behaviour, one state per tab:
// working -> done | stopped | your-turn. It is set to working when the app opens or marks the tab (before any page loads) and changes only on a verdict: the run ends (done), Stop (stopped), or the person
// must act (your-turn). The page only DRAWS it (panel-overlay.js, review.js, early-dim.js): dim + centred panel while working, nothing decided by a timer, a page event or a removed layer.
// Held in the worker and in chrome.storage.session (a sleeping worker wakes to the same answer); every change is pushed to the tab as {type: 'applyState'}. Guards: desktop/e2e/test/fill-overlay-early-reload.test.mjs,
// desktop/test/apply-state-owner.test.js.
// TODO(AI): a run that ends with no progress('') (a return that skips it) leaves its tab working until Stop, the panel's X or the tab's close: find such a path and give it a verdict (2026-10-27).
export const WORKING = 'working';
export const VERDICTS = ['done', 'stopped', 'your-turn'];
const states = new Map();   // tab id -> 'working' | a verdict
const KEY = tabId => `apply:${tabId}`;

/** Resolves once the states a sleeping worker kept are back; early-dim.js waits for it before its first answer. */
export const restored = (globalThis.chrome?.storage?.session?.get(null) || Promise.resolve({})).then(all => {
  for (const [key, state] of Object.entries(all || {})) if (key.startsWith('apply:') && !states.has(Number(key.slice(6)))) states.set(Number(key.slice(6)), state);
}).catch(() => {});

export const applyState = tabId => states.get(tabId) || '';
export const isWorking = tabId => states.get(tabId) === WORKING;
export const workingTabs = () => [...states].filter(([, state]) => state === WORKING).map(([tabId]) => tabId);

/**
 * Set a tab's Apply state and tell the tab. The only writer: nothing else turns the dim or the centred panel on or off.
 * @param {number} tabId the tab
 * @param {'working'|'done'|'stopped'|'your-turn'} state working, or a verdict
 * @returns {boolean} whether the state changed
 */
export function setApply(tabId, state) {
  if (!Number.isInteger(tabId) || ![WORKING, ...VERDICTS].includes(state)) return false;
  const changed = states.get(tabId) !== state;
  states.set(tabId, state);
  if (changed) globalThis.chrome?.storage?.session?.set({[KEY(tabId)]: state}).catch(() => {});
  globalThis.chrome?.tabs?.sendMessage(tabId, {type: 'applyState', state}).catch(() => {});   // pushed again on a repeat: a page that drew a step locally meanwhile is set right; a page with no script yet asks on its first draw (panelApply)
  return changed;
}

/** A closed tab's state goes with it. */
export function forgetApply(tabId) {
  states.delete(tabId);
  globalThis.chrome?.storage?.session?.remove(KEY(tabId)).catch(() => {});
}
