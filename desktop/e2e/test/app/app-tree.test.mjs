// The app's process tree: parsed from the platform lister, walked below the app's pid, and waited on until every process of it is gone.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import test from 'node:test';
import {descendantsOf, endTree, holdersOf, isAlive, lineageOf, listProcesses, parseProcessList, treeOf, waitTreeGone} from '../../lib/app-tree.mjs';

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

// Why (1 Nov 2026, beta #4 run 41309751593, Windows apply-2of3): a close logged "155 process(es) below it" and the runner died. On Windows a process's parent id is never updated when
// the parent ends and can match a newer process that reused the pid, so a process is identified by (pid, started) and is a child only if it was not created before its parent.
const proc = (pid, ppid, started, command = `p${pid}`) => ({pid, ppid, started, command});
const self = {pid: 600, ppid: 550};   // the harness: a node (600) under the step's shell (550) under the runner (500)

test('a process whose parent id is the app\'s pid but was created before the app is not its child (a reused pid)', () => {
  const rows = [proc(5396, 700, 2000, 'launcher'), proc(7, 5396, 1000, 'made by the pid\'s earlier owner'), proc(8, 5396, 2500, 'electron'), proc(9, 8, 3000, 'helper'),
    proc(10, 8, 100, 'stale: made by the earlier owner of pid 8'), proc(11, 7, 1500, 'below the stale one')];
  assert.deepEqual(descendantsOf(rows, 5396, {self}).map(row => row.pid), [8, 9]);
  assert.deepEqual(descendantsOf(rows, rows[0], {self}).map(row => row.pid), [8, 9], 'the root is a row (its start decides), not only a pid');
  assert.deepEqual(treeOf(rows, 5396, {self}).map(row => row.pid), [5396, 8, 9], 'the launcher is the listed row, with its start');
  assert.deepEqual(treeOf([], 5396, {self}), [{pid: 5396, ppid: 0, started: null, command: 'the launcher'}], 'a lister that answered nothing: the launcher, as far as it is known');
});

test('the harness and everything above it are never in the tree, nor what hangs below them, even when a stale parent id points at the app', () => {
  // The lister gave no start times, so only the lineage can tell: runner 500 -> shell 550 -> harness 600, and a runner helper 501 next to the shell.
  const rows = [proc(5396, 1, null, 'launcher'), proc(8, 5396, null, 'electron'), proc(500, 5396, null, 'runner'), proc(550, 500, null, 'shell'), proc(600, 550, null, 'harness'), proc(501, 500, null, 'runner helper')];
  assert.deepEqual(descendantsOf(rows, 5396, {self}).map(row => row.pid), [8]);
  assert.deepEqual(treeOf(rows, 600, {self}), [], 'the harness is never the root of a tree to end');
  assert.deepEqual(treeOf(rows, 5396, {self}).map(row => row.pid), [5396, 8], 'the app is not above the harness, whatever a parent id says: it is ended, the runner is not');
  assert.deepEqual([...lineageOf(rows, self, 5396)].sort(), [500, 550, 600]);
  assert.deepEqual(treeOf([proc(500, 1, 100), proc(550, 500, 200), proc(600, 550, 300)], 500, {self}), [], 'a root the clock shows to be above the harness is never ended');
  const reused = [proc(500, 1, 100), proc(600, 550, 300), proc(550, 1, 9000, 'an unrelated process that took the ended shell\'s pid')];
  assert.deepEqual([...lineageOf(reused, self)], [600], 'a parent id that matches a newer process is not an ancestor');
});

test('the lister gives a start time per process: Windows as @ms, Mac and Linux from lstart (read in the C locale)', () => {
  assert.deepEqual(parseProcessList('  7 1 @13300000000000 Electron.exe C:\\app')[0], {pid: 7, ppid: 1, started: 13300000000000, command: 'Electron.exe C:\\app'});
  assert.equal(parseProcessList(LIST)[0].started, null, 'no start column: unknown, not 0');
  const calls = [];
  const run = (command, args, options) => { calls.push({command, args, env: options.env}); return {stdout: '  10     1 Sun Nov  1 13:20:05 2026 /Applications/Electron main\n  11    10 Sun Nov  1 13:20:06 2026 Electron Helper (GPU)\n'}; };
  const [main, helper] = listProcesses({run, platform: 'darwin'});
  assert.equal(main.started, Date.parse('Sun Nov  1 13:20:05 2026'));
  assert.equal(helper.started - main.started, 1000);
  assert.equal(main.command, '/Applications/Electron main', 'the date is not part of the command');
  assert.match(calls[0].args.join(' '), /lstart=/);
  assert.equal(calls[0].env.LC_ALL, 'C');
  const asked = [];
  listProcesses({run: (command, args) => { asked.push(args.join(' ')); return {stdout: ''}; }, platform: 'win32'});
  assert.match(asked[0], /CreationDate/);
});

test('a pid that another process has taken since is gone at the next look, not after the whole cap', async () => {
  const launcher = proc(5396, 700, 2000, 'launcher');
  let time = 0, pauses = 0;
  const left = await waitTreeGone([launcher], {alive: () => true, list: () => [proc(5396, 1, 9000, 'something else with the pid')], capMs: 10000, everyMs: 50,
    now: () => time, pause: async ms => { pauses++; time += ms; }});
  assert.deepEqual(left, []);
  assert.ok(pauses <= 1, `waited ${pauses} looks (${time} ms) for a process that was already another one`);
  // ps lstart is read to the second and can differ by one between two calls for one process: that is still the process. Only a clearly later start is another one.
  for (const jitter of [-1000, 1000]) {
    time = 0;
    const same = await waitTreeGone([launcher], {alive: () => true, list: () => [proc(5396, 700, 2000 + jitter)], capMs: 200, everyMs: 50, now: () => time, pause: async ms => { time += ms; }});
    assert.deepEqual(same.map(row => row.pid), [5396], `a start ${jitter} ms off is the same process`);
  }
  // The list is a slow call on Windows (PowerShell): read once per second, not once per 50 ms look.
  let reads = 0;
  time = 0;
  await waitTreeGone([launcher], {alive: () => true, list: () => { reads++; return [proc(5396, 700, 2000)]; }, capMs: 3000, everyMs: 50, now: () => time, pause: async ms => { time += ms; }});
  assert.ok(reads <= 4, `read the process list ${reads} times in 3 s of waiting`);
  // The same pid with the same start is still the process: it stays named. A lister that answers nothing (or does not list the pid) gives no verdict, so the pid decides.
  for (const list of [() => [proc(5396, 700, 2000)], () => [], () => [proc(1, 0, 1)]]) {
    time = 0;
    const stays = await waitTreeGone([launcher], {alive: () => true, list, capMs: 500, everyMs: 50, now: () => time, pause: async ms => { time += ms; }});
    assert.deepEqual(stays.map(row => row.pid), [5396]);
  }
});

test('the real lister gives every process a start time that is now or earlier (positive control: a parse miss would silently turn the identity off)', { skip: process.platform === 'win32' }, () => {
  const rows = listProcesses();
  const me = rows.find(row => row.pid === process.pid);
  assert.ok(me, 'this process is listed');
  assert.ok(me.started > Date.now() - 86400000 * 365 && me.started <= Date.now() + 2000, `this process's start time is ${me.started}`);
  assert.equal(rows.filter(row => row.started == null).length, 0, `rows without a start: ${rows.filter(row => row.started == null).slice(0, 3).map(row => row.command).join(' | ')}`);
});
