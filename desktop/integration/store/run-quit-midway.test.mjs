// Layer 3 (Node + the real engine, no window): quitting the app in the middle of a run (journey J11, A run that fails ends in words, never Running for ever). Moved from the e2e
// `activityfailures` suite (1 Nov 2026, owner: "Only tier 1 ... should stay e2e"; J11 is now proven here). The search is held at the AI (the proxy delays its answer), the app "quits"
// the way lib/lifecycle.js quits with a run going (pipeline.freezeQueue, then the engine child stopped), and the NEXT START runs the app's own code: takeQueue lists the lost run as
// Interrupted, and the app's resumeQueue (lib/app-reminders.js, answered "Start again" as the journey answers it: askResume with JOB_PILOTTO_E2E) closes the killed run's row and starts the
// search again. The quit's "process is gone" is played by ending the search's steps (stopTask) as well as its engine child. What it proves: the lost run is listed once as Interrupted with what it said, the search you had started is picked up again and ends ok, nothing is shown Running for
// ever and no row of the store says Running. What it does not prove: the process kill itself (a real app is killed, here the engine child is stopped and the app's module state stays in
// this process), and the native question (askResume answers by itself under JOB_PILOTTO_E2E, test/resume-ask.test.js). Both stayed true of the e2e step on a Mac.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppReminders} from '../../lib/app-reminders.js';
import {resumeDelay, scheduleResume} from '../../lib/resume-queue.js';
import {assertNothingRunning} from './engine-support.mjs';
import {startEngineKit} from './engine-kit.mjs';

let kit;
before(async () => { kit = await startEngineKit({answers: 'activityfailures'}); });
after(async () => { await kit?.close(); });

// Polls a state of the app until it holds; the limit is a hang guard that names the last state seen, never a pause.
async function until(read, what, hangMs = 60000) {
  const hang = Date.now() + hangMs;
  for (let last; ; ) {
    last = await read();
    if (last) return last;
    // Why (1 Nov 2026): a poll interval for a state that is not here yet (the engine's own work moves it), bounded by the hang guard below.
    if (Date.now() > hang) throw new Error(`hung waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test('quitting the app in the middle of a run: it is not shown Running for ever, and the app says what became of it', async () => {
  const {storage, proxy, tasks: pipeline} = kit;
  kit.feed(['Senior Platform Engineer, restart']);
  proxy.setDelay(10000);
  const held = proxy.setMode('pass');
  const before = new Set(pipeline.runs(storage).map(run => run.id));
  let first;
  try {
    first = pipeline.refresh(storage, () => {}, 'run', 'you');
    await until(() => pipeline.running()?.kind === 'search', 'the search to start');
    await until(() => held.delayed > 0, 'the interrupted search to reach the delayed AI request');

    // The quit with a run going (lib/lifecycle.js "now"): the queue is frozen with the running job, then the engine child is stopped.
    pipeline.freezeQueue(storage);
    pipeline.stopTask();   // the process of a real quit is gone, so no later step of the search runs: here its steps are ended with it
    await pipeline.stopRunning();
    await first;
  } finally { proxy.setDelay(0); }

  // The next start: the app's own resume code, answered "Start again" (JOB_PILOTTO_E2E), with no wait.
  const lines = [];
  const reminders = createAppReminders({FOCUS_HOURS: [], Notification: class {}, dialog: {}, log: line => lines.push(String(line)), notify: () => {}, skippedLoops: new Set(),
    getStorage: () => storage, targets: {}, toWindow: () => {}, getWindow: () => null});
  assert.equal(resumeDelay({JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_RESUME_MS: '3000'}), 3000, 'the control: the journey shortens the wait, a user keeps 20 s');
  const taken = scheduleResume(pipeline, storage, {begin: jobs => reminders.resumeQueue(jobs), delayMs: 0, timer: callback => callback()});
  assert.deepEqual(taken.map(job => job.kind), ['search'], 'the search you had started is handed back to start again');
  await until(() => pipeline.running()?.kind === 'search' || pipeline.runs(storage).some(run => run.kind === 'search' && !before.has(run.id) && run.ok), 'the search to start again');
  await kit.settled();

  const rows = pipeline.runs(storage).filter(run => run.kind === 'search' && run.trigger !== 'schedule');
  const lost = rows.filter(run => run.interrupted);
  const again = rows.filter(run => !run.interrupted && run.ok && !before.has(run.id));
  assert.equal(lost.length, 1, `the interrupted search is listed once as Interrupted (rows: ${rows.map(run => `${run.ok ? 'ok' : 'failed'}${run.interrupted ? ' interrupted' : ''}`).join(', ')})`);
  assert.match(lost[0].log.at(-1), /^Interrupted: Jobadabra was closed while this ran/);
  assert.ok(again.length >= 1, 'the search you had started was not picked up again after the restart');
  assert.equal(pipeline.running(), null, 'the app still says a task is running after everything ended');
  await assertNothingRunning(kit);
});
