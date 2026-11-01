// Which failed steps get one more try: the environment's failures in every run (as since #266), and in a beta also any other step except safety and data steps.
// Why (1 Nov 2026, owner, "Auto-retry in betas only"): "In a beta (nightly or by hand), a non-safety, non-data step that fails gets one automatic retry. If it passes, the beta releases
// and the notes list it. PR, main and night runs keep one try, so flakes are still counted and fixed. Safety and data steps get no retry." Only desktop.yml's beta e2e jobs set
// E2E_BETA_RETRY (nightly and beta by hand; never e2e.yml, never a scheduled check): tests/test_e2e_single_try.py. The job itself still has one try; the retry is the runner's, in the step.
// Invariants: a step cut off by its hang cap or run with fault injection is never retried (its state cannot be trusted); a safety or data step is judged on its first try.
// Tests: test/harness/runner-beta-retry.test.mjs
// Job: report health
import {isEnvironment} from './environment.mjs';

export const BETA_RETRY = 'E2E_BETA_RETRY';

/** Whether this run is a beta (nightly or by hand): the workflow sets the flag, nothing else does. */
export const inBeta = (env = process.env) => env[BETA_RETRY] === '1';

/**
 * Whether a step that threw gets its one more try.
 * @param {{error: Error, faults?: boolean, safety?: boolean, data?: boolean, env?: object}} step what failed; `faults` = a fault-injection step; `env` = the process environment
 * @returns {boolean}
 */
export function mayRetry({error, faults = false, safety = false, data = false, env = process.env}) {
  if (faults || error?.stepHang) return false;
  if (isEnvironment(error?.message)) return true;
  return inBeta(env) && !safety && !data;
}

/** The job-log line when a step is tried once more: an environment failure is said to be one; any other failure is the beta's retry, never called an environment failure. */
export const retryLog = (name, message) => (isEnvironment(message)
  ? `↻ ${name}: the environment failed (${String(message).slice(0, 120)}), trying once more`
  : `↻ ${name}: failed (${String(message).slice(0, 120)}); beta retry, trying once more (not an environment failure)`);

/** The "suite · step" names of the steps that passed on their retry, from one suite's results (steps.json). */
export const passedOnRetry = (suite, results = []) => results.filter(result => result.status === 'passed' && result.retried).map(result => `${suite} · ${result.name}`);

/** The release-notes line for those steps, or '' when there are none. */
export const retryLine = items => (items.length ? `Passed on retry in this beta: ${items.join(', ')}` : '');
