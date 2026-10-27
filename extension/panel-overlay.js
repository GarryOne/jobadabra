// The fill overlay (owner, 19 Oct 2026): while the extension fills, the page is dimmed and the person's clicks, keys and scrolling are held back, so nothing is disturbed mid-fill.
// The layer takes NO hit-test (pointer-events: none): every page read (elementFromPoint, on-top.js) and the driver's own clicks see the page; the blocking is done by capturing listeners
// that drop only the person's trusted input. The driver (extension/input-gap.js) sets data-jobpilotto-driving around its own debugger input, which lets that through. The panel, the Stop chip
// and the report card (ids starting jobpilotto) are never held. It lifts on every end: review.js turns it on and off with the panel's centring as ONE look (its look()); a page change drops
// it with the document; Stop, an extension reload, a missing refresh and a removal from outside lift it from here, and tell the panel (onLift) so the panel leaves its centred, working
// look too: the two never drift apart (owner, 27 Oct 2026: the panel stayed centred on "Reading this page…" while the dim was gone). The animated aurora, sparkles and shimmer on it are panel-overlay-fx.js. Injected before review.js (panel-files.js). Guards: desktop/e2e/test/fill-overlay.test.mjs, desktop/test/fill-overlay.test.js.
// Early (owner, 27 Oct 2026: "at the time the webpage loads, can we instantly show the overlay"): the worker turns it on at the page's commit (early-dim.js), before the panel is injected; it then
// lifts by itself after EARLY_MS unless the panel's first step takes it over (on()). One copy per page: a second injection (the panel's own, arm() in background.js) keeps the live copy, so the
// layer the early dim drew is the one the panel lifts.
(() => {
  if (window.__jobPilottoOverlay?.alive?.()) return;
  const ID = 'jobpilotto-fill-overlay', MAX_MS = 180000, EARLY_MS = 15000;   // MAX_MS: no step refreshed it for three minutes: the person is never locked out of a stuck page
  const HELD = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'keydown', 'keyup', 'keypress', 'wheel', 'touchstart', 'touchmove', 'dragstart', 'selectstart'];
  let layer = null, watch = null, until = 0, early = false, lifted = () => {};
  document.getElementById(ID)?.remove();   // a copy left by an extension reload: its owner is gone
  const ours = event => (event.composedPath?.() || [event.target]).some(node => typeof node?.id === 'string' && node.id.startsWith('jobpilotto'));
  const hold = event => {
    if (!layer?.isConnected) { lift(); return; }   // the layer was removed from outside (Stop, a settle): the holding goes with it
    if (!event.isTrusted || document.documentElement.hasAttribute('data-jobpilotto-driving') || ours(event)) return;
    event.stopImmediatePropagation();
    if (event.cancelable) event.preventDefault();
  };
  function off() {
    clearInterval(watch); watch = null;
    for (const name of HELD) window.removeEventListener(name, hold, true);
    layer?.remove(); layer = null;
  }
  // Lifted by itself, not by the panel: the panel is told, and leaves its working look (review.js endStep).
  function lift() {
    if (!layer && !watch) return;
    off();
    try { lifted(); } catch { /* the panel is gone */ }
  }
  // The fill is on a step: the layer (re)appears, and the backstop's clock restarts. `stay`: how long it stays without another on() (the early dim's short wait, else three minutes).
  function on(stay = MAX_MS) {
    until = Date.now() + stay; early = stay < MAX_MS;
    if (layer?.isConnected) return;
    layer = Object.assign(document.createElement('div'), {id: ID});
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none;background:rgba(19,36,57,.55);';
    document.documentElement.append(layer);
    window.__jobPilottoOverlayFx?.(layer);   // the magic behind the panel (panel-overlay-fx.js): inside the layer, so every end takes it away
    for (const name of HELD) window.addEventListener(name, hold, {capture: true, passive: false});
    watch = setInterval(() => { if (!chrome.runtime?.id || !layer?.isConnected || Date.now() > until) lift(); }, 1000);
  }
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'stopped') lift(); });
  window.__jobPilottoOverlay = {on, off, early: () => early && !!layer?.isConnected, earlyOn: function early(tries = 0) { if (document.documentElement) on(EARLY_MS); else if (tries < 50) setTimeout(() => early(tries + 1), 10); }, alive: () => !!chrome.runtime?.id, active: () => !!layer?.isConnected, onLift: fn => { lifted = fn; }};
})();
