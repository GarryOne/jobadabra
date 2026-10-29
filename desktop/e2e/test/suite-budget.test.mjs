// A suite's own budget (budgetMinutes) and the limits around it agree: the force-stop (suite.mjs) is budget + 3 min and the CI job's limit (`minutes`) holds setup + the budget + the "once more" run.
import assert from 'node:assert/strict';
import test from 'node:test';
import {SUITES} from '../lib/context.mjs';
import * as runner from '../lib/runner.mjs';
const {budgetMsOf, SUITE_BUDGET_MS} = runner;

test('a suite without its own budget gets the default, one with budgetMinutes gets that', () => {
  assert.equal(budgetMsOf({}), SUITE_BUDGET_MS);
  assert.equal(budgetMsOf(null), SUITE_BUDGET_MS);
  assert.equal(budgetMsOf({budgetMinutes: 11}), 11 * 60000);
  assert.equal(budgetMsOf({aggregateBudget: false, budgetMinutes: 7}), Infinity);
});

test('the force-stop uses the explicit plumbing cap without an aggregate, and budget plus three minutes otherwise', () => {
  assert.equal(runner.stopMsOf({aggregateBudget: false, stopMinutes: 12}), 720000);
  assert.equal(runner.stopMsOf({budgetMinutes: 11}), 840000);
  assert.equal(runner.stopMsOf({}), SUITE_BUDGET_MS + 180000);
  assert.equal(runner.stopMsOf(null), SUITE_BUDGET_MS + 180000);
});

test('without an aggregate, a missing or invalid plumbing cap falls back to ten minutes', () => {
  for (const stopMinutes of [undefined, null, 0, -1, NaN, Infinity, '12']) {
    assert.equal(runner.stopMsOf({aggregateBudget: false, stopMinutes}), 600000);
  }
});

test('every suite with its own budget has a job limit above two runs of it (the first, and the "once more" after a red one)', async () => {
  for (const name of SUITES) {
    const suite = await import(`../suites/${name}.mjs`);
    if (suite.aggregateBudget === false) {
      assert.ok(Number.isFinite(suite.stopMinutes) && suite.stopMinutes > 0, `${name}: needs a finite, positive plumbing force-stop`);
      assert.ok((suite.minutes || 15) >= 2 * suite.stopMinutes + 4, `${name}: minutes ${suite.minutes} cannot hold two ${suite.stopMinutes}-minute force-stops plus setup`);
      continue;
    }
    if (!suite.budgetMinutes) continue;
    assert.ok((suite.minutes || 15) >= 2 * suite.budgetMinutes + 4 || suite.budgetMinutes <= 10, `${name}: minutes ${suite.minutes} cannot hold two runs of its ${suite.budgetMinutes}-minute budget (CI cancels the job and the evidence is lost)`);
  }
});
