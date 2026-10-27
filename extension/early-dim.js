// The dim at a fill page's first moment (owner, 27 Oct 2026: "at the time the webpage loads, can we instantly show the overlay dark/glowing background? Right now there is a 0.5 second until
// it appears"). A page the app opened to fill (its address carries the fill mark) is dimmed as soon as its document commits, before the panel's scripts are injected at load. The panel's
// first step takes the same layer over (panel-overlay.js keeps one copy per page); a page that gets no panel (not ours, Stop) is never left dim: the early layer lifts by itself within
// seconds (panel-overlay.js EARLY_MS). Started from background.js. Guard: desktop/e2e/test/fill-overlay.test.mjs ("dimmed at load").
import {isStopped} from './stop-state.js';

const FILL_MARK = '#jobpilotto-fill';

/**
 * Dim one tab's page now, before the panel is injected: the overlay files plus its early start, in one injection.
 * @param {number} tabId the tab whose top frame just committed a fill page
 * @returns {Promise<void>} resolves either way: no site access yet, or a closed tab, leaves the panel to dim on its first step
 */
export function dimEarly(tabId) {
  return chrome.scripting.executeScript({target: {tabId}, files: ['panel-overlay-fx.js', 'panel-overlay.js', 'overlay-early.js'], injectImmediately: true})
    .catch(() => {});   // no access to the site yet (it waits for Allow) or the tab closed: the panel dims on its first step as before
}

/**
 * Listen for top-frame commits of https pages carrying the fill mark (and no Stop), and dim each at once. Called once by background.js.
 * Invariant: only a page the app opened to fill is ever dimmed here; the early layer lifts by itself (panel-overlay.js EARLY_MS) when no panel takes it over.
 * @returns {void}
 */
export function startEarlyDim() {
  chrome.webNavigation?.onCommitted.addListener(details => {
    if (details.frameId !== 0 || !/^https:/.test(details.url) || !details.url.includes(FILL_MARK) || isStopped()) return;
    dimEarly(details.tabId);
  });
}
