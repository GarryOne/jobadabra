// Poll form values, closed job tabs and app log completions with one hang cap; tolerate reads by composition.
// Job: wait on state
/* global chrome, window */
import {appLogText, currentLaunchLog} from './app-log.mjs';
import {pause as sleep} from './apply-fixtures.mjs';

// Why (30 Oct 2026, owner on #2612: "wait on the state, not on a specific time"): a step's measured hang cap (hang-caps.json, 3x calm main p95) is its
// only clock. The runner notes when it ends; a wait inside the step runs until then, never to a cap of its own that undercuts a measured delay.
let stepEndsAt = null;
/** Note that the running step's hang cap ends `ms` from now (lib/runner.mjs withLimit); null when the step is over. */
export const stepClock = ms => { stepEndsAt = ms == null ? null : Date.now() + ms; };
/** Milliseconds left in the running step; with no runner step (a unit test), undefined, so pollUntil keeps its own default. */
export const stepTimeLeft = () => (stepEndsAt === null ? undefined : Math.max(0, stepEndsAt - Date.now()));

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

/**
 * Poll fresh reads until accepts succeeds or elapsed ms reaches capMs; return the last value and elapsed ms.
 * Read errors propagate unless the reader is composed with tolerant; unread values skip accepts.
 * Ticks are clipped to the remaining cap. The label formats slow successes; now/pause allow clock-free tests.
 */
export async function pollUntil(read, accepts, {capMs = 45000, tickMs = 250, label = ms => `the state was observed ${ms} ms after the wait started`, log = console.log, now = Date.now, pause = sleep} = {}) {
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
 * (extension/log.js), then app.log for those the store has rolled out. Why (30 Oct 2026, owner on #2612; #2608): the store is a decision's one owner, written
 * at once; app.log gets it by a push that ran 14-62 s late, so steps that read app.log waited on delivery, not on the decision (3 tries: 10 s, 45 s, 60 s).
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
