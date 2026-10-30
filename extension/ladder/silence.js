// The silent dead-end rule (spec docs/superpowers/specs/2026-10-12-one-next-move.md, phase 2 box 2: "ONE rule, no list"): an application with no progress for SILENT_AFTER_MS whose run
// has not ended is a dead end the run did not admit. Progress is ladder/progress.js's fixed kinds only: activity without progress (a press, an AI ask) never restarts the clock. The run has
// ended when the door spoke (ladder/dead-end.js deadEnd: every stop, the person-stops among them) or the page was handed to the person (form-ready.js: ready on the final step, so
// Submit is theirs, or needs_person). Per APPLICATION (its job), not per tab: Apply opening a new tab moves the application on, it never leaves the posting tab "silent".
// In SHADOW: a silence is noted once (progress.js hands the notice to the door, {shadow: true}); nothing else happens. The clock lives in the worker: a worker that sleeps forgets it
// (a miss is today's behaviour). Pure apart from its timer, so the CI pool's logs are read with the same rule. Guard: worker/test/silence.test.js.

// T = 30 s, measured on the CI pool (13 Oct 2026: 4 runs, 12 rows, 43 gaps between progress notes; desktop/e2e/lib/pool-gaps.mjs) WITH the asks to the app taken out (the clock stands still while one is
// out, below): the slowest normal quiet gap is 18.8 s (it was 51.5 s in wall time: a fill waiting for the AI's answers to 15 questions). On the 9 rows that reached the form: false fires 0 at 30 s
// (1 at 20 s, 4 at 15 s); recall 1/1 (the one true stall). Censoring: the pool cuts a quiet stall at 20 s, so a stall's length above that is not measured. A miss is today's behaviour.
export const SILENT_AFTER_MS = 30000;

// An ask to the app in flight is a wait, never a stall (13 Oct 2026, cc: the pool's slowest "gap" was a fill waiting 30 s for the AI's answers to 15 questions): the clock stands still while
// one is out. The pause belongs to the application of the tab whose ask is out (14 Oct 2026: it was summed across tabs, so an ask on one application also paused another's clock): flow.js
// apiFor(tabId, ...) brackets the call with askStarted(tabId) / askEnded(what it returned); the time with at least one ask of that application out is summed. A tab-less ask (api()) pauses nothing:
// a miss is today's behaviour.
const asks = new Map();   // application -> {count, since, total}
export function askStarted(tabId, now = Date.now()) {
  if (tabId == null) return null;
  const app = appOf(tabId), ask = asks.get(app) || {count: 0, since: 0, total: 0};
  if (ask.count++ === 0) ask.since = now;
  asks.set(app, ask);
  return app;   // askEnded gets it back: the tab may be given its job while the ask is out
}
export function askEnded(app, now = Date.now()) {
  const ask = asks.get(app);
  if (ask && ask.count > 0 && --ask.count === 0) ask.total += now - ask.since;
}
export const askTime = (app, now = Date.now()) => { const ask = asks.get(app); return ask ? ask.total + (ask.count ? now - ask.since : 0) : 0; };
// The silence's length: the time since the last progress that was not spent waiting on an ask (clock.waited: the application's askTime at the note; none: the plain time, as the offline measurement keeps it).
export const quietFor = (clock, now) => now - clock.at - (clock.waited == null ? 0 : askTime(clock.app, now) - clock.waited);

// The rule: a clock {at, ended, noticed} is silent at `now` when nothing ended it, it was not noted yet, and its quiet time (the time since its last progress, asks excluded) is T.
export const isSilent = (clock, now, T = SILENT_AFTER_MS) => !!clock && !clock.ended && !clock.noticed && quietFor(clock, now) >= T;
// The form judge's answer that hands the page to the person (desktop/lib/form-judge.js): their choice is needed, or the form is ready on its final step (Submit is theirs).
export const handedToPerson = answer => answer?.answer === 'needs_person' || (answer?.answer === 'ready' && answer?.step === 'final');

const jobs = new Map();   // tabId -> the application (its job, without the #part) the tab works on
const clocks = new Map();   // application -> {at, kind, host, ended, noticed, timer}
let notice = () => {};
let ended = () => {};   // the run said its last word for an application (endSilence): progress.js logs "run ended", which ends a test run's quiet watch early (desktop/e2e/lib/live-still.mjs)
let timer = (fn, ms) => { const id = setTimeout(fn, ms); id?.unref?.(); return id; };
let cancel = id => clearTimeout(id);
// parts: {notice(host, evidence, tabId)} (progress.js: the door), {ended(host, tabId)} (progress.js: the "run ended" line), and for the tests {timer, cancel}.
export function useSilence(parts = {}) {
  if (parts.notice) notice = parts.notice;
  if (parts.ended) ended = parts.ended;
  if (parts.timer) timer = parts.timer;
  if (parts.cancel) cancel = parts.cancel;
}
function appOf(tabId) { return jobs.get(tabId) || `tab ${tabId}`; }
const stop = clock => { if (clock?.timer != null) cancel(clock.timer); if (clock) clock.timer = null; };

// Which application a tab works on (progress.js, at each page the fill flow considers).
export function silenceTab(tabId, job) {
  const key = String(job || '').split('#')[0];
  if (tabId != null && key) jobs.set(tabId, key);
}

function check(app, now) {
  const clock = clocks.get(app);
  if (!isSilent(clock, now)) {   // not yet: an ask was out, so the clock stood still; looked at again when the rest of T would be up
    if (clock && !clock.ended && !clock.noticed) { stop(clock); clock.timer = timer(() => check(app, Date.now()), Math.max(1000, SILENT_AFTER_MS - quietFor(clock, now))); }
    return false;
  }
  clock.noticed = true;
  notice(clock.host, {kind: clock.kind, silentMs: quietFor(clock, now)}, clock.tab);
  return true;
}
export const checkSilence = (tabId, now = Date.now()) => check(appOf(tabId), now);

// A progress note (progress.js): the application's clock starts again, checked T from now. host: the page's, when the note knows it (a new page), else the last one.
export function restartSilence(tabId, kind, {now = Date.now(), host = ''} = {}) {
  if (tabId == null) return;
  const app = appOf(tabId), before = clocks.get(app);
  stop(before);
  const clock = {at: now, app, tab: tabId, waited: askTime(app, now), kind, host: host || before?.host || '', ended: false, noticed: false, timer: null};
  clocks.set(app, clock);
  clock.timer = timer(() => check(app, Date.now()), SILENT_AFTER_MS);
}
// The run ended for this tab's application (the door spoke, or the page was handed to the person): the silence from here on is expected.
export function endSilence(tabId) {
  const clock = clocks.get(appOf(tabId));
  if (!clock) return;
  const first = !clock.ended;
  clock.ended = true;
  stop(clock);
  if (first) ended(clock.host, tabId);   // once per clock: the door and the form judge may both speak
}
// A closed tab: its application's clock goes once no other tab works on it.
export function forgetSilence(tabId) {
  const app = appOf(tabId);
  jobs.delete(tabId);
  if ([...jobs.values()].includes(app)) return;
  stop(clocks.get(app));
  clocks.delete(app);
}
export const silenceOf = tabId => {
  const clock = clocks.get(appOf(tabId));
  return clock ? {at: clock.at, kind: clock.kind, host: clock.host, ended: clock.ended, noticed: clock.noticed} : null;
};
