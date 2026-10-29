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

test('there is no start-time force-stop without an aggregate; budgeted suites keep budget plus three minutes', () => {
  assert.equal(runner.stopMsOf({aggregateBudget: false}), null);
  assert.equal(runner.stopMsOf({budgetMinutes: 11}), 840000);
  assert.equal(runner.stopMsOf({}), SUITE_BUDGET_MS + 180000);
  assert.equal(runner.stopMsOf(null), SUITE_BUDGET_MS + 180000);
});

test('every suite with its own budget has a job limit above two runs of it (the first, and the "once more" after a red one)', async () => {
  for (const name of SUITES) {
    const suite = await import(`../suites/${name}.mjs`);
    if (!suite.budgetMinutes) continue;
    assert.ok((suite.minutes || 15) >= 2 * suite.budgetMinutes + 4 || suite.budgetMinutes <= 10, `${name}: minutes ${suite.minutes} cannot hold two runs of its ${suite.budgetMinutes}-minute budget (CI cancels the job and the evidence is lost)`);
  }
});
