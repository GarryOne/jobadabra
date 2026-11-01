// The site_broken ending (the outcome contract, spec docs/superpowers/specs/2026-10-12-one-next-move.md phase 1a): a page the server answered with an error, or one
// that could not be loaded or read at all, while it shows no form. It is loaded again a few times, then reported plainly ('site_broken', the status in the need), never left silent.
// The server's status code is a fixed number (structure), never page words; it only counts when the page shows no form (a site that serves its form with an error code is filled).
// A page a form submission led to is never loaded again (a reload could send the form a second time): it is reported at once.
// Guards: app-core/test/site-broken.test.js (the rule, the tries), desktop/e2e/recorded/site-error-then-form-1 and posting-gone-1 (the replays).
// Reads no chrome API but the two listeners below (guarded, so node tests load it).
export const GONE = [404, 410];
// -> 'gone' | 'error' | 'unreadable' | null. shape: pageShape's counts (null when the page could not be read), with the document's status (0 when unknown).
export function brokenOf(shape) {
  if (!shape) return 'unreadable';
  if ((shape.fields || 0) + (shape.textareas || 0) + (shape.files || 0) >= 2) return null;   // a form is there: it is filled, whatever the status
  const status = Number(shape.status) || 0;
  return GONE.includes(status) ? 'gone' : status >= 500 && status <= 599 ? 'error' : null;
}
// A posting the page-kind AI calls closed (taken down, filled, "not found" served with a 200: Ashby, 18 Oct 2026) is reported like a gone one. The AI judges it, in any language; the
// structure floor ANDs with it: a page that shows a form is never closed. -> 'closed' | null. kind: the page-kind answer; shape: pageShape's counts.
export function closedOf(kind, shape) {
  if (kind?.kind !== 'closed' || !shape) return null;
  return (shape.fields || 0) + (shape.textareas || 0) + (shape.files || 0) >= 2 ? null : 'closed';
}
// -> {why, needs} for the app's stuck report when the AI called the page closed (and no form is there), else null.
export const closedReport = (kind, shape) => (closedOf(kind, shape) ? {why: 'site_broken', needs: brokenNeed('closed')} : null);
// What the person reads (the app's session card): fixed sentences, at most 80 characters.
export function brokenNeed(kind, status) {
  if (kind === 'closed') return 'This posting is closed';
  if (kind === 'gone') return `This posting is gone: the site answered ${status}`;
  if (kind === 'error') return `The site answered with an error (${status}): try again later`;
  return 'The page could not be loaded or read: try again later';
}
// How many times each kind is loaded again, and the wait before each load (a server that is restarting answers a few seconds later).
export const TRIES = {error: [3000, 8000], unreadable: [3000], gone: [], closed: []};

const tried = new Map();   // `${tabId} ${pageKey}` -> loads done
const posted = new Map();   // tabId -> whether its current document came from a form submission
// Every main-frame commit (a document a form led to is never loaded again), and a closed tab forgotten. Registered here, at the worker's start (an imported module's top level).
export function noteCommitted({tabId, frameId, transitionType}) {
  if (frameId === 0) posted.set(tabId, transitionType === 'form_submit');
}
export const forgetBroken = tabId => { posted.delete(tabId); for (const key of [...tried.keys()]) if (key.startsWith(`${tabId} `)) tried.delete(key); };
globalThis.chrome?.webNavigation?.onCommitted?.addListener(noteCommitted);
globalThis.chrome?.tabs?.onRemoved?.addListener(forgetBroken);

// One broken page: -> 'retry' (the tab is loaded again: the next load is judged by itself), 'reported' or null (not broken).
// The fill flow's own parts are passed in (the page key, the 'site_broken' dead end as report, the panel's step as say, the log as decide).
export async function onBrokenPage(kind, {key, tabId, status = 0, host = '', wait, reload, report, say = () => {}, decide = () => {}}) {
  if (!kind) return null;
  const done = tried.get(key) || 0, waits = TRIES[kind] || [];
  const fromForm = posted.get(tabId) !== false;   // unknown counts as a form's result: never sent twice
  if (done < waits.length && !fromForm) {
    tried.set(key, done + 1);
    decide('fill', 'a broken page: loading it again', {host, kind, status, try: done + 1, of: waits.length});
    say(kind === 'error' ? `The site answered with an error (${status}): trying again…` : 'The page could not be loaded: trying again…');
    await wait(waits[done]);
    await reload();
    return 'retry';
  }
  decide('fill', 'a broken page: reported as site_broken', {host, kind, status, tries: done, fromForm});
  await report(brokenNeed(kind, status));
  return 'reported';
}
