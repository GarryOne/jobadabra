// Wait for a committed form value, with a hang cap instead of a speed assertion.
/* global window */
// Job: wait on state
import {pause as sleep} from './apply-fixtures.mjs';

/** Return whether this job has no open forms; existing sessions require a known tab report. */
export function formsClosedForJob({forms, sessions}, url) {
  const matching = sessions.filter(session => String(session.url || '').startsWith(url));
  return (forms?.known || matching.length === 0) && !matching.some(session => forms.ids.includes(session.id));
}

/** Wait for this job's earlier forms to close; a hang reports the last snapshot and elapsed ms. */
export async function waitJobFormClosed(page, url) {
  const {value: closed, ms} = await waitForFormValue(() => page.evaluate(async () => ({forms: await window.pilot.formsOpen(), sessions: await window.pilot.sessions()})), state => formsClosedForJob(state, url));
  if (!closed || !formsClosedForJob(closed, url)) throw new Error(`the app never saw the earlier form closed after waiting ${ms} ms (last report: ${JSON.stringify(closed)})`);
}

/**
 * Poll until a string matches or a predicate accepts the read value.
 * The cap catches hangs only; exhaustion returns the last successful read and elapsed ms.
 * Transient read errors preserve that value. Inject now/pause for clock-free tests.
 */
export async function waitForFormValue(read, wanted, {capMs = 45000, tickMs = 250, log = console.log, now = Date.now, pause = sleep} = {}) {
  const start = now();
  const accepts = typeof wanted === 'function' ? wanted : value => value === wanted;
  let value = '';
  for (;;) {
    let readOk = false;
    try { value = await read(); readOk = true; } catch { /* navigation may replace the document between reads */ }
    const ms = now() - start;
    if (readOk && accepts(value)) {
      if (ms > 300) log(`  the form value held its answer ${ms} ms after the wait started`);
      return {value, ms};
    }
    if (ms >= capMs) return {value, ms};
    await pause(Math.min(tickMs, capMs - ms));
  }
}
