// Wait for committed form values, closed job tabs and app log completions; caps only catch hangs.
// Job: wait on state
/* global window */
import {appLogText} from './app-log.mjs';
import {pause as sleep} from './apply-fixtures.mjs';

/** Waits until every app start in `profile`'s log has `done` logged after it (as many `done` lines as `[app] start ` lines); throws after `capMs` (a hang), naming `what`. */
export async function waitForLogLine(profile, done, {what = done.source, capMs = 90000, now = Date.now, pause = sleep} = {}) {
  const settled = () => { const log = appLogText(profile); return (log.match(done) || []).length >= (log.match(/\[app\] start /g) || []).length; };
  const {value} = await waitForFormValue(settled, value => value, {capMs, now, pause, strictCap: true, retryRead: false, log: () => {}});
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

// Preserve the last value across transient reads; log waits propagate read failures instead.
async function readState(read, value, retryRead) {
  try { return {value: await read(), readOk: true}; } catch (error) {
    if (!retryRead) throw error;
    return {value, readOk: false};
  }
}

// Log waits keep full ticks and a strict deadline; value waits stop on the cap without oversleeping it.
function pollLimit(ms, capMs, tickMs, strictCap) {
  return {expired: strictCap ? ms > capMs : ms >= capMs, delay: strictCap ? tickMs : Math.min(tickMs, capMs - ms)};
}

/**
 * Poll until a string matches or a predicate accepts the read value.
 * Exhaustion returns the last successful read and elapsed ms; now/pause allow clock-free tests.
 * Value reads retry transient errors. Log waits retain their strict deadline, whole ticks and read errors.
 * The label formats a slow success for log; app log completion waits stay silent.
 */
export async function waitForFormValue(read, wanted, {capMs = 45000, tickMs = 250, log = console.log, label = ms => `the form value held its answer ${ms} ms after the wait started`, now = Date.now, pause = sleep, strictCap = false, retryRead = true} = {}) {
  const start = now();
  const accepts = typeof wanted === 'function' ? wanted : value => value === wanted;
  let value = '';
  for (;;) {
    const result = await readState(read, value, retryRead);
    value = result.value;
    const ms = now() - start;
    if (result.readOk && accepts(value)) {
      if (ms > 300) log(`  ${label(ms)}`);
      return {value, ms};
    }
    const limit = pollLimit(ms, capMs, tickMs, strictCap);
    if (limit.expired) return {value, ms};
    await pause(limit.delay);
  }
}
