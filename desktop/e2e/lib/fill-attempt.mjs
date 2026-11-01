// Wait for one fill attempt and keep the evidence from its last read.
// Job: wait on state
import {setTimeout as sleepFor} from 'node:timers/promises';
import {pollUntil, stepTimeLeft} from './wait-on-state.mjs';

/**
 * Re-resolve one attempt on every tick; accept every read, including at the hang cap. `capMs` is the step's own clock unless a caller gives one.
 * Why (1 Nov 2026, night run 41253960704, apply-3of3 Tailor CV): a private 90 s cap undercut the step's measured hang cap (lib/wait-on-state.mjs "its only clock"): a macOS
 * runner stall of ~25 s let the fill end at 94 s and the wait gave up at 90 s ("last seen: running") although the app log said "filled the form" 0.8 s later.
 */
export async function waitForFill({capMs = stepTimeLeft(), pickTab, readState, now = Date.now, sleep = sleepFor,
  accept = state => state?.state === 'done' || state?.state === 'error'}) {
  const {value, ms} = await pollUntil(async () => {
    const {tab, tabs} = await pickTab();
    const state = tab ? await readState(tab) : null;
    return {ok: accept(state), state, tab, tabs, url: tab?.url?.() || ''};
  }, result => result.ok, {capMs, tickMs: 500, now, pause: sleep, log: () => {}});
  return {...value, ms};
}
