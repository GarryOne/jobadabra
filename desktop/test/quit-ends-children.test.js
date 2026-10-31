// The owner's scenario (31 Oct 2026: "the quit-ends-all-children fix is a user bug"): an engine read whose AI call never answers is running, the person quits, and every engine child is gone
// when the app goes. Plays the real run(), the real stopRunning and the real quit handlers; the read is `python -m http.server`, which prints a line and then waits for ever.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {installQuitHandling} from '../lib/lifecycle.js';
import * as pipeline from '../lib/pipeline.js';
import {holdersOf, waitTreeGone} from '../e2e/lib/app-tree.mjs';

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const storageIn = dir => ({settings: () => ({}), secret: () => '', saveSettings: () => {}, path: (...parts) => path.join(dir, ...parts)});
const waitingRead = (storage, onChild) => pipeline.run(storage, ['http.server', '0', '--bind', '127.0.0.1'], () => {}, {}, {onChild});
const started = child => new Promise(resolve => { const timer = setInterval(() => { if (child()?.pid && alive(child().pid)) { clearInterval(timer); resolve(); } }, 20); });
const cleanup = (t, child) => t.after(() => { try { process.kill(-child().pid, 'SIGKILL'); } catch { /* already gone */ } });   // a failing test leaves no server behind
const within = (promise, ms, otherwise) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(otherwise), ms).unref())]);   // only so a red test says what it saw instead of timing out

test('quitting while an untracked engine read waits on an AI that never answers leaves no engine child', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-quit-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  let child; const read = waitingRead(storageIn(dir), made => { child = made; });
  cleanup(t, () => child);
  await started(() => child);
  const exited = new Promise(resolve => child.once('exit', () => resolve('exited')));
  assert.equal(pipeline.running(), null, 'an untracked read: no task, so the quit guard does not ask and does not stop it');
  const handlers = {}, calls = [];
  const beforeQuit = installQuitHandling({app: {on: (event, fn) => { handlers[event] = fn; }, quit: () => calls.push(`quit:${alive(child.pid) ? 'child alive' : 'child gone'}`)}, platform: 'darwin',
    state: () => ({storage: storageIn(dir), window: null}), pipeline, terminals: {running: () => [], shutdown: () => {}}, shouldAskOnQuit: () => false, askWhyLeaving: () => {}, showDialog: () => 0,
    icon: () => ({}), getWindows: () => [], toWindow: () => {}, notify: () => {}});
  beforeQuit({preventDefault: () => assert.fail('no task runs, no session: the quit guard asks nothing')});
  let held = false;
  handlers['will-quit']({preventDefault: () => { held = true; }});
  assert.equal(await within(exited, 5000, 'still running after the quit'), 'exited', 'the engine child is gone');
  await read;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(alive(child.pid), false);
  assert.equal(held, true, 'the quit waited for the child before going on');
  assert.deepEqual(calls, ['quit:child gone'], 'the app quits only after the child exited');
  handlers['will-quit']({preventDefault: () => assert.fail('nothing left to wait for: the second pass goes through')});
});

test('stopRunning resolves on the children exit events, with nothing to wait for when none run', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-stop-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  assert.equal(pipeline.hasChildren(), false);
  await pipeline.stopRunning();
  let child; const read = waitingRead(storageIn(dir), made => { child = made; });
  cleanup(t, () => child);
  await started(() => child);
  assert.equal(pipeline.hasChildren(), true);
  await pipeline.stopRunning();
  assert.equal(child.exitCode !== null || child.signalCode !== null, true, 'the promise came back after the exit, not before');
  assert.equal(pipeline.hasChildren(), false);
  await read;
});

test('a read that goes quiet is stopped by the silence limit whatever its command (src.focus is not a task)', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-quiet-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const saved = {...pipeline.LIMITS};
  t.after(() => Object.assign(pipeline.LIMITS, saved));
  Object.assign(pipeline.LIMITS, {idleMs: 600, totalMs: 60000, checkMs: 100, killAfterMs: 500});   // watchAll stays false: the command is watched because it is an engine read, not because a test asked
  const started = Date.now();
  let child; const read = waitingRead(storageIn(dir), made => { child = made; });
  cleanup(t, () => child);
  const {timedOut} = await within(read, 6000, {timedOut: ''});
  assert.ok(timedOut, 'stopped for its silence');
  assert.ok(Date.now() - started < 8000);
});

// The read of the owner's scenario holds its hung AI call in a grandchild that ignores SIGTERM (a `claude -p`, a browser): the leader's exit is not the group's.
test('a grandchild that ignores SIGTERM is gone too when the quit goes on', {skip: process.platform === 'win32' ? 'taskkill /T ends the tree there' : false}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-grand-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  // The grandchild writes its pid only after it ignores SIGTERM, so the test never stops it before it can ignore it.
  fs.writeFileSync(path.join(dir, 'jp_fake_engine.py'), [
    'import subprocess, sys, time',
    "subprocess.Popen([sys.executable, '-c', 'import os, signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); open(os.environ[\"JP_FAKE_PID_FILE\"], \"w\").write(str(os.getpid())); time.sleep(600)'])",
    "print('ready', flush=True)",
    'time.sleep(600)', ''].join('\n'));
  const pidFile = path.join(dir, 'grand.pid');
  let child; const read = pipeline.run(storageIn(dir), ['jp_fake_engine'], () => {}, {PYTHONPATH: dir, JP_FAKE_PID_FILE: pidFile}, {onChild: made => { child = made; }});
  cleanup(t, () => child);
  await started(() => child);
  await new Promise(resolve => { const timer = setInterval(() => { if (fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8')) { clearInterval(timer); resolve(); } }, 20); });
  const grand = Number(fs.readFileSync(pidFile, 'utf8'));
  t.after(() => { try { process.kill(grand, 'SIGKILL'); } catch { /* gone */ } });
  assert.equal(alive(grand), true);
  await pipeline.stopRunning();
  await within(read, 5000, null);   // a surviving grandchild keeps the pipe open, so run() would not resolve: the assertion below says it
  // Why (31 Oct 2026, a8; #2726 run 41231359925): the closed pipe means the grandchild is dying, not that init has reaped it; kill(pid, 0) answers for that zombie.
  // waitTreeGone reads the process state (a zombie is gone) and waits on it, the one copy of that (e2e/lib/app-tree.mjs, guard e2e/test/app-tree.test.mjs).
  const left = await waitTreeGone([{pid: grand, command: 'grandchild'}], {capMs: 3000});
  assert.deepEqual(left, [], `the grandchild that ignored SIGTERM was ended with its group (still running: ${holdersOf(left)})`);
});

test('the watchdog watches every engine command but the ones that wait on a person or a download', () => {
  for (const command of ['src', 'src.focus', 'src.desktop', 'src.stores', 'src.ai.apply_batch']) assert.equal(pipeline.isWatched(command), true, command);
  for (const command of ['src.sources.google', 'src.ai.transcribe', 'pip']) assert.equal(pipeline.isWatched(command), false, command);
  const saved = pipeline.LIMITS.watchAll;
  pipeline.LIMITS.watchAll = true;
  try { assert.equal(pipeline.isWatched('pip'), true, 'a test can watch any module'); } finally { pipeline.LIMITS.watchAll = saved; }
});
