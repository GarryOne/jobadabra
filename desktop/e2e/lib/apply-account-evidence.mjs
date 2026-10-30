// Wait for this account attempt's safety events, including asynchronously batched extension logs.
// Job: wait on state
import {pollUntil} from './wait-on-state.mjs';

const expected = ['account page: answers typed there are not learned', 'account page: a sign-in or sign-up press, not an application submit'];

/** Read only events appended by this attempt and host; a submit event must also name its account path. */
export function accountSafetyEvidence(log, {after = 0, host, path}) {
  const lines = String(log).slice(after).split('\n');
  const missing = expected.filter((message, index) => !lines.some(line => {
    if (!line.includes(message)) return false;
    try {
      const fields = JSON.parse(line.slice(line.indexOf('{')));
      return fields.host === host && (index === 0 || fields.path === path);
    } catch { return false; }
  }));
  return {complete: missing.length === 0, missing, log: String(log).slice(after)};
}

/** Poll the actual account safety events; the cap catches missing delivery and is never a speed assertion. */
export function waitForAccountSafety(readLog, attempt, options = {}) {
  return pollUntil(() => accountSafetyEvidence(readLog(), attempt), value => value.complete,
    {capMs: 45000, label: ms => `the account safety events arrived ${ms} ms after the wait started`, ...options});
}
