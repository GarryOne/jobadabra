// A dead process that nobody has reaped yet is gone for a test: kill(pid, 0) still answers for it, so "alive" is read from the process state (test/process-gone.js).
// Why (31 Oct 2026, a8; #2726 run 41231359925): quit-ends-children.test.js:91 asserted `kill(grandchild, 0)` failed right after the quit and found it alive on
// a loaded runner, with the whole file taking 884 ms: the group's pipe had closed (the grandchild was dying), the grandchild was not yet reaped by init.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {isGone, stateOf, untilGone} from './process-gone.js';

const rawAlive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const skip = process.platform === 'win32' ? 'there is no zombie state on Windows' : false;

// A parent that never waits for its child: the child exits and stays a zombie until the parent goes (what init does late, on a busy runner, for an orphan).
const neverReaps = [`import subprocess, sys, time`, `p = subprocess.Popen([sys.executable, '-c', 'pass'])`, `time.sleep(0.4)`, `print(p.pid, flush=True)`, `time.sleep(600)`].join('\n');

test('a dead process nobody reaped answers kill(pid, 0) but is gone', {skip}, async t => {
  const parent = spawn('python3', ['-c', neverReaps], {stdio: ['ignore', 'pipe', 'inherit']});
  t.after(() => parent.kill('SIGKILL'));
  const zombie = Number(await new Promise(resolve => parent.stdout.once('data', chunk => resolve(String(chunk).trim()))));
  assert.equal(rawAlive(zombie), true, 'positive control: the old check calls an unreaped dead process alive');
  assert.equal(stateOf(zombie)[0], 'Z');
  assert.equal(isGone(zombie), true);
  assert.equal((await untilGone(zombie, 1000)).gone, true);
});

test('a running process is not gone, and says what state it is in', {skip}, async t => {
  const sleeper = spawn('sleep', ['600'], {stdio: 'ignore'});
  t.after(() => sleeper.kill('SIGKILL'));
  assert.equal(isGone(sleeper.pid), false);
  const seen = await untilGone(sleeper.pid, 150);
  assert.equal(seen.gone, false);
  assert.match(seen.state, /^[SRD]/, 'the state it was last seen in, for the failure message');
});

test('a pid that does not exist is gone at once', () => {
  assert.equal(isGone(2 ** 22 + 12345), true);
});
