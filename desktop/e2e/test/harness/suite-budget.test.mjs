// A suite's own budget (budgetMinutes) and the limits around it agree: the force-stop (suite.mjs) is budget + 3 min and the CI job's limit (`minutes`) holds setup + the budget + the "once more" run.
import assert from 'node:assert/strict';
import test from 'node:test';
import {SUITES} from '../../lib/context.mjs';
import * as runner from '../../lib/runner.mjs';
import {flakyProof} from '../../lib/flaky-proof.mjs';
import {TEARDOWN_STOP_MS} from '../../lib/suite-main.mjs';
const {budgetMsOf, SUITE_BUDGET_MS, suiteStopMs} = runner;

test('a clean CI checkout stages shared code before reading the suite no-aggregate export', async () => {
  let staged = false;
  const stop = await suiteStopMs('apply', {
    stage: async () => { staged = true; },
    load: async name => {
      assert.equal(name, 'apply');
      if (!staged) throw new Error('Cannot find module desktop/shared/alias-schema.js');
      return {aggregateBudget: false};
    },
  });
  assert.equal(stop, null);
});

test('a suite that still cannot load after staging fails with its name and original error', async () => {
  await assert.rejects(suiteStopMs('apply', {
    stage: () => {},
    load: async () => { throw new Error('Cannot find module desktop/shared/alias-schema.js'); },
  }), /apply.*Cannot find module desktop\/shared\/alias-schema\.js/);
});

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

// Why (31 Oct 2026, owner): a job has one try, so its limit holds one full budget and the setup (the two-attempt limit of 12 Oct 2026, applycv 38242968527, went with the retry).
test('every suite with its own budget has a job limit above one run of it plus the setup', async () => {
  for (const name of SUITES) {
    const suite = await import(`../suites/${name}.mjs`);
    if (!suite.budgetMinutes) continue;
    assert.ok((suite.minutes || 15) >= suite.budgetMinutes + 4, `${name}: minutes ${suite.minutes} cannot hold one run of its ${suite.budgetMinutes}-minute budget (CI cancels the job and the evidence is lost)`);
  }
});

// Why (31 Oct 2026, main run 41146558456 and the beta's re-check 41150330007): apply-1of2's first try on a slow Mac runner was killed at the workflow's 15-minute
// step limit with every step green so far; a kill writes no record, so the evidence could not say it was timing (8 of 82 Mac first tries).
test('a suite without an aggregate stops before the CI try limit with room for its whole close-down; locally there is no limit', () => {
  assert.equal(budgetMsOf({aggregateBudget: false}, {E2E_TRY_MINUTES: '15'}), 11 * 60000);
  assert.equal(budgetMsOf({aggregateBudget: false}, {E2E_TRY_MINUTES: '30'}), 26 * 60000);
  assert.ok(runner.TRY_MARGIN_MS >= TEARDOWN_STOP_MS + 60000, 'the records are written after close-down: the margin must hold its cap and a minute (Gitar on #2654)');
  assert.equal(budgetMsOf({aggregateBudget: false}, {}), Infinity);
  assert.equal(budgetMsOf({budgetMinutes: 11}, {E2E_TRY_MINUTES: '15'}), 11 * 60000, 'a suite with its own budget keeps it');
});

test('a slow try cut by that stop leaves records that read as timing (triage labels a later green re-run of the same commit flaky)', async () => {
  const quiet = console.log;
  console.log = () => {};
  try {
    const run = runner.createRunner(() => null, {keepGoing: true, budgetMs: 150});
    await run.run('a form step on a slow runner', () => new Promise(done => setTimeout(done, 400)));
    await run.run('the step after it', async () => {});
    const failed = run.results.filter(result => result.status === 'failed');
    assert.equal(failed.length, 2, JSON.stringify(run.results));
    for (const result of failed) assert.equal(flakyProof(result.note).flaky, true, result.note);
  } finally { console.log = quiet; }
});
