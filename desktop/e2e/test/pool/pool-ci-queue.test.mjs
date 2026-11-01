// The CI pool's queue (lib/pool-ci-queue.mjs, pool-ci-wait.mjs; .github/workflows/record-sites.yml): one pool run at a time, oldest first, and NONE is ever dropped.
// GitHub's concurrency group keeps one pending run and cancels the older one (12 Oct 2026: the Ocado and FNAC dispatches of the same second; Ocado was cancelled,
// and a dispatch could silently cancel another run the same way). Strictly one at a time also keeps the site-ledger hand-over between runs free of races.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runsAhead} from '../../lib/pool-ci-queue.mjs';

const run = (databaseId, status) => ({databaseId, status});

test('a run waits for every earlier pool run not finished yet, oldest first; later runs and finished ones never hold it', () => {
  const runs = [run(38248225742, 'queued'), run(38248224837, 'in_progress'), run(38248200000, 'completed'), run(38248300000, 'waiting'), run(38248100000, 'pending')];
  assert.deepEqual(runsAhead(runs, 38248225742), [38248100000, 38248224837]);
  assert.deepEqual(runsAhead(runs, 38248100000), []);
  assert.deepEqual(runsAhead([], 1), []);
  assert.deepEqual(runsAhead([run('5', 'requested'), run('7', 'in_progress')], '7'), [5], 'ids as text compare as numbers');
});
