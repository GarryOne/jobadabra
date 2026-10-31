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

// Design (31 Oct 2026, a8, owner "Evidence first"): the log is a spectator and costs the product nothing.
// - `ring` in memory is the one owner of the lines (sent or not); storage holds a crash copy of it, read once per worker start.
// - decide() appends in memory at once. The copy is written once per burst: lines added while a write runs are covered by the next turn of the same write, never by a write of their own.
// - The push reads its batches from memory and marks them sent in memory; fetch never waits for storage.
// - A full ring drops sent lines first; a dropped unsent line leaves one "log dropped N" line, so a missing stretch is never silent.
// Why (31 Oct 2026, a8; run 41162490590): the old get+set of all 200 lines per line made a 24-lines/s burst queue for 10-14 s (readMs 10726, markMs 13660, postMs 18) and the app got the lines up to 184 s late; the failing step's own lines never arrived.
// Why (31 Oct 2026, a8, #2673 red "page cases 1", required-salutation-menu-1): the lines used to be POSTed as chrome.storage returned them, keys sorted, and recorded cases'
// "told" words match that text ("label":"Title","outcome":"left","reason":...: no "type" between them because it sorts last). From memory the keys keep their insertion order, so the
// same line stopped matching. The wire keeps its old key order at every depth; arrays keep theirs.
const sortedKeys = value => (Array.isArray(value) ? value.map(sortedKeys)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedKeys(value[key])])) : value);
const logBoot = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;   // this worker's log, named on its first line
let ring = [];
let loading = null, lastBefore, bootStamped = false, firstNew = null, writing = null, writeAgain = false, appended = 0, written = 0;
const releasers = [];
const versionNow = () => { try { return chrome.runtime.getManifest().version; } catch { return ''; } };
const isMarker = entry => entry.kind === 'log' && /^log dropped \d+$/.test(entry.text);
/** Name this worker's log on its first line, and how long the log had been silent before it (a restart shows here). */
function stamp(entry, previous) {
  const gap = previous ? Date.parse(entry.at) - Date.parse(previous.at) : NaN;
  entry.fields = {...entry.fields, logBoot, ...(Number.isFinite(gap) ? {sinceLastLineMs: Math.max(0, gap)} : {})};
}
/** Hydrate the ring from the crash copy once. It never rejects: a storage that cannot be read is an empty crash copy. */
function loaded() {
  return loading ||= (async () => {
    let kept = [];
    try { kept = (await decisions()).filter(entry => entry && typeof entry === 'object' && entry.at); } catch { /* unreadable: start empty */ }
    lastBefore = kept.at(-1) || null;
    if (firstNew) stamp(firstNew, lastBefore);
    ring = [...kept, ...ring];
  })();
}
// Fills the ring back to LOG_KEEP: sent lines go first (oldest first); an unsent line that must go is counted in the ONE marker line (updated in place, never stacked).
function trim() {
  if (ring.length <= LOG_KEEP) return;
  const marker = ring.find(entry => isMarker(entry) && !entry.sent), drop = new Set();
  const excess = ring.length - LOG_KEEP;
  for (let i = 0; i < ring.length && drop.size < excess; i++) if (ring[i].sent) drop.add(i);
  let lost = 0;
  const need = drop.size < excess ? excess - drop.size + (marker ? 0 : 1) : 0;   // a new marker takes a slot of its own
  for (let i = 0; i < ring.length && lost < need; i++) if (!drop.has(i) && ring[i] !== marker) { drop.add(i); lost++; }
  ring = ring.filter((_, i) => !drop.has(i));
  if (!lost) return;
  if (marker) { marker.fields = {...marker.fields, lost: marker.fields.lost + lost}; marker.text = `log dropped ${marker.fields.lost}`; }
  else ring.push({at: new Date().toISOString(), kind: 'log', text: `log dropped ${lost}`, fields: {lost, version: versionNow()}, sent: false});
}
/** Write the ring once for every line appended so far; callers during a write share it and its follow-up. */
function persist() {
  writeAgain = true;
  writing ||= (async () => {
    try {
      await loaded();
      while (writeAgain) {
        writeAgain = false;
        const upTo = appended;
        trim();
        try { await chrome.storage.local.set({[LOG_KEY]: ring.slice()}); } catch { /* the ring stays in memory; the next burst writes it again */ }
        written = upTo;
        for (const item of releasers.splice(0)) { if (item.seq <= written) item.resolve(); else releasers.push(item); }
      }
    } finally { writing = null; }
  })();
  return writing;
}
/** Resolve when the crash copy holds everything appended so far (for a caller or test that needs storage current; the push never waits for it). */
export const crashCopyWritten = () => flushed();
/** Resolve when a write that started after this call's line was appended has finished (later lines are not waited for). */
function flushed() {
  const seq = ++appended;
  const done = new Promise(resolve => releasers.push({seq, resolve}));
  persist().catch(() => {});
  return done;
}
/** Take one decision in memory at once, persist it with its burst, and request delivery without waiting for the app. */
export async function decide(kind, text, fields = {}) {
  const entry = {at: new Date().toISOString(), kind: String(kind).slice(0, 24), text: String(text).slice(0, 300),
    fields: {...fields, version: versionNow()}, sent: false};
  if (!bootStamped) { bootStamped = true; if (lastBefore !== undefined) stamp(entry, lastBefore); else firstNew = entry; }   // the first line of this worker, whether the crash copy was read yet or not
  ring.push(entry);
  if (ring.length > LOG_KEEP * 1.5) trim();   // a stalled storage must not grow the ring without bound
  const persisted = flushed();
  pushDecisions();
  await persisted;
  return entry;
}
let spanId = 0;
/** Bracket one awaited operation without awaiting logging; preserve its result or rejection and log only ids and duration. */
export async function span(name, promiseFactory) {
  const id = ++spanId, began = Date.now();
  // Why (30 Oct 2026, ap): instrumentation never delays the work or exposes rejection text.
  decide('span', `${name} start`, {id}).catch(() => {});
  let failed = false;
  try { return await promiseFactory(); }
  catch (error) { failed = true; throw error; }
  finally { decide('span', `${name} end`, {id, ms: Date.now() - began, ...(failed ? {failed: true} : {})}).catch(() => {}); }
}

// Design: pushDecisions owns idle -> running -> idle; all callers share the running promise.
// Calls while running set dirty, coalescing into one follow-up drain rather than one POST each.
// Each drain sends all unsent lines oldest first in batches <= 50, marking only an ok batch.
// A failed POST ends the owner, leaving unsent lines for the next explicit push; no timers.
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
// Why (30 Oct 2026, a8, #2608): in beta 41090972183 this push stalled 14-62 s while every other call to the app answered in under 0.5 s.
// A cycle this slow writes one "slow push" line naming its phase (the wait for the ring, the POST, the write of the sent marks), so a run says which one.
const SLOW_PUSH_MS = 5000;
async function pushNow() {
  // One cycle's marks: start, then settings (first cycle only), read, posted, marked as each phase ends; a phase not reached has no mark.
  let marks = {start: Date.now()};
  const noteIfSlow = (failed = false) => {
    const now = Date.now(), {start, settings: configured = start, read, posted, marked, lines, onlyNotes} = marks;
    // Why (Gitar on #2612): a cycle that carried only earlier notes writes none, or a still-slow app would keep the drain sending one note after another.
    if (now - start < SLOW_PUSH_MS || onlyNotes) return;
    const between = (from, to) => (from === undefined || to === undefined ? undefined : to - from);
    const phases = {settingsMs: configured - start, readMs: between(configured, read), postMs: between(read, posted ?? (failed ? now : undefined)), markMs: between(posted, marked)};
    decide('log', 'slow push', {...Object.fromEntries(Object.entries(phases).filter(([, ms]) => ms !== undefined)), lines, ...(failed ? {failed: true} : {})}).catch(() => {});
  };
  try {
    const config = await settings();
    marks.settings = Date.now();
    await loaded();
    while (true) {
      // Why (30 Oct 2026, ap; Gitar on the span PR): drain oldest first in route-safe batches of 50; only an ok batch is marked sent, and fetch stays outside storage so spans cannot stall product writes.
      const batch = ring.filter(entry => !entry.sent).slice(0, 50);
      if (!batch.length) return true;
      Object.assign(marks, {read: Date.now(), lines: batch.length, onlyNotes: batch.every(entry => entry.kind === 'log' && entry.text === 'slow push')});
      const response = await fetch(`${config.workerUrl.replace(/\/$/, '')}/extension/log`, {method: 'POST',
        headers: {Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({entries: batch.map(sortedKeys)})});
      marks.posted = Date.now();
      if (!response.ok) { noteIfSlow(true); return false; }
      for (const entry of batch) entry.sent = true;   // the entries themselves, so a trim during the POST cannot mark a neighbour
      persist().catch(() => {});   // the crash copy follows; the next POST never waits for storage (Gitar on #2673: a stalled `set` must not stop the drain)
      marks.marked = Date.now();
      noteIfSlow();
      marks = {start: Date.now()};
    }
  } catch {
    noteIfSlow(true);
    return false; /* not paired, or the app is closed: they stay unsent for the next push */
  }
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
