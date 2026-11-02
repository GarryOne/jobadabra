// Apply with Claude → extension hand-off. A Claude session driving this tab (Claude in Chrome) asks for the
// extension's fast fill by firing, on the form page:
//   document.dispatchEvent(new CustomEvent('jobpilotto:fill', {detail: JSON.stringify({job, ticket})}))
// The ticket comes from the Jobadabra app when it launched that session, and the extension checks it with
// the app first, so a web page alone can't make the extension fill it. Progress and result are written to
// <html data-jobpilotto-fill='{"state":"received|running|done|error", ...}'>, which the session reads.
// <html data-jobpilotto-hook="<version>"> says the extension is here.
(() => {
  // Once per page, but a copy left behind by an extension reload (its chrome.runtime is gone) lets the new one run.
  if (window.__jobadabraHookAlive?.()) return;
  window.__jobadabraHookAlive = () => !!chrome.runtime?.id;
  // Injected as the app's tab starts loading: <html> may not exist for a moment. The listener is on document,
  // which does; the attribute Claude looks for is set as soon as <html> is there.
  const markHook = () => { if (document.documentElement) document.documentElement.dataset.jobpilottoHook = chrome.runtime.getManifest().version; };
  markHook();
  if (!document.documentElement) document.addEventListener('DOMContentLoaded', markHook, {once: true});
  document.addEventListener('jobpilotto:fill', event => {
    let request;
    try { request = JSON.parse(event.detail); } catch { return; }
    if (typeof request?.ticket !== 'string' || typeof request?.job !== 'string') return;
    document.documentElement.dataset.jobpilottoFill = JSON.stringify({state: 'received'});
    chrome.runtime.sendMessage({type: 'claudeFill', job: request.job, ticket: request.ticket});
  });
  // The fill ladder's attempt log (page/attempts.js, the page's own world, where chrome.runtime is not) says a try worked: relayed as the run's progress (ladder/progress.js).
  // Only that one fixed kind; a page that fires it itself only adds a shadow log line, it never makes the extension act.
  document.addEventListener('jobadabra:progress', event => { if (event.detail === 'value_stayed') chrome.runtime.sendMessage({type: 'progress', kind: 'value_stayed'}).catch?.(() => {}); });
})();
