// Ending a throwaway test browser: its process tree ends and the case passes; a process that survives the kill fails it (lib/browser-end.mjs).
// Why (31 Oct 2026, a8, run 41239658001): 'Stop halts a fill with the panel open' passed its assertions and went red on "isolated browser.close timed out after 3500ms".
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {listProcesses} from '../../lib/app-tree.mjs';
import {endBrowser, profileTree} from '../../lib/browser-end.mjs';

const row = (pid, ppid, command) => ({pid, ppid, command});
const profile = path.join(os.tmpdir(), 'jp-real-ext-abc123');

test('the profile tree is every process started with that profile plus the children below them, and no other profile', () => {
  const rows = [row(10, 1, `chrome --user-data-dir=${profile} --headless=new`), row(11, 10, 'chrome --type=renderer'), row(12, 11, 'chrome --type=utility'),
    row(20, 1, 'chrome --user-data-dir=/tmp/other-profile'), row(21, 20, 'chrome --type=gpu'), row(30, 1, `chrome --user-data-dir=${profile}-2`)];
  assert.deepEqual(profileTree(profile, rows).map(item => item.pid).sort(), [10, 11, 12]);
  assert.deepEqual(profileTree('', rows), [], 'no profile (a launch that never got one): nothing to end');
});

test('Chromium puts the profile flag after ~1500 characters of other flags: the process list is read whole, not cut at 200', () => {
  const flags = Array.from({length: 120}, (_, index) => `--disable-feature-${index}`).join(' ');
  const stdout = `  10 1 /Applications/Chromium --headless=new ${flags} --user-data-dir=${profile} --no-first-run\n  11 10 chrome --type=renderer\n`;
  const run = () => ({stdout});
  assert.deepEqual(profileTree(profile, listProcesses({run, platform: 'darwin', width: 100000})).map(item => item.pid), [10, 11]);
  assert.deepEqual(profileTree(profile, listProcesses({run, platform: 'darwin'})), [], 'the default 200-character cut cannot see the flag (why the width is an option)');
});

test('a browser whose graceful close hangs for 4 s still ends at once, and the case that finished passes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-browser-end-'));
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', `--user-data-dir=${dir}`], {stdio: 'ignore'});
  const exited = new Promise(resolve => child.once('exit', resolve));
  const control = {send: () => new Promise(() => {})};   // Browser.close that never answers, like a browser that is slow to close on a loaded runner
  try {
    const began = Date.now();
    await endBrowser({profile: dir, control, list: () => [row(child.pid, process.pid, `node -e x --user-data-dir=${dir}`)]});
    assert.ok(Date.now() - began < 3000, `ended in ${Date.now() - began} ms, not after the 4 s the graceful close needs`);
    await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('the process is still running')), 3000))]);
  } finally { child.kill('SIGKILL'); fs.rmSync(dir, {recursive: true, force: true}); }
});

test('a process that is still alive after the kill fails the close and names its holder', async () => {
  const stubborn = row(4242, 1, `chrome --user-data-dir=${profile}`);
  const kills = [];
  await assert.rejects(endBrowser({profile, list: () => [stubborn], kill: (pid, signal) => kills.push([pid, signal]), alive: () => true, capMs: 30}),
    /still running after kill: 4242 chrome/);
  assert.deepEqual(kills, [[4242, 'SIGKILL'], [4242, 'SIGKILL']], 'killed, waited, killed again, then failed');
});

test('a browser that left on the first kill needs no second one, and a profile with no process is a pass', async () => {
  const kills = [];
  let alive = true;
  await endBrowser({profile, list: () => [row(7, 1, `chrome --user-data-dir=${profile}`)], kill: pid => { kills.push(pid); alive = false; }, alive: () => alive, capMs: 100});
  assert.deepEqual(kills, [7]);
  await endBrowser({profile, list: () => [], kill: () => assert.fail('nothing to kill'), capMs: 10});
});

test('a launched browser whose processes cannot be seen (the lister failed) is closed by its own close, never passed while running', async () => {
  let closed = 0;
  await endBrowser({profile, launched: true, list: () => [], fallback: async () => { closed++; }});
  assert.equal(closed, 1);
  await assert.rejects(endBrowser({profile, launched: true, list: () => [], fallback: async () => { throw new Error('context.close failed'); }}), /context\.close failed/);
  await endBrowser({profile, launched: false, list: () => [], fallback: async () => assert.fail('a browser that never launched has nothing to close')});
});
