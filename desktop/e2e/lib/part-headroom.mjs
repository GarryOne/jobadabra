// How much of its budget a suite part may use on its slowest leg (Mac + the Notion stand-in), and the slice loads of a step-sharded suite from measured seconds.
// Job: pick the suites
// Why (31 Oct 2026, a8; beta 41229992832): apply-3of3 used 698 s of 660 on the stand-in leg after sitting at ~95% for weeks. A part blocks a beta only when it fits with headroom on its slowest leg.
// HEADROOM 75% (495 s of 660): the 4 betas of 31 Oct 2026 put every other part at or under 71% on both stores (tools/e2e-part-times.mjs; recorded-1of5..5of5 at 70-71%), so 75% asks for
// a quarter of the budget spare over the slowest seen without adding a runner job to a part that has run steadily. Guard: test/part-headroom.test.mjs.
import {TRY_MARGIN_MS} from './runner.mjs';
import {weighedSlices} from './replay-shard.mjs';

// A gate part's step has timeout-minutes 15 (E2E_TRY_MINUTES in e2e.yml and desktop.yml; tests/test_e2e_try_minutes.py); a suite without an aggregate stops TRY_MARGIN_MS before it,
// and recorded's own budgetMinutes is the same 11. So every part has 11 minutes = 660 s.
export const TRY_MINUTES = 15;
export const BUDGET_SECONDS = (TRY_MINUTES * 60000 - TRY_MARGIN_MS) / 1000;
export const HEADROOM = 0.75;

/** The part times over the limit (seconds above HEADROOM x budget), as [{seconds, limit}]; [] when every one fits. */
export function over(times, {budget = BUDGET_SECONDS, headroom = HEADROOM} = {}) {
  const limit = budget * headroom;
  return times.filter(seconds => seconds > limit).map(seconds => ({seconds, limit}));
}

/**
 * Seconds each slice of a step-sharded suite needs on the slowest leg: the setup that runs in every slice plus the measured seconds of the steps the weighed split gives it.
 * `weights` cut the steps (step head -> seconds, as suites/*.mjs stepSeconds); `measured` is what each head takes on the slowest leg (fixtures/apply-slowest-leg.json).
 */
export function sliceLoads(weights, count, measured, setupSeconds) {
  const owner = weighedSlices(weights, count);
  return Array.from({length: count}, (_, at) => setupSeconds + Object.entries(measured).filter(([head]) => owner[head] === at + 1).reduce((sum, [, seconds]) => sum + seconds, 0));
}
