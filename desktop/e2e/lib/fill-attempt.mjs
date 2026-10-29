// Wait for one fill attempt and keep the evidence from its last read.
// Job: wait on state
import {setTimeout as sleepFor} from 'node:timers/promises';
import {pollUntil} from './wait-on-state.mjs';

/** Re-resolve one attempt on every tick; accept every read, including at the hang cap. */
export async function waitForFill({capMs, pickTab, readState, now = Date.now, sleep = sleepFor,
  accept = state => state?.state === 'done' || state?.state === 'error'}) {
  const {value, ms} = await pollUntil(async () => {
    const {tab, tabs} = await pickTab();
    const state = tab ? await readState(tab) : null;
    return {ok: accept(state), state, tab, tabs, url: tab?.url?.() || ''};
  }, result => result.ok, {capMs, tickMs: 500, now, pause: sleep, log: () => {}});
  return {...value, ms};
}
