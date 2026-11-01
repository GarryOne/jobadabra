// Layer 3 (Node + the real engine, no window): the AI never answers, so the run is stopped after its silence limit and ends as Stopped, in words, with nothing left Running. Moved from the
// e2e `activityfailures` suite (1 Nov 2026, R2): "the AI never answers: the run is stopped after its silence limit and ends as Stopped, in words". The limit is the app's own watchdog
// (lib/pipeline-run.js LIMITS.idleMs), shortened as the journey shortens it (JOB_PILOTTO_E2E_IDLE_MS, set by silence-env.mjs before any app module loads: one value per test file, hence this file of its own); the verdict is
// awaited as a state (the task ends), the 'hang' proxy mode is the AI that never answers.
import './silence-env.mjs';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {stoppedHead} from '../../renderer/run-status.js';
import {assertNothingRunning, commonProblems, releaseFault, whatARunShows} from './engine-support.mjs';
import {startEngineKit} from './engine-kit.mjs';

let kit;
before(async () => { kit = await startEngineKit(); });
after(async () => { await kit?.close(); });

test('the AI never answers: the run is stopped after its silence limit and ends as Stopped, in words, with nothing left Running', async () => {
  kit.feed(['Lead Platform Engineer, silence']);
  const fault = kit.proxy.setMode('hang');
  try {
    const done = await kit.runTask('refresh', 'run', 'you');
    const seen = await whatARunShows(kit, done);
    const problems = commonProblems(kit, seen);
    if (!fault.pending && !fault.hung?.size && !fault.failed && !kit.proxy.stats.calls) problems.push('the AI was never asked, so nothing was tested');
    if (seen.app.ok) problems.push('a run whose AI never answered ended as a success');
    if (!/no output|stopp|did not answer|silen/i.test(`${done.run.log.join('\n')} ${seen.words}`)) problems.push('nothing in the log or the words says the run was stopped for its silence');
    if (!stoppedHead({...seen.app, kind: 'search'})) problems.push(`the app words no "Stopped" box for it: pill "${seen.pill}"`);
    assert.deepEqual(problems, []);
    await assertNothingRunning(kit);
  } finally { await releaseFault(kit, fault); }
});
