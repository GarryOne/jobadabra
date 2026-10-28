// The hidden browser's life is tied to the app's: when the app process is gone (quit, crash, SIGKILL) the reaper kills the browser
// (28 Oct 2026, coordinator: Chrome for Testing kept running with parent 1 after the app was gone, 12 processes on the owner's Mac).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {reaperCommand} from '../lib/browser-reaper.js';

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (check, ms) => { const end = Date.now() + ms; while (Date.now() < end && !check()) await new Promise(r => setTimeout(r, 50)); return check(); };
const sleeper = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {detached: process.platform !== 'win32', stdio: 'ignore'});

test('killing the app kills the browser it was watching', async () => {
  const app = sleeper(), browser = sleeper();
  const {command, args, env} = reaperCommand(app.pid, browser.pid);
  const reaper = spawn(command, args, {env: {...process.env, ...env}, stdio: 'ignore'});
  try {
    await new Promise(r => setTimeout(r, 500));
    assert.ok(alive(browser.pid), 'the browser lives while the app does');
    process.kill(app.pid, 'SIGKILL');
    assert.ok(await until(() => !alive(browser.pid), 8000), 'the browser is killed once the app is gone');
    assert.ok(await until(() => reaper.exitCode !== null || reaper.signalCode, 8000), 'the reaper ends after it killed the browser');
  } finally {
    for (const p of [app, browser, reaper]) { try { process.kill(p.pid, 'SIGKILL'); } catch { /* already gone */ } }
  }
});

test('the reaper command runs this module with the Electron binary as Node and the two pids', () => {
  const {command, args, env} = reaperCommand(11, 22);
  assert.equal(command, process.execPath);
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1');
  assert.ok(args[0].endsWith('browser-reaper.js'));
  assert.deepEqual(args.slice(1), ['11', '22']);
  assert.ok(fileURLToPath(new URL('../lib/browser-reaper.js', import.meta.url)).endsWith(args[0].split(/[\\/]/).pop()));
});
