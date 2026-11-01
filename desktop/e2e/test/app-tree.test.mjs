// The app's process tree: parsed from the platform lister, walked below the app's pid, and waited on until every process of it is gone.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import test from 'node:test';
import {descendantsOf, endTree, holdersOf, isAlive, listProcesses, parseProcessList, waitTreeGone} from '../lib/app-tree.mjs';

const LIST = `  10     1 /Applications/Electron main
  11    10 Electron Helper (GPU)
  12    10 python3 -m src.focus
  13    12 python3 -m pip
  99     1 unrelated`;

test('parses pid, parent and command, and walks every level below the root only', () => {
  const rows = parseProcessList(LIST);
  assert.equal(rows.length, 5);
  assert.deepEqual(descendantsOf(rows, 10).map(row => row.pid).sort(), [11, 12, 13]);
  assert.deepEqual(descendantsOf(rows, 99), []);
  assert.equal(holdersOf(descendantsOf(rows, 12)), '13 python3 -m pip');
});

test('the lister answers with rows, or none when it fails', () => {
  assert.equal(listProcesses({run: () => ({stdout: LIST}), platform: 'linux'}).length, 5);
  assert.deepEqual(listProcesses({run: () => ({stdout: undefined, error: new Error('no ps')}), platform: 'linux'}), []);
  assert.equal(listProcesses({run: (command) => ({stdout: command === 'powershell' ? '7 1 Electron.exe C:\\app' : ''}), platform: 'win32'})[0].pid, 7);
});

test('a zombie is not running; a live process and one we may not signal are', () => {
  const live = () => {};
  assert.equal(isAlive(5, {kill: live, stat: () => '5 (python3) Z 1 5 5'}), false);
  assert.equal(isAlive(5, {kill: live, stat: () => '5 (python3) S 1 5 5'}), true);
  assert.equal(isAlive(5, {kill: live, stat: () => { throw new Error('no /proc'); }}), true);
  assert.equal(isAlive(5, {kill: () => { throw Object.assign(new Error('x'), {code: 'EPERM'}); }}), true);
  assert.equal(isAlive(5, {kill: () => { throw Object.assign(new Error('x'), {code: 'ESRCH'}); }}), false);
});

test('waits until the pids are gone, and names the ones that stay past the cap', async () => {
  const rows = parseProcessList(LIST);
  const states = new Map([[11, 2], [12, 1], [13, 0]]);   // checks left before each is gone
  const alive = pid => { const left = states.get(pid) ?? 0; states.set(pid, Math.max(0, left - 1)); return left > 0; };
  assert.deepEqual(await waitTreeGone(descendantsOf(rows, 10), {alive, everyMs: 1, capMs: 1000}), []);
  const stuck = await waitTreeGone([rows[2]], {alive: () => true, everyMs: 1, capMs: 20});
  assert.equal(holdersOf(stuck), '12 python3 -m src.focus');
});

test('a real process that ends after we look is waited for, a real one that stays is named', async t => {
  const stays = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {stdio: 'ignore'});
  const ends = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], {stdio: 'ignore'});
  t.after(() => stays.kill('SIGKILL'));
  const rows = [{pid: ends.pid, ppid: process.pid, command: 'ends'}, {pid: stays.pid, ppid: process.pid, command: 'stays'}];
  const left = await waitTreeGone(rows, {everyMs: 20, capMs: 3000});
  assert.deepEqual(left.map(row => row.command), ['stays']);
});

test('endTree: leaves alone what leaves by itself, kills what stays and waits for it, and says what outlives the kill', async () => {
  const rows = parseProcessList(LIST).slice(0, 3);
  const killed = [];
  const kill = (pid, signal) => { killed.push(`${pid} ${signal}`); };
  await assert.rejects(endTree(rows, {wait: async () => [], kill}), /graceMs is the caller's/, 'no default: the caller owns the grace');
  assert.deepEqual(await endTree(rows, {graceMs: 1, wait: async () => [], kill}), []);
  assert.deepEqual(killed, [], 'nothing is killed when the whole tree left on its own');

  const waits = [[rows[1]], []];   // first wait: 11 stays; second wait (after the kill): gone
  assert.deepEqual((await endTree(rows, {graceMs: 1, wait: async () => waits.shift(), kill})).map(row => row.pid), [11]);
  assert.deepEqual(killed, ['11 SIGKILL']);

  const gone = Object.assign(new Error('no such process'), {code: 'ESRCH'});
  const waitsAgain = [[rows[2]], []];
  assert.deepEqual((await endTree(rows, {graceMs: 1, wait: async () => waitsAgain.shift(), kill: () => { throw gone; }})).map(row => row.pid), [12], 'a process that went meanwhile is no error');
  const tried = [], refused = Object.assign(new Error('access denied'), {code: 'EPERM'});
  const waitsThird = [[rows[1], rows[2]], []];
  await endTree(rows, {graceMs: 1, wait: async () => waitsThird.shift(), kill: pid => { tried.push(pid); if (pid === 11) throw refused; }});
  assert.deepEqual(tried, [11, 12], 'a process that cannot be killed does not stop the others being ended');

  await assert.rejects(endTree(rows, {graceMs: 1, wait: async () => [rows[2]], kill}), /1 process\(es\) of the closed app are still running after being killed: 12 python3 -m src\.focus/);
});
