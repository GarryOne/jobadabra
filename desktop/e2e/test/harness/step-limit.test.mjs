// A step that never ends fails at its limit with which side of the app still answers, instead of the CI job dying silently (lib/runner.mjs).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRunner, hangReport, withLimit} from '../../lib/runner.mjs';
import {flakyProof} from '../../lib/flaky-proof.mjs';

const never = () => new Promise(() => {});
const session = {page: {evaluate: never}, app: {evaluate: async () => 1}, shot: async () => {}, keepLogs: async () => {}};

test('hang messages keep exact seconds below ten minutes and minutes at ten or more', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  for (const [ms, duration] of [[90000, '90 s'], [599000, '599 s'], [600000, '10 min']]) {
    const rejected = assert.rejects(withLimit(never(), ms, 'hang'), error => {
      assert.equal(error.message, `the step did not finish within ${duration} (it hung): no app session`);
      return true;
    });
    t.mock.timers.tick(ms);
    await rejected;
  }
});

test('a hung step fails at its limit and says which side does not answer', async () => {
  await assert.rejects(withLimit(never(), 50, 'x', () => session), /did not finish.*the window does NOT answer, the main process answers/);
  assert.equal(await withLimit(Promise.resolve(7), 50, 'x'), 7);
});

test('the runner records the hang as a failed step and goes on when keepGoing', async () => {
  const runner = createRunner(() => session, {keepGoing: true});
  await runner.run('hangs', never, {limitMs: 50});
  await runner.run('next', async () => {});
  assert.deepEqual(runner.results.map(result => [result.name, result.status]), [['hangs', 'failed'], ['next', 'passed']]);
  assert.match(runner.results[0].note, /it hung/);
  assert.match(await hangReport(null), /no app session/);
});

test('past the suite budget the steps left are recorded as not run, and a running step is cut at the budget', async () => {
  const runner = createRunner(() => session, {keepGoing: true, budgetMs: 120});
  await runner.run('slow', () => new Promise(done => setTimeout(done, 60)));
  await runner.run('runs into the budget', never);
  await runner.run('left over', async () => {});
  assert.deepEqual(runner.results.map(result => [result.name, result.status]), [['slow', 'passed'], ['runs into the budget', 'failed'], ['left over', 'failed']]);
  assert.match(runner.results[2].note, /not run: the suite was over its/);
});

test('a step cut by the suite budget says so, not that it hung', async () => {
  const runner = createRunner(() => session, {keepGoing: true, budgetMs: 80});
  await runner.run('cut by the budget', never);
  assert.match(runner.results[0].note, /budget ran out during this step/);
});

// Owner, 31 Oct 2026 ("why it's flaky? Or it's a product bug?"): re-check run 41166853012's apply-2of2 chip step was cut by the 11-minute budget, but its own
// hang words ("the chip step hung within 129.72 s") hid that, so the grey rule read a wrong value and held the beta red. The runner owns "cut off"; a step gives evidence.
const chipEvidence = 'all read tabs close; last state: []';
test('a step with its own evidence, cut by the suite budget, reads as timing in the runner\'s words', async () => {
  const runner = createRunner(() => session, {keepGoing: true, budgetMs: 80});
  await runner.run('each read verdict gives its own chip', never, {hangError: async () => chipEvidence});
  const {note} = runner.results[0];
  assert.match(note, /budget ran out during this step.*: all read tabs close; last state: \[\]$/);
  assert.equal(flakyProof(note).flaky, true, note);
});

test('a step with its own evidence, cut by its own limit, reads as timing in the runner\'s words', async () => {
  await assert.rejects(withLimit(never(), 50, 'restart', () => null, 0, () => 'the watch past the wait did not end (last read: {})'), error => {
    assert.equal(error.message, 'the step did not finish within 0.05 s (it hung): the watch past the wait did not end (last read: {})');
    assert.equal(error.stepHang, true);
    assert.equal(flakyProof(error.message).flaky, true);
    return true;
  });
});
