// Poll form values, closed job tabs and app log completions with one hang cap; tolerate reads by composition.
// Job: wait on state
/* global chrome, window */
import {appLogText, currentLaunchLog} from './app-log.mjs';
import {pause as sleep} from './apply-fixtures.mjs';

// Why (30 Oct 2026, owner on #2612: "wait on the state, not on a specific time"): a step's measured hang cap (hang-caps.json, 3x calm main p95) is its
// only clock. The runner notes when it ends; a wait inside the step runs until then, never to a cap of its own that undercuts a measured delay.
let stepEndsAt = null;
// Why (30 Oct 2026, Gitar on #2620): a wait that ran to the cap itself lost the race to the step's hang timer, so a missing decision read as "it hung" and
// the step's own check ("not in the extension's decisions") never ran. The wait ends this much earlier; it is the step's time to report, not a wait.
const REPORT_MS = 2000;
/** Note that the running step's hang cap ends `ms` from now (lib/runner.mjs withLimit); null when the step is over. */
export const stepClock = ms => { stepEndsAt = ms == null ? null : Date.now() + ms; };
/** Milliseconds a wait in the running step may take, leaving REPORT_MS for the step to name what was missing; with no runner step (a unit test), undefined. */
export const stepTimeLeft = () => (stepEndsAt === null ? undefined : Math.max(0, stepEndsAt - Date.now() - REPORT_MS));
/**
 * Run a Playwright-style wait `run(timeout)` for as long as the step's clock leaves; with the clock spent, throw "the step's clock ran out before <what>" instead.
 * Why (31 Oct 2026, owner: "E: no zero timeouts"; a8 2/5 #2701, beta gate run 41200878403 apply-1of3 stalled 6.6 min): stepTimeLeft() is 0 once the clock is spent, and
 * Playwright reads `timeout: 0` as NO timeout, so a cleanup wait outlived its step and only the runner's generic report showed. stepTimeLeft() stays a cap for pollUntil
 * (0 there ends the wait at once); every Playwright timeout goes through here (guard test/no-zero-timeouts.test.mjs). With no runner step (a unit test): the wait's own default.
 */
export async function stepWait(what, run) {
  const left = stepTimeLeft();
  if (left !== undefined && left <= 0) throw new Error(`the step's clock ran out before ${what}`);
  return run(left);
}

/** Describe only an expired wait, using the timing wording owned by TIMEOUT_FAILURE; lastSeen retains the rejected observation. */
export const waitCapNote = (what, seconds, lastSeen) => `${what} did not finish within ${seconds} s (last seen: ${JSON.stringify(lastSeen)})`;

/** Wait for `done` after the latest recorded launch; no recorded starts are already settled. */
export async function waitForLogLine(profile, done, {what = done.source, capMs = 90000, now = Date.now, pause = sleep} = {}) {
  const starts = (appLogText(profile).match(/\[app\] start /g) || []).length;
  const settled = () => starts === 0 || new RegExp(done.source, done.flags).test(currentLaunchLog(profile, starts));
  const {value} = await pollUntil(settled, value => value, {capMs, now, pause, log: () => {}});
  if (!value) throw new Error(`${what} never finished (no "${done.source}" in the app's log)`);
}

/** Return whether this job has no open forms; existing sessions require a known tab report. */
export function formsClosedForJob({forms, sessions}, url) {
  const matching = sessions.filter(session => String(session.url || '').startsWith(url));
  return (forms?.known || matching.length === 0) && !matching.some(session => forms.ids.includes(session.id));
}

/** Wait for this job's earlier forms to close; a hang reports the last snapshot and elapsed ms. */
export async function waitJobFormClosed(page, url, options = {}) {
  const {value: closed, ms} = await waitForFormValue(() => page.evaluate(async () => ({forms: await window.pilot.formsOpen(), sessions: await window.pilot.sessions()})), state => formsClosedForJob(state, url), {
    label: ms => `the app reported the earlier form closed ${ms} ms after the tab was closed`, ...options,
  });
  if (!closed || !formsClosedForJob(closed, url)) throw new Error(`the app never saw the earlier form closed after waiting ${ms} ms (last report: ${JSON.stringify(closed)})`);
}

const UNREAD = Symbol('unread');

// A failed read keeps the last good value for diagnostics, marked so it cannot satisfy a predicate.
function tolerant(read) {
  let value = '';
  return async () => {
    try { value = await read(); return value; } catch { return {[UNREAD]: true, value}; }
  };
}

/** pollUntil's cap when the caller gives none; also what a helper that spends one budget across several waits falls back to. */
export const POLL_CAP_MS = 45000;

/**
 * Poll fresh reads until accepts succeeds or elapsed ms reaches capMs; return the last value and elapsed ms.
 * Read errors propagate unless the reader is composed with tolerant; unread values skip accepts.
 * Ticks are clipped to the remaining cap. The label formats slow successes; now/pause allow clock-free tests.
 */
export async function pollUntil(read, accepts, {capMs = POLL_CAP_MS, tickMs = 250, label = ms => `the state was observed ${ms} ms after the wait started`, log = console.log, now = Date.now, pause = sleep} = {}) {
  const start = now();
  let value = '';
  for (;;) {
    const result = await read(), unread = result?.[UNREAD] === true;
    value = unread ? result.value : result;
    const ms = now() - start;
    if (!unread && accepts(value)) {
      if (ms > 300) log(`  ${label(ms)}`);
      return {value, ms};
    }
    if (ms >= capMs) return {value, ms};
    await pause(Math.min(tickMs, capMs - ms));
  }
}

/**
 * Wait until `accepts(read())` under the running step's own clock (stepTimeLeft), never a number of seconds of its own; resolves {value: the last read, ms}. A read that throws
 * (the page moves under it) is read again. For the account flow's press and the session's stage, where the extension's calls to the app can take tens of seconds on a loaded runner.
 * Why (a8, 1 Nov 2026, main 3bd643e runs 41262512109 and 41263356357): both sign-in steps waited a loop of 60 s for the press inside a step with a measured 190 s cap; the press
 * came 63-70 s after the page opened (extension calls to the app: "slow push" postMs 23775, page-kind fetch 23487 ms) and the step reported "never pressed".
 */
export const waitForStage = (read, accepts, options = {}) => pollUntil(tolerant(read), accepts, {capMs: stepTimeLeft(), tickMs: 500, label: ms => `the account flow reached its state ${ms} ms after the wait started`, ...options});

/** Wait for a matching form value or predicate, tolerating transient reads without accepting stale values. */
export function waitForFormValue(read, wanted, options = {}) {
  const accepts = typeof wanted === 'function' ? wanted : value => value === wanted;
  return pollUntil(tolerant(read), accepts, {label: ms => `the form value held its answer ${ms} ms after the wait started`, ...options});
}

const accountEvents = ['account page: answers typed there are not learned', 'account page: a sign-in or sign-up press, not an application submit'];

/** Read only events made since this attempt began (each line starts with its ISO time) on its host; a submit event must also name its account path. */
export function accountSafetyEvidence(log, {since = '', host, path}) {
  const lines = String(log).split('\n').filter(line => line.slice(0, 24) >= since);
  const missing = accountEvents.filter((message, index) => !lines.some(line => {
    if (!line.includes(message)) return false;
    try {
      const fields = JSON.parse(line.slice(line.indexOf('{')));
      return fields.host === host && (index === 0 || fields.path === path);
    } catch { return false; }
  }));
  return {complete: missing.length === 0, missing, log: lines.join('\n')};
}

/**
 * The extension's decisions as app.log lines (desktop/lib/server-env.js onLog writes them the same way), read where they are made: the extension's own store
 * (extension/log.js), then app.log for those the store has rolled out. Why (30 Oct 2026, owner on #2612; #2608): the store is the copy this wait reads: it lags the log's
 * memory (the line's owner since 31 Oct 2026, extension/log.js) by the one write in flight, a few ms, never a push; it stays the copy because the worker's memory is not readable from outside (Gitar on #2673); app.log gets it by a push that ran 14-62 s late, so steps that read app.log waited on delivery, not on the decision (3 tries: 10 s, 45 s, 60 s).
 */
export async function extensionDecisions({browser, profile}) {
  const kept = await browser.serviceWorker().then(worker => worker.evaluate(async () => (await chrome.storage.local.get('jp-decisions'))['jp-decisions'] || [])).catch(() => []);
  return [...kept.map(entry => `${entry.at} [extension] ${entry.kind}: ${entry.text} ${JSON.stringify(entry.fields || {})}`), appLogText(profile)].join('\n');
}

/** Wait until every expected decision line (RegExps; a g flag is ignored) is read; resolves {value: the last read, ms}. The step's hang cap is the only clock. */
export function waitForDecisions(readDecisions, lines, options = {}) {
  return pollUntil(tolerant(readDecisions), log => lines.every(line => String(log).search(line) !== -1),
    {capMs: stepTimeLeft(), label: ms => `the extension's decision lines were read ${ms} ms after the wait started`, ...options});
}

/** Poll the account safety events made since the attempt began; the step's hang cap is the only clock. */
export function waitForAccountSafety(readDecisions, attempt, options = {}) {
  return pollUntil(tolerant(async () => accountSafetyEvidence(await readDecisions(), attempt)), value => value.complete,
    {capMs: stepTimeLeft(), label: ms => `the account safety events were read ${ms} ms after the wait started`, ...options});
}
