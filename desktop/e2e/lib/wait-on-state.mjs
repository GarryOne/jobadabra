// Poll form values, closed job tabs and app log completions with one hang cap; tolerate reads by composition.
// Job: wait on state
/* global window */
import {appLogText, currentLaunchLog} from './app-log.mjs';
import {pause as sleep} from './apply-fixtures.mjs';

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

/** Read only events appended by this attempt and host; a submit event must also name its account path. */
export function accountSafetyEvidence(log, {after = 0, host, path}) {
  const lines = String(log).slice(after).split('\n');
  const missing = accountEvents.filter((message, index) => !lines.some(line => {
    if (!line.includes(message)) return false;
    try {
      const fields = JSON.parse(line.slice(line.indexOf('{')));
      return fields.host === host && (index === 0 || fields.path === path);
    } catch { return false; }
  }));
  return {complete: missing.length === 0, missing, log: String(log).slice(after)};
}

/**
 * Wait until every expected extension decision line is in the app's log; resolves {value: the last log read, ms}. Lines are RegExps (a g flag is ignored).
 * Why (30 Oct 2026, a8, #2608): the extension pushes its decisions in batches, and in beta 41090972183 they reached the app 14-62 s after they were made;
 * a step that read the log once, as the form finished, missed "page kind corrected". The cap catches a line that never arrives and is never a speed assertion.
 */
export function waitForDecisions(readLog, lines, options = {}) {
  return pollUntil(tolerant(readLog), log => lines.every(line => String(log).search(line) !== -1),
    {capMs: 60000, label: ms => `the extension's decision lines arrived ${ms} ms after the wait started`, ...options});
}

/** Poll the actual account safety events; the cap catches missing delivery and is never a speed assertion. */
export function waitForAccountSafety(readLog, attempt, options = {}) {
  return pollUntil(() => accountSafetyEvidence(readLog(), attempt), value => value.complete,
    {capMs: 45000, label: ms => `the account safety events arrived ${ms} ms after the wait started`, ...options});
}
