// The extension's decision log (moved out of background.js, 8 Oct 2026): every part that decides something (fill, tabs, account pages)
// writes one line here, and it reaches the app's logs/app.log. Shared by every flow; owns no flow itself.
import {settings} from './flow.js';
import {errorReport} from './error-report.js';

// ---- What the extension decided, and why ----
// A service worker's console dies with it, and a decision it made (marking a job Applied, or refusing to) used to
// leave no trace anywhere — which is why 1 Oct 2026's wrong "Applied" could not be explained. Every decision is kept
// in a small ring buffer in chrome.storage.local and pushed to the app, whose log holds it (`grep extension
// logs/app.log`); entries the push could not deliver stay unsent and go with the next one, so a crashed worker's
// last decisions still arrive. Ids, hosts, reasons and counts only — never a form answer or a page's text.
const LOG_KEY = 'jp-decisions';
// Why (30 Oct 2026, ap; Gitar on the span PR): one fill pass writes about 30 span lines; a ring of 50 pushed the line that names the slow await out while the app was slow or closed.
const LOG_KEEP = 200;
export async function decisions() {
  const {[LOG_KEY]: kept = []} = await chrome.storage.local.get(LOG_KEY).catch(() => ({}));
  return Array.isArray(kept) ? kept : [];
}
export async function decide(kind, text, fields = {}) {
  const entry = {at: new Date().toISOString(), kind: String(kind).slice(0, 24), text: String(text).slice(0, 300),
    fields: {...fields, version: chrome.runtime.getManifest().version}, sent: false};
  await inTurn(async () => chrome.storage.local.set({[LOG_KEY]: [...await decisions(), entry].slice(-LOG_KEEP)}).catch(() => {}));
  pushDecisions();
  return entry;
}
let spanId = 0;
/** Bracket one awaited operation without awaiting logging; preserve its result or rejection and log only ids and duration. */
export async function span(name, promiseFactory) {
  const id = ++spanId, began = Date.now();
  // Why (30 Oct 2026, ap): instrumentation uses the existing decision queue without delaying the work or exposing rejection text.
  decide('span', `${name} start`, {id}).catch(() => {});
  let failed = false;
  try { return await promiseFactory(); }
  catch (error) { failed = true; throw error; }
  finally { decide('span', `${name} end`, {id, ms: Date.now() - began, ...(failed ? {failed: true} : {})}).catch(() => {}); }
}

// One at a time: two lines written at once read the same list (one was lost), and two pushes at once sent the same unsent
// lines twice or three times (8 Oct 2026: "closed the posting tab" logged 3x for one tab).
let logTurn = Promise.resolve();
const inTurn = work => (logTurn = logTurn.then(work, work));
export function pushDecisions() { return inTurn(pushNow); }
async function pushNow() {
  const kept = await decisions();
  const unsent = kept.filter(entry => !entry.sent);
  if (!unsent.length) return;
  try {
    // Why (30 Oct 2026, ap; Gitar on the span PR): the oldest 20 go first and only they are marked sent; the newest 20 were sent while every unsent line was marked sent, so the rest were lost.
    const batch = unsent.slice(0, 20);
    const config = await settings();
    const response = await fetch(`${config.workerUrl.replace(/\/$/, '')}/extension/log`, {method: 'POST',
      headers: {Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({entries: batch})});
    if (!response.ok) return;
    const sent = new Set(batch.map(entry => entry.at + entry.text));
    await chrome.storage.local.set({[LOG_KEY]: (await decisions())
      .map(entry => (sent.has(entry.at + entry.text) ? {...entry, sent: true} : entry))});
  } catch { /* not paired, or the app is closed: they stay unsent for the next push */ }
}

// Uncaught worker errors keep their local decision line and reach the app's reporter through the same authenticated log channel.
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  const origin = chrome.runtime.getURL('');
  self.addEventListener('error', event => {
    decide('error', 'uncaught error', errorReport(event?.error, {origin, filename: event?.filename, lineno: event?.lineno, colno: event?.colno})).catch(() => {});
  });
  self.addEventListener('unhandledrejection', event => {
    decide('error', 'unhandled rejection', errorReport(event?.reason, {origin, rejection: true})).catch(() => {});
  });
}
