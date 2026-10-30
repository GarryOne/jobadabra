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
/** Read the persisted decision ring, falling back to an empty ring when storage is unavailable. */
export async function decisions() {
  const {[LOG_KEY]: kept = []} = await chrome.storage.local.get(LOG_KEY).catch(() => ({}));
  return Array.isArray(kept) ? kept : [];
}
/** Persist one decision in order and request delivery without waiting for the app. */
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

// Design: pushDecisions owns idle -> running -> idle; all callers share the running promise.
// Calls while running set dirty, coalescing into one follow-up drain rather than one POST each.
// Storage reads/writes stay serialized; fetch never holds that queue, so new lines can persist.
// Each drain sends all unsent lines oldest first in batches <= 50, marking only an ok batch.
// A failed POST ends the owner, leaving unsent lines for the next explicit push; no timers.
let logTurn = Promise.resolve();
const inTurn = work => (logTurn = logTurn.then(work, work));
let pushOwner = null, pushDirty = false;
/** Coalesce delivery requests under one owner, including requests made during a running drain. */
export function pushDecisions() {
  pushDirty = true;
  if (!pushOwner) pushOwner = (async () => {
    try {
      do {
        pushDirty = false;
        if (!await pushNow()) break;
      } while (pushDirty);
    } finally { pushOwner = null; }
  })();
  return pushOwner;
}
async function pushNow() {
  try {
    const config = await settings();
    while (true) {
      // Why (30 Oct 2026, ap; Gitar on the span PR): drain oldest first in route-safe batches of 50; only an ok batch is marked sent, and fetch stays outside the storage queue so spans cannot stall product writes.
      const batch = await inTurn(async () => (await decisions()).filter(entry => !entry.sent).slice(0, 50));
      if (!batch.length) return true;
      const response = await fetch(`${config.workerUrl.replace(/\/$/, '')}/extension/log`, {method: 'POST',
        headers: {Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({entries: batch})});
      if (!response.ok) return false;
      const sent = new Set(batch.map(entry => entry.at + entry.text));
      await inTurn(async () => chrome.storage.local.set({[LOG_KEY]: (await decisions())
        .map(entry => (sent.has(entry.at + entry.text) ? {...entry, sent: true} : entry))}));
    }
  } catch { return false; /* not paired, or the app is closed: they stay unsent for the next push */ }
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
