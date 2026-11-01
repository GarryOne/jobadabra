// The test app's process tree: list it before the app quits, then wait until every process of it is gone, naming the ones that are not (Windows: the holders of the data folder).
// Why (31 Oct 2026, owner: quitting must end every engine child): the harness exited the app with electron.exit(0) and never looked at what it left behind. Guard: test/app-tree.test.mjs.
// Job: wait on state
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {stepTimeLeft} from './wait-on-state.mjs';

const LIST_MS = 15000;   // one query about processes, not a wait for a state
const NO_STEP_CAP_MS = 15000;   // only a unit test has no runner step; a step's own clock is its hang cap (stepTimeLeft)

/**
 * `pid ppid [@started] command…` lines → [{pid, ppid, started, command}]. `started` is the creation time in ms; null when the lister gave none (a row is then known by its pid alone).
 */
export const parseProcessList = (text, width = 200) => String(text || '').split(/\r?\n/).map(line => /^\s*(\d+)\s+(\d+)\s+(?:@(\d+)\s+)?(.*)$/.exec(line)).filter(Boolean)
  .map(([, pid, ppid, started, command]) => ({pid: Number(pid), ppid: Number(ppid), started: Number(started) || null, command: command.slice(0, width)}));

// Why (1 Nov 2026, beta #4 run 41309751593, Windows apply-2of3): a process is (pid, started), never a bare pid. Windows keeps a dead parent's pid as the parent id of what it made, and a newer
// process can take that pid, so a parent id alone put 155 processes "below" the app, the runner's own among them. Only a clock can tell the two apart: a child is never older than its parent.
const bornBefore = (row, other) => row.started != null && other.started != null && row.started < other.started;

/**
 * The harness's own pid and every ancestor (parent id matched, and not created after its child): what a close must never end. `self` is {pid, ppid}; a lister that did not list it
 * still has process.ppid, so the walk starts from there. `launched` is a pid the harness itself started: when the clock cannot tell (a start time is missing) it is not above the
 * harness, so the walk stops there (a stale parent id at the top of the chain can point at it); when both start times are known the clock decides like for any other row.
 */
export function lineageOf(rows, self = {pid: process.pid, ppid: process.ppid}, launched = null) {
  const found = new Set([self.pid]);
  for (let current = rows.find(row => row.pid === self.pid) ?? self; ;) {
    const parent = rows.find(row => row.pid === current.ppid && !bornBefore(current, row));
    if (!parent || found.has(parent.pid) || (parent.pid === launched && (current.started == null || parent.started == null))) return found;
    found.add(parent.pid);
    current = parent;
  }
}

/** Every row below `top` (children, their children…) that is not the harness's lineage; the walk does not go through a lineage row (what hangs below it is not the app's). */
function belowRow(rows, top, spared) {
  const found = new Set(), todo = [top];
  while (todo.length) {
    const parent = todo.pop();
    for (const row of rows) {
      if (row.ppid !== parent.pid || bornBefore(row, parent) || row.pid === top.pid || found.has(row) || spared.has(row.pid)) continue;
      found.add(row);
      todo.push(row);
    }
  }
  return rows.filter(row => found.has(row));
}

/** Every process below `root` (a row, or a pid looked up in `rows`), not `root` itself, never the harness or what is above it. */
export function descendantsOf(rows, root, {self} = {}) {
  const top = typeof root === 'object' ? root : rows.find(row => row.pid === root) ?? {pid: root, ppid: 0, started: null, command: ''};
  const spared = lineageOf(rows, self, top.pid);
  return spared.has(top.pid) ? [] : belowRow(rows, top, spared);
}

/** The process set of one launch: its root as listed (else the bare pid, when the lister answered nothing) and everything below it. [] if the root is the harness or above it. */
export function treeOf(rows, pid, {self} = {}) {
  const root = rows.find(row => row.pid === pid) ?? {pid, ppid: 0, started: null, command: 'the launcher'};
  return lineageOf(rows, self, pid).has(pid) ? [] : [root, ...descendantsOf(rows, root, {self})];
}

/**
 * All processes now, as {pid, ppid, started, command}; [] when the platform's lister fails (a missing answer is no verdict). Windows reads Win32_Process.CreationDate; Mac and Linux read
 * `ps lstart` in the C locale (a localized date would not parse) and turn it into ms, so there is one identity everywhere.
 */
export function listProcesses({run = spawnSync, platform = process.platform, width = 200} = {}) {
  const done = platform === 'win32'
    ? run('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) @$(if ($_.CreationDate) { [long]($_.CreationDate.ToFileTimeUtc() / 10000) } else { 0 }) $($_.Name) $($_.CommandLine)" }'], {encoding: 'utf8', timeout: LIST_MS, windowsHide: true})
    : run('ps', ['-A', '-o', 'pid=,ppid=,lstart=,command='], {encoding: 'utf8', maxBuffer: 16 << 20, env: {...process.env, LC_ALL: 'C'}});
  const text = String(done?.stdout || '');
  return parseProcessList(platform === 'win32' ? text : startsAsMs(text), width);
}

const LSTART = /^(\s*\d+\s+\d+\s+)[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d\d:\d\d:\d\d\s+\d{4}\s+/;
const startsAsMs = text => text.split(/\r?\n/).map(line => line.replace(LSTART, (whole, ids) => { const ms = Date.parse(whole.slice(ids.length)); return Number.isFinite(ms) ? `${ids}@${ms} ` : ids; })).join('\n');

/** Running (a zombie waiting to be reaped is gone: the program has ended). */
export function isAlive(pid, {kill = process.kill.bind(process), stat = file => fs.readFileSync(file, 'utf8')} = {}) {
  try { kill(pid, 0); } catch (error) { return error.code === 'EPERM'; }
  try { return !/^\d+ \(.*\) Z/s.test(stat(`/proc/${pid}/stat`)); } catch { return true; }   // no /proc (Mac, Windows): alive
}

// Why (1 Nov 2026, review of this fix): `ps lstart` has 1 s resolution and procps derives it from the uptime, so two `ps` calls can differ by a second for one process. A pid that was
// taken over is always newer than the process it replaces, so only a start later than this slack is "another process".
const START_SLACK_MS = 2000;
const IDENTITY_EVERY_MS = 1000;   // the Windows lister is a PowerShell run of seconds that blocks the loop: read it at most this often, the cheap pid check runs every look

/**
 * Resolves with the rows of `tree` still running after at most `capMs` ([] = the whole tree is gone). A process that is not our child has no exit event to wait on, so this looks at
 * each pid every `everyMs` until none is left; the step's hang cap (stepTimeLeft) only turns "never" into a message that names the holders.
 * A row is the same process only while its pid still has its `started`: a pid the list now shows with a later start time is another process, so the row is gone. The list is read only
 * while a row with a start time still seems to run; a list that is empty or lacks the pid gives no verdict (the lister can fail), and a row without a start time is known by its pid.
 */
export async function waitTreeGone(tree, {alive = isAlive, list = () => listProcesses({width: 0}), capMs = stepTimeLeft() ?? NO_STEP_CAP_MS, everyMs = 50, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  let taken = new Map(), readAt = -Infinity;
  const running = rows => {
    const seeming = rows.filter(row => alive(row.pid));
    if (!seeming.some(row => row.started != null)) return seeming;
    if (now() - readAt >= IDENTITY_EVERY_MS) { taken = new Map(list().map(row => [row.pid, row])); readAt = now(); }
    return seeming.filter(row => row.started == null || (taken.get(row.pid)?.started ?? row.started) <= row.started + START_SLACK_MS);
  };
  const began = now();
  let left = running(tree);
  while (left.length && now() - began < capMs) { await pause(everyMs); left = running(left); }
  return left;
}

/**
 * Gives `tree` up to `graceMs` to leave by itself (state wait: every pid gone), then ends the rows still running and waits until they are gone too (the OS lets go of a killed
 * process's files a moment later). -> the rows that had to be ended ([] = all left on their own); throws naming the rows that outlive the kill.
 * Why (1 Nov 2026, #2717): a crash close ended the launcher and nothing below it; on Windows the launcher is a shell and the app is its child (Playwright, shell: true).
 */
export async function endTree(tree, {graceMs, wait = waitTreeGone, kill = process.kill.bind(process), list} = {}) {
  // Why (1 Nov 2026, #2755, Gitar): no default; the 5 s a closing app gets is lib/app.mjs EXIT_GUARD_MS, owned by the caller, so there is one copy of it.
  if (!Number.isFinite(graceMs)) throw new Error('endTree: graceMs is the caller\'s (lib/app.mjs EXIT_GUARD_MS)');
  const left = await wait(tree, {capMs: graceMs, list});
  for (const row of left) { try { kill(row.pid, 'SIGKILL'); } catch { /* ESRCH: gone since the check; EPERM: it stays and the wait below names it, the other rows are still ended */ } }
  const stayed = await wait(left, {list});   // a pure state wait on the step's own clock (stepTimeLeft), not a bound of its own: the OS lets go of a killed process's files a moment later
  if (stayed.length) throw new Error(`${stayed.length} process(es) of the closed app are still running after being killed: ${holdersOf(stayed)}`);
  return left;
}

/** "pid command | pid command": who is still running. */
export const holdersOf = rows => rows.map(row => `${row.pid} ${row.command}`).join(' | ');
