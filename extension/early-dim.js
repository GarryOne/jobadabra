// The dim at a fill page's first moment (owner, 27 Oct 2026: "at the time the webpage loads, can we instantly show the overlay dark/glowing background? Right now there is a 0.5 second until
// it appears"). A page the app opened to fill (its address carries the fill mark) is dimmed as soon as its document commits, before the panel's scripts are injected at load. The panel's
// first step takes the same layer over (panel-overlay.js keeps one copy per page). Started from background.js.
// Rewritten 27 Oct 2026 (owner: "one state, changed only on a verdict"): a document that commits on a tab the worker holds as working is dimmed at its commit; the state itself is apply-state.js's.
// Guard: desktop/e2e/test/fill-overlay.test.mjs ("dimmed at load"), fill-overlay-early-reload.test.mjs.
import {isStopped} from './stop-state.js';
import {applyState, isWorking, restored, setApply, WORKING} from './apply-state.js';

const FILL_MARK = '#jobpilotto-fill';
const WALKED_AWAY = ['typed', 'auto_bookmark', 'generated', 'keyword', 'keyword_generated'];

/**
 * Dim one tab's page now, before the panel is injected: the overlay files plus its early start, in one injection.
 * @param {number} tabId the tab whose top frame just committed a page of a working Apply
 * @returns {Promise<void>} resolves either way: no site access yet, or a closed tab, leaves the panel to dim on its first draw
 */
export function dimEarly(tabId) {
  return chrome.scripting.executeScript({target: {tabId}, files: ['panel-overlay-fx.js', 'panel-overlay.js', 'overlay-early.js'], injectImmediately: true})
    .catch(() => {});   // no access to the site yet (it waits for Allow) or the tab closed: the panel dims on its first draw as before
}

/**
 * Start a tab's Apply the moment the app's marked address is first navigated to (before any page loads), and dim every document that commits on a working tab.
 * Invariant: the state is set only here (the first mark on a tab with no state), by the app's open/restart (tabs.js) and by verdicts; a tab with a verdict is never dimmed by a later mark in its address.
 * @returns {void}
 */
export function startEarlyDim() {
  // A marked address on a tab with no state starts its Apply; on a tab that already has a verdict, a marked document that was not a redirect is the app opening it again (the next job, Apply again) and starts a new one.
  const begin = (details, again = false) => {
    if (details.frameId !== 0 || !/^https:/.test(details.url) || !details.url.includes(FILL_MARK) || isStopped()) return;
    const was = applyState(details.tabId);
    if (!was || (again && !isWorking(details.tabId) && !(details.transitionQualifiers || []).some(q => /redirect/.test(q)))) setApply(details.tabId, WORKING);
  };
  chrome.webNavigation?.onBeforeNavigate?.addListener(async details => { await restored; begin(details); });
  chrome.webNavigation?.onCommitted.addListener(async details => {
    await restored;
    begin(details, true);
    // Why (2026-10-27, code review): a person who types an address or picks a bookmark in the app's tab (an address with no mark) walks away: the Apply is theirs again, else the next site would be dimmed with no panel to Stop it.
    if (details.frameId === 0 && isWorking(details.tabId) && !details.url.includes(FILL_MARK) && WALKED_AWAY.includes(details.transitionType)) { setApply(details.tabId, 'your-turn'); return; }
    if (details.frameId !== 0 || !/^https:/.test(details.url) || !isWorking(details.tabId) || isStopped()) return;
    dimEarly(details.tabId);
  });
}
