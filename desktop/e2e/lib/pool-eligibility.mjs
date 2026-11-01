// Job: serve stored answers
// Pool runs measure FILLING, so the extension's eligibility stop is off in them (owner via the coordinator, 11 Oct 2026): the fake applicant cannot take most
// pool postings (Sydney, US on-site), and a stop hid how far the fill gets. record-sites.mjs gives every row, on BOTH paths (plain node: live.mjs -> lib/live-row.mjs;
// Electron: the apply suite -> lib/apply-live.mjs), LIVE_ELIGIBILITY=off; each live runner sets the harness extension's chrome.storage.local
// checkEligibility=false before Apply and says so in the run's first lines. RECORD_ELIGIBILITY=on keeps the stop.
// Guard: e2e/test/pool-eligibility.test.mjs.
/* global chrome */
import {recordVar} from '../../../tools/record-env.mjs';
import {setExtensionStorage} from '../../../desktop/ready-fill/extension-storage.mjs';

export const ELIGIBILITY_ENV = 'LIVE_ELIGIBILITY';

// The env a pool row runs with: eligibility off unless RECORD_ELIGIBILITY=on asks to keep the stop (to measure the stop itself).
export const poolEnv = (env = process.env) => ({...env, [ELIGIBILITY_ENV]: recordVar('ELIGIBILITY', env) === 'on' ? 'on' : 'off'});

export const eligibilityOff = (env = process.env) => env[ELIGIBILITY_ENV] === 'off';

export const POOL_LINE = 'eligibility check: OFF in this run (a pool run measures filling; RECORD_ELIGIBILITY=on keeps the stop)';

// Sets the extension's own switch (extension/options.js "Check eligibility before filling") through its service worker, then reads it back:
// a switch that did not take fails the run before anything is pressed. -> true when it was turned off, false when the env leaves it on.
export async function applyPoolEligibility(worker, {env = process.env, say = () => {}} = {}) {
  if (!eligibilityOff(env)) { say('eligibility check: on (LIVE_ELIGIBILITY is not "off")'); return false; }
  await setExtensionStorage(worker, {checkEligibility: false});
  const stored = await worker.evaluate(() => chrome.storage.local.get('checkEligibility'));
  if (stored?.checkEligibility !== false) throw new Error(`eligibility check: asked OFF, but the extension's storage says ${JSON.stringify(stored)}`);
  say(POOL_LINE);
  return true;
}

// Whether a recorded live row ran with the stop off (14 Oct 2026: the offline replay ran with it ON, so the kept "not a fit" answer stopped the fill and every later
// ask differed: Teamtailor 2/6, then 6/6 with it off). The record's own word (live-row.mjs, since 14 Oct), else the live run's log: the pool line or a fill "check off".
export const recordedEligibility = (record = {}, liveLog = '') => (['on', 'off'].includes(record.eligibility) ? record.eligibility
  : String(liveLog).includes(POOL_LINE) || /"forced":"check off"/.test(String(liveLog)) ? 'off' : 'on');
