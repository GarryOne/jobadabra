// Ending a run ends its children too (lib/kill-tree.js): a pip install started by the add-on setup must not outlive a stopped run, on any platform.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {killTree} from '../lib/kill-tree.js';

test('Windows: the whole tree goes with taskkill /T /F; if taskkill cannot run the process is still told to stop', () => {
  const asked = [], signals = [], child = {pid: 4242, kill: signal => signals.push(signal)};
  killTree(child, {platform: 'win32', run: (...args) => asked.push(args)});
  assert.deepEqual(asked[0].slice(0, 2), ['taskkill', ['/pid', '4242', '/T', '/F']]);
  assert.deepEqual(signals, []);
  killTree(child, {platform: 'win32', run: () => { throw new Error('no taskkill'); }});
  assert.deepEqual(signals, ['SIGTERM']);
});

test('Windows: what taskkill said is logged, and a process still alive 2 s later is named (beta 0.8.30: a Stopped run held the run lock)', () => {
  const lines = [], later = [];
  const child = {pid: 4242, kill() {}};
  killTree(child, {platform: 'win32', run: () => ({status: 128, stderr: 'ERROR: The process "4242" not found.'}), log: (...args) => lines.push(args),
    after: fn => { later.push(fn); }, alive: () => true});
  assert.equal(lines[0][1], 'taskkill');
  assert.deepEqual([lines[0][2].pid, lines[0][2].status], [4242, 128]);
  assert.match(lines[0][2].said, /not found/);
  later[0]();
  assert.match(lines[1][1], /still alive/);
  const quiet = [];
  killTree(child, {platform: 'win32', run: () => ({status: 0}), log: (...args) => quiet.push(args), after: fn => fn(), alive: () => false});
  assert.equal(quiet.length, 1, 'a process that is gone adds no second line');
});

test('Mac/Linux: the signal goes to the run\'s whole process group; without a group the process itself gets it', () => {
  const sent = [], signals = [], child = {pid: 77, kill: signal => signals.push(signal)};
  killTree(child, {platform: 'darwin', kill: (...args) => sent.push(args)});
  killTree(child, {platform: 'linux', signal: 'SIGKILL', kill: (...args) => sent.push(args)});
  assert.deepEqual(sent, [[-77, 'SIGTERM'], [-77, 'SIGKILL']]);
  killTree(child, {platform: 'darwin', kill: () => { throw new Error('ESRCH'); }});
  assert.deepEqual(signals, ['SIGTERM']);
});

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (check, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { const value = check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); } return null; };

test('a grandchild is really gone after the stop (Mac/Linux: a real process group; Windows runs the real taskkill)', async () => {
  const note = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kill-tree-')), 'grandchild.pid');
  // The child starts a grandchild (like python starting pip) that would run for a minute, and writes its pid down.
  const script = `const {spawn}=require('node:child_process');const g=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(note)},String(g.pid));setTimeout(()=>{},60000)`;
  const child = spawn(process.execPath, ['-e', script], {detached: process.platform !== 'win32', stdio: 'ignore'});
  try {
    const grandchild = Number(await waitFor(() => fs.existsSync(note) && fs.readFileSync(note, 'utf8')));
    assert.ok(grandchild && alive(grandchild), 'the grandchild is running before the stop');
    killTree(child);
    assert.ok(await waitFor(() => !alive(grandchild)), 'the grandchild is gone after the stop');
  } finally { try { process.kill(-child.pid, 'SIGKILL'); } catch {} try { child.kill('SIGKILL'); } catch {} }
});
