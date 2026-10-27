// The fill overlay (owner, 19 Oct 2026): while the extension fills, the page is dimmed and the person's clicks, keys and scrolling are held back, so nothing is disturbed mid-fill.
// The layer takes NO hit-test (pointer-events: none): every page read (elementFromPoint, on-top.js) and the driver's own clicks see the page; the blocking is done by capturing listeners
// that drop only the person's trusted input. The driver (extension/input-gap.js) sets data-jobpilotto-driving around its own debugger input, which lets that through. The panel, the Stop chip
// and the report card (ids starting jobpilotto) are never held. It lifts on ONE thing: the worker's verdict (apply-state.js: done, stopped, your-turn),
// which reaches it as {type: 'applyState'} (and as 'stopped'); it tells the panel (onLift) so the panel leaves its centred, working look too: the two never drift apart. No timer, page event or removed layer lifts it
// (owner, 27 Oct 2026: "Why we're so reactive? Who needs that reactivity? It causes glitches"); a page that deletes the layer gets it back. An extension reload ends the script itself. The animated aurora, sparkles and shimmer on it are panel-overlay-fx.js. Injected before review.js (panel-files.js). Guards: desktop/e2e/test/fill-overlay.test.mjs, desktop/test/fill-overlay.test.js.
// Early (owner, 27 Oct 2026: "at the time the webpage loads, can we instantly show the overlay"): the worker turns it on at the page's commit (early-dim.js), before the panel is injected. One copy per page:
// a second injection (the panel's own, arm() in background.js) keeps the live copy, so the layer the early dim drew is the one the panel lifts.
(() => {
  if (window.__jobPilottoOverlay?.alive?.()) return;
  const ID = 'jobpilotto-fill-overlay';
  const HELD = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'keydown', 'keyup', 'keypress', 'wheel', 'touchstart', 'touchmove', 'dragstart', 'selectstart'];
  let layer = null, watch = null, wipe = null, lifted = () => {};
  document.getElementById(ID)?.remove();   // a copy left by an extension reload: its owner is gone
  const ours = event => (event.composedPath?.() || [event.target]).some(node => typeof node?.id === 'string' && node.id.startsWith('jobpilotto'));
  const hold = event => {
    if (!event.isTrusted || document.documentElement.hasAttribute('data-jobpilotto-driving') || ours(event)) return;
    event.stopImmediatePropagation();
    if (event.cancelable) event.preventDefault();
  };
  function off() {
    clearInterval(watch); watch = null; wipe?.disconnect(); wipe = null;
    for (const name of HELD) window.removeEventListener(name, hold, true);
    layer?.remove(); layer = null;
  }
  // Lifted by the worker's verdict (or the extension's end), not by the panel: the panel is told, and leaves its working look (review.js endStep).
  function lift() {
    if (!layer && !watch) return;
    off();
    try { lifted(); } catch { /* the panel is gone */ }
  }
  // The Apply is working: the layer (re)appears. Stays until a verdict.
  function on() {
    if (layer?.isConnected || document.getElementById('jobpilotto-review-host')?.hidden) return;   // Why (#1558): a closed panel (its X) has no Stop on the page: never dimmed
    layer = Object.assign(document.createElement('div'), {id: ID});
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none;background:rgba(19,36,57,.55);';
    document.documentElement.append(layer);
    window.__jobPilottoOverlayFx?.(layer);   // the magic behind the panel (panel-overlay-fx.js): inside the layer, so every end takes it away
    for (const name of HELD) window.addEventListener(name, hold, {capture: true, passive: false});
    wipe?.disconnect();
    // Why (2026-10-27, owner, 2nd recording of an Apply on a posting): a page's framework re-renders <html> about 2 s in and deletes every child it did not draw: the dim went with it. The layer is the
    // state's drawing, not its owner: a layer the page deleted is put back at once and the state stays (apply-state.js).
    wipe = new MutationObserver(() => { if (layer && !layer.isConnected) document.documentElement.append(layer); });
    wipe.observe(document.documentElement, {childList: true});
    watch = setInterval(() => { if (!chrome.runtime?.id) lift(); }, 1000);   // the extension was reloaded: this script has no owner left
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'stopped') lift();
    else if (message?.type === 'applyState') { if (message.state === 'working') on(); else lift(); }
  });
  // The page's first moment: ask the worker, so a verdict that came before this script existed lifts a layer drawn on a stale answer (early-dim.js injects only for a working tab).
  const first = () => chrome.runtime.sendMessage({type: 'panelApply'}).then(answer => { if (answer && answer.state !== 'working') lift(); }).catch(() => {});
  window.__jobPilottoOverlay = {on, off, active: () => !!layer?.isConnected, earlyOn: function early(tries = 0) { if (document.documentElement) { on(); first(); } else if (tries < 50) setTimeout(() => early(tries + 1), 10); }, alive: () => !!chrome.runtime?.id, onLift: fn => { lifted = fn; }};
})();
