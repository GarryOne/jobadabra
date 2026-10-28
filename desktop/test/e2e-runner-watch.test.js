// A test app dies with the runner that started it, even when that runner is killed outright (lib/e2e-host.js watchRunner).
// Why (28 Oct 2026, owner: "what loads my Mac", load 52): four e2e test apps from runs that had died or timed out stayed alive 5 to 7 hours at about 15% CPU each, parent launchd,
// and ignored SIGTERM. macOS gives a child no signal when its parent dies, so only the app itself can notice. Positive control: a child without the watch survives the same kill.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {watchRunner} from '../lib/e2e-host.js';

const HOST = pathToFileURL(fileURLToPath(new URL('../lib/e2e-host.js', import.meta.url))).href;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, ms) => { for (const end = Date.now() + ms; Date.now() < end && !check(); await wait(50)); return check(); };

// The runner starts three children: a watched app, a watched app whose exit call does nothing (an app that ignores being asked to quit), and a control with no watch.
const RUNNER = `
import {spawn} from 'node:child_process';
const child = body => spawn(process.execPath, ['--input-type=module', '-e', body], {stdio: 'ignore', env: {...process.env, JOB_PILOTTO_E2E_RUNNER_PID: String(process.pid), JOB_PILOTTO_E2E_RUNNER_POLL_MS: '50', JOB_PILOTTO_E2E_RUNNER_GRACE_MS: '150'}});
const watched = exit => 'import {watchRunner} from ' + ${JSON.stringify(JSON.stringify(HOST))} + '; watchRunner(' + exit + '); setInterval(() => {}, 1000);';
const pids = {watched: child(watched('() => process.exit(0)')).pid, stubborn: child(watched('() => {}')).pid, control: child('setInterval(() => {}, 1000);').pid};
console.log(JSON.stringify(pids));
setInterval(() => {}, 1000);
`;

test('a test app ends when its runner is killed, and one without the watch does not', async () => {
  const runner = spawn(process.execPath, ['--input-type=module', '-e', RUNNER], {stdio: ['ignore', 'pipe', 'inherit']});
  let pids = null;
  try {
    pids = await new Promise((resolve, reject) => {
      let text = '';
      const late = setTimeout(() => reject(new Error('the runner did not start its children in 15 s')), 15000);   // cleared below: a live timer holds the test file open for its full 15 s
      runner.stdout.on('data', chunk => { text += chunk; if (text.includes('\n')) { clearTimeout(late); resolve(JSON.parse(text.split('\n')[0])); } });
      runner.on('exit', () => { clearTimeout(late); reject(new Error('the runner ended before it started its children')); });
    });
    await wait(600);   // twelve polls of the watch: it must not fire while the runner lives
    for (const [name, pid] of Object.entries(pids)) assert.ok(alive(pid), `${name} (${pid}) ended while its runner was alive`);
    runner.kill('SIGKILL');   // a runner that died or timed out: no handler runs, no close()
    assert.ok(await until(() => !alive(pids.watched), 8000), 'the watched app is still alive after its runner was killed');
    assert.ok(await until(() => !alive(pids.stubborn), 8000), 'an app that ignores the quit call is still alive (the watch ends it by force after its grace)');
    assert.ok(alive(pids.control), 'positive control: the kill did leave a child with no watch alive (a test that proves nothing otherwise)');
  } finally {
    runner.kill('SIGKILL');
    for (const pid of Object.values(pids || {})) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
  }
});

test('an app a person runs is never watched: no runner pid, no timer', () => {
  assert.equal(watchRunner(() => {}, {}), null);
  assert.equal(watchRunner(() => {}, {JOB_PILOTTO_E2E: '1'}), null, 'a test run with no runner named has nothing to watch');
  assert.equal(watchRunner(() => {}, {JOB_PILOTTO_E2E_RUNNER_PID: 'not a pid'}), null);
  const timer = watchRunner(() => assert.fail('exit was called for a runner that is alive'), {JOB_PILOTTO_E2E_RUNNER_PID: String(process.pid), JOB_PILOTTO_E2E_RUNNER_POLL_MS: '20'});
  assert.ok(timer, 'a live runner is watched');
  clearInterval(timer);
});
