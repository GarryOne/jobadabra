// Stop on a running task (owner, 7 Oct 2026: a search ran for an hour with no way to stop it): its command ends, the run is kept as
// "Stopped by you" (not a failure); the app's own tasks (work()) get a signal and end at their next step.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as pipeline from '../lib/pipeline.js';

function storage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-stop-'));
  const files = {};
  return {files, settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts),
    readText: name => files[name] || '', writeText: (name, text) => { files[name] = text; }};
}
const until = async check => { for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 50)); };

test('Stop ends the running command at once and keeps the run as stopped by you', async () => {
  const s = storage(), started = Date.now();
  const done = pipeline.task(s, 'scout', ['timeit', '-n', '1', '-r', '1', 'import time; time.sleep(30)'], () => {});
  await until(() => pipeline.running()?.stoppable && Date.now() - started > 300);
  assert.equal(pipeline.running()?.stoppable, true);
  assert.deepEqual(pipeline.stopTask(), {ok: true, kind: 'scout'});
  const {ok, run} = await done;
  assert.equal(ok, false);
  assert.equal(run.stopped, 'you');
  assert.match(run.summary, /^Stopped by you/);
  assert.ok(Date.now() - started < 10000, 'it did not wait for the 30 s command');
  assert.ok(run.log.some(line => line.startsWith('⏹ Stopped by you')));
  assert.equal(pipeline.stopTask().ok, false, 'nothing runs any more');
});

test("the app's own work (Tailor CVs, Find jobs using your browser) can be stopped: its signal fires and it ends as stopped by you", async () => {
  let aborted = null;
  const {ok, run} = await pipeline.work(storage(), 'tailor', () => {}, async (tee, signal) => {
    assert.equal(pipeline.running().stoppable, true);
    assert.deepEqual(pipeline.stopTask(), {ok: true, kind: 'tailor'});
    aborted = signal.aborted;
    return true;
  });
  assert.equal(aborted, true);
  assert.equal(ok, false);
  assert.equal(run.stopped, 'you');
});

// Owner, 7 Oct 2026: "for all the tasks". Every way the Mac starts a task is tracked() with Stop on; none may turn it off again.
test('no task the Mac runs turns Stop off', () => {
  const source = ['pipeline', 'pipeline-queue', 'pipeline-tasks', 'pipeline-run'].map(name => fs.readFileSync(new URL(`../lib/${name}.js`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(source, /stoppable:\s*false/);
});

// Owner, 25 Oct 2026: Stop on "Find jobs using your browser" said "Stopped by you" but the run went on. Its job-page lookup is an engine command
// started with the visits module's own line handler, not the task's, so Stop never found it. Every engine command a run of the task starts is ended.
test('Stop ends the engine command a Find jobs using your browser run waits on (the job-page lookup)', async () => {
  const visits = await import('../lib/visits.js');
  const slow = (s, args, onLine, env, options) => pipeline.run(s, ['timeit', '-n', '1', '-r', '1', 'import time; time.sleep(30)'], onLine, env, options);
  const started = Date.now(), s = storage();
  const done = pipeline.work(s, 'visits', () => {}, async (tee, signal) => {
    await visits.runAll([{name: 'Acme', url: 'https://acme.example/', kind: 'employer'}], {tee, signal, openTab: () => ({ok: true}),
      prepare: site => visits.withJobPages(s, [site], tee, slow).then(sites => sites[0])});
    return true;
  });
  await until(() => pipeline.running()?.log?.some(line => /Finding its job page/.test(line)));
  await new Promise(r => setTimeout(r, 500));
  assert.equal(pipeline.stopTask().ok, true);
  const {run} = await done;
  assert.equal(run.stopped, 'you');
  assert.ok(Date.now() - started < 10000, 'Stop did not wait for the 30 s lookup');
});

// Owner, 25 Oct 2026: "stopping doesn't work", so the class: every kind of run (engine command or the app's own work) ends within seconds
// of Stop, is recorded as stopped by you, and the run queued behind it starts.
test('Stop ends every kind of run and the next queued run starts', async () => {
  const kinds = ['search', 'mail', 'scout', 'insight', 'weekly', 'kits', 'today'];
  for (const kind of [...kinds, 'visits', 'tailor']) {
    const s = storage(), started = Date.now();
    const slowCommand = ['timeit', '-n', '1', '-r', '1', 'import time; time.sleep(30)'];
    const first = kinds.includes(kind) ? pipeline.task(s, kind, slowCommand, () => {})
      : pipeline.work(s, kind, () => {}, (tee, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve(true))));
    const next = pipeline.task(s, 'stats', ['timeit', '-n', '1', '-r', '1', 'pass'], () => {});
    await until(() => pipeline.running()?.kind === kind && pipeline.running()?.stoppable);
    assert.equal(pipeline.queued().length, 1, `${kind}: the second run waits`);
    assert.equal(pipeline.stopTask().ok, true, kind);
    const {run} = await first;
    assert.equal(run.stopped, 'you', kind);
    assert.equal((await next).ok, true, `${kind}: the queued run started after Stop`);
    assert.ok(Date.now() - started < 10000, `${kind}: ended within seconds`);
  }
});
