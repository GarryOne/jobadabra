// The page side of the popup guard (owner via cc, 11 Oct 2026: "a popup can appear at any time: at page load, during filling or at the end; handle it at any point"). The fill (page/fill.js)
// awaits window.__jobPilottoGate() between its stages; a throttled MutationObserver notes that the page changed, and only then the gate asks the extension whether a layer covers the form
// (the isolated-world bridge extension/guard-bridge.js carries the question to the worker, which finds it by occlusion, closes it with the AI's non-agreeing button, kept, or says "held").
// -> true: go on (nothing new, closed, or nobody answered: the fill never waits long for a bridge that is not there); false: held, the fill types nothing more. The decision is the worker's;
// this page only learns "done" or "held" (two event names, no data), so a page script can at most delay the fill. Guards: app-core/test/guard-gate.test.js, recorded cases.
(() => {
  if (window.__jobPilottoGate) return;
  let dirty = false, lastAsk = 0;
  const watch = typeof MutationObserver === 'function' ? new MutationObserver(() => { dirty = true; }) : {observe() {}, takeRecords: () => []};
  try { watch.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'open', 'hidden', 'aria-hidden', 'aria-modal']}); } catch { /* no page to watch */ }
  window.__jobPilottoGate = () => {
    if (window.__jobPilottoStopped) return Promise.resolve(false);   // Stop (extension/stop.js): the fill is held and types nothing more
    if (watch.takeRecords().length) dirty = true;
    if (!document.documentElement.hasAttribute('data-jobpilotto-gate')) return Promise.resolve(true);   // no bridge on this page (the isolated-world script marks it): nobody to ask, never wait
    const every = window.__jobPilottoGateEveryMs ?? 400, wait = window.__jobPilottoGateWaitMs ?? 12000;
    if (!dirty || Date.now() - lastAsk < every) return Promise.resolve(true);
    dirty = false; lastAsk = Date.now();
    return new Promise(resolve => {
      const finish = answer => { clearTimeout(timer); window.removeEventListener('jobpilotto-gate-done', onDone); window.removeEventListener('jobpilotto-gate-held', onHeld); resolve(answer); };
      const onDone = () => finish(true), onHeld = () => finish(false);
      const timer = setTimeout(() => finish(true), wait);   // nobody answered: no bridge on this page
      window.addEventListener('jobpilotto-gate-done', onDone);
      window.addEventListener('jobpilotto-gate-held', onHeld);
      window.dispatchEvent(new CustomEvent('jobpilotto-gate'));
    });
  };
})();
