// Job: pick the suites
// The night burn-in's pass: what one of the five nightly full runs tests, and on which commit. Every pass tests the commit of pass 1, so the five are five looks at ONE tree.
// Why (31 Oct 2026, owner: "I want predictability. If a test was green last time, it should be green this time as well, if the code didn't change on that area."; chosen:
// "Spread the 5 burn-in passes over the night at different hours, not back to back (keeps PR CI free by day, and catches time-of-day flakes like calendar's)"): the passes
// are ordinary runs of e2e.yml on the beta's own layout (every suite, both stores, Windows following); the beta gate (a8, PR 2/3) folds their steps.json into its record like any run's.
// Why (31 Oct 2026, a8 with the coordinator): no AI spend without the owner's yes, so a pass leaves out the suites that ask the model live and the paid judge steps; those get their
// proof from the other runs that count. Guard: test/night-pass.test.mjs.
import {NIGHT_REPORT, autoSuites} from './plan.mjs';

export const NIGHT_PASSES = 5;
export const NIGHT_TITLE = 'Night burn-in';   // the run-name's first words; every list of "runs that are not main's check" holds it (tools/main_e2e_state.py NOT_MAIN_CHECK and its siblings)
const LIVE_AI = ['qualityai'];   // the suites that ask the model live in every run (e2e.yml E2E_AI_REPLAY is '0' for them); a night pass has no AI budget
const SPAN_MS = 14 * 3600 * 1000;   // pass 1 is at 21:00 UTC and pass 5 at 05:30: a pass looks for pass 1 within the night, never a previous one

/** "3/5" -> 3; anything else (including 0 and 6) -> 0. */
export function passNumber(text) {
  const found = /^(\d)\/(\d)$/.exec(String(text || '').trim());
  return found && Number(found[2]) === NIGHT_PASSES && Number(found[1]) >= 1 && Number(found[1]) <= NIGHT_PASSES ? Number(found[1]) : 0;
}

/**
 * The suites a pass tests: everything the beta's gate runs, minus the ones that ask the model live and the outside world (real Notion, not the app). Pass 1 also runs the night-report
 * suites (lib/plan.mjs): once a night is a report; five looks at them would be five reports.
 */
export const nightSuites = (all, cadence, pass = 0) => {
  const gate = autoSuites(all, cadence).filter(suite => cadence[suite] !== 'outside' && !LIVE_AI.includes(suite));
  return all.filter(suite => gate.includes(suite) || (pass === 1 && cadence[suite] === NIGHT_REPORT));
};

/**
 * The commit this pass tests: pass 1 tests the head it started on (`sha`); a later pass tests the head of the newest "Night burn-in 1/5" run started within the night.
 * When pass 1 never started (a Worker miss) it tests its own head and says so. runs: [{displayTitle, headSha, createdAt}] newest first.
 * @returns {{pass: number, ref: string, why: string}}
 */
export function nightRef({pass, sha, runs = [], now = Date.now()}) {
  const number = passNumber(pass);
  if (!number) throw new Error(`night pass "${pass}" is not n/${NIGHT_PASSES}`);
  if (number === 1) return {pass: number, ref: sha, why: 'pass 1 tests the head it started on'};
  const first = runs.find(run => run.displayTitle?.startsWith(`${NIGHT_TITLE} 1/${NIGHT_PASSES} · `) && now - Date.parse(run.createdAt) < SPAN_MS);
  return first ? {pass: number, ref: first.headSha, why: `pass ${number} tests pass 1's commit ${first.headSha.slice(0, 8)}`}
    : {pass: number, ref: sha, why: `pass 1 of this night was not found: pass ${number} tests its own head`};
}
