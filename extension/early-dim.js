// The dim at a fill page's first moment (owner, 27 Oct 2026: "at the time the webpage loads, can we instantly show the overlay dark/glowing background? Right now there is a 0.5 second until
// it appears"). A page the app opened to fill (its address carries the fill mark) is dimmed as soon as its document commits, before the panel's scripts are injected at load. The panel's
// first step takes the same layer over (panel-overlay.js keeps one copy per page); a page that gets no panel (not ours, Stop) is never left dim: the early layer lifts by itself within
// seconds (panel-overlay.js EARLY_MS). Started from background.js.
// A run is ONE piece of work across its page changes (owner, 27 Oct 2026, a recording of an Apply on a posting: the dim and the panel came and went at each new document): a page that commits while
// the worker has a step on its tab (the posting's page change to the form, a redirect, a second load) is dimmed at its commit too, though its address no longer carries the mark. Guard: desktop/e2e/test/fill-overlay.test.mjs ("dimmed at load").
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
 * Listen for top-frame commits of https pages carrying the fill mark, or on a tab with a step on (and no Stop), and dim each at once. Called once by background.js.
 * Invariant: only a page the app opened to fill, or one a run of ours is on, is ever dimmed here; the early layer lifts by itself (panel-overlay.js EARLY_MS) when no panel takes it over.
 * @param {(tabId: number) => boolean} [stepOn] whether the worker has a fill step showing on that tab now (background.js stepNow); a step ends with the run, so a finished run's next page is never dimmed
 * @returns {void}
 */
export function startEarlyDim(stepOn = () => false) {
  chrome.webNavigation?.onCommitted.addListener(details => {
    // Why (#2221, owner 27 Oct 2026): a run's own page change drops the mark from the address, so the mark alone left every new document undimmed until its panel loaded ("appears and disappears").
    if (details.frameId !== 0 || !/^https:/.test(details.url) || !(details.url.includes(FILL_MARK) || stepOn(details.tabId)) || isStopped()) return;
    dimEarly(details.tabId);
  });
}
