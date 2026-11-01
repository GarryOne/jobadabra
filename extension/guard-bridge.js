// The isolated-world half of the popup guard's gate (extension/page/guard-gate.js runs in the page's own world and cannot message the extension): a content script, injected once per
// tab, that turns the page's "jobpilotto-gate" event into one message to the worker (dialog-after-fill.js answerGate) and answers the page with one of two events, "done" or "held", no data.
// The decision stays in the worker; the page never holds it. Guard: app-core/test/dialog-after-fill.test.js.
(() => {
  if (globalThis.__jobPilottoGateBridge) return;
  globalThis.__jobPilottoGateBridge = true;
  document.documentElement.setAttribute('data-jobpilotto-gate', '1');   // the page-side gate asks only where this mark says someone answers
  window.addEventListener('jobpilotto-gate', async () => {
    let held = false;
    try { held = !!(await chrome.runtime.sendMessage({type: 'jobpilotto-gate'}))?.held; } catch { /* the worker is asleep or gone: the fill goes on */ }
    window.dispatchEvent(new CustomEvent(held ? 'jobpilotto-gate-held' : 'jobpilotto-gate-done'));
  });
})();
