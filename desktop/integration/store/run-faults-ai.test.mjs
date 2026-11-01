// Layer 3 (Node + the real engine, no window): a Jobs check while the AI fails ends in words, with nothing left Running. Moved from the e2e `activityfailures` suite's four AI steps
// (1 Nov 2026, R2): the AI answering 429 (rate limit), 500, the key invalid (401), and the credit balance empty (the spending limit). The e2e 401 step stays as well (journey J11 in
// critical-journeys.json); this is its PR-time counterpart. The engine is the real one on a temp install (engine-kit.mjs), the AI is the e2e proxy answering the way the API does.
// What it does not prove: how the Recent runs page DRAWS the record (screen-activity-failures.test.js does, from the same record shapes) and the quit in the middle of a run (e2e J11).
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {runWarningLines} from '../../renderer/run-warnings.js';
import {assertNothingRunning, commonProblems, releaseFault, whatARunShows} from './engine-support.mjs';
import {startEngineKit} from './engine-kit.mjs';

let kit;
before(async () => { kit = await startEngineKit(); });
after(async () => { await kit?.close(); });

const FAILURES = [
  {mode: 'rate-limit', what: 'the AI answers 429 (rate limit)'},
  {mode: 'server-error', what: 'the AI answers 500'},
  {mode: 'invalid-key', what: 'the AI says the key is invalid (401)'},
  {mode: 'no-credit', what: 'the AI says the credit balance is empty (the spending limit)', limit: true},
];

for (const failure of FAILURES) {
  test(`${failure.what}: the run ends as Failed or with warnings, in words, with nothing left Running`, async () => {
    kit.feed([`Senior Site Reliability Engineer, ${failure.mode}`]);
    const fault = kit.proxy.setMode(failure.mode);
    const callsBefore = kit.proxy.stats.calls;
    try {
      const done = await kit.runTask('refresh', 'run', 'you');
      const seen = await whatARunShows(kit, done);
      const problems = commonProblems(kit, seen);
      if (kit.proxy.stats.calls - callsBefore < 1) problems.push('the AI was never asked, so nothing was tested');
      if (!fault.failed) problems.push(`this run never consumed its own ${failure.mode} fault`);
      if (/^Completed$/.test(seen.pill)) problems.push('the run says plain "Completed" with no warning, though the AI refused every call');
      if (!/Failed|warning|Needs/i.test(seen.pill)) problems.push(`the pill says "${seen.pill}", not that it did not fully work`);
      if (!seen.head && !seen.warnings.length && !runWarningLines(seen.shown).length) problems.push('the run shows no warning, though the AI refused every call');
      if (failure.limit && !seen.limited) problems.push(`the spending limit is not named as such: "${seen.words.slice(0, 160)}"`);
      assert.deepEqual(problems, []);
      assert.equal(seen.rows.filter(row => row.mode === 'run').length >= 1, true);
      await assertNothingRunning(kit);
    } finally { await releaseFault(kit, fault); }
  });
}
