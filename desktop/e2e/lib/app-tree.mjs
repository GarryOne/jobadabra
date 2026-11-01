// The test app's process tree: list it before the app quits, then wait until every process of it is gone, naming the ones that are not (Windows: the holders of the data folder).
// Why (31 Oct 2026, owner: quitting must end every engine child): the harness exited the app with electron.exit(0) and never looked at what it left behind. Guard: test/app/app-tree.test.mjs.
// Job: wait on state
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {stepTimeLeft} from './wait-on-state.mjs';

const LIST_MS = 15000;   // one query about processes, not a wait for a state
const NO_STEP_CAP_MS = 15000;   // only a unit test has no runner step; a step's own clock is its hang cap (stepTimeLeft)

/** `pid ppid command…` lines → [{pid, ppid, command}]. */
export const parseProcessList = (text, width = 200) => String(text || '').split(/\r?\n/).map(line => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
  .map(([, pid, ppid, command]) => ({pid: Number(pid), ppid: Number(ppid), command: command.slice(0, width)}));

/** Every process below `root` (children, their children…), not `root` itself. */
export function descendantsOf(rows, root) {
  const found = new Set(), todo = [root];
  while (todo.length) {
    const parent = todo.pop();
    for (const row of rows) if (row.ppid === parent && !found.has(row.pid) && row.pid !== root) { found.add(row.pid); todo.push(row.pid); }
  }
  return rows.filter(row => found.has(row.pid));
}

/** All processes now, as {pid, ppid, command}; [] when the platform's lister fails (a missing answer is no verdict). */
export function listProcesses({run = spawnSync, platform = process.platform, width = 200} = {}) {
  const done = platform === 'win32'
    ? run('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name) $($_.CommandLine)" }'], {encoding: 'utf8', timeout: LIST_MS, windowsHide: true})
    : run('ps', ['-A', '-o', 'pid=,ppid=,command='], {encoding: 'utf8', maxBuffer: 16 << 20});
  return parseProcessList(done?.stdout, width);
}

/** Running (a zombie waiting to be reaped is gone: the program has ended). */
export function isAlive(pid, {kill = process.kill.bind(process), stat = file => fs.readFileSync(file, 'utf8')} = {}) {
  try { kill(pid, 0); } catch (error) { return error.code === 'EPERM'; }
  try { return !/^\d+ \(.*\) Z/s.test(stat(`/proc/${pid}/stat`)); } catch { return true; }   // no /proc (Mac, Windows): alive
}

/**
 * Resolves with the rows of `tree` still running after at most `capMs` ([] = the whole tree is gone). A process that is not our child has no exit event to wait on, so this looks at
 * each pid every `everyMs` until none is left; the step's hang cap (stepTimeLeft) only turns "never" into a message that names the holders.
 */
export async function waitTreeGone(tree, {alive = isAlive, capMs = stepTimeLeft() ?? NO_STEP_CAP_MS, everyMs = 50, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  const started = now();
  let left = tree.filter(row => alive(row.pid));
  while (left.length && now() - started < capMs) { await pause(everyMs); left = left.filter(row => alive(row.pid)); }
  return left;
}

/**
 * Gives `tree` up to `graceMs` to leave by itself (state wait: every pid gone), then ends the rows still running and waits until they are gone too (the OS lets go of a killed
 * process's files a moment later). -> the rows that had to be ended ([] = all left on their own); throws naming the rows that outlive the kill.
 * Why (1 Nov 2026, #2717): a crash close ended the launcher and nothing below it; on Windows the launcher is a shell and the app is its child (Playwright, shell: true).
 */
export async function endTree(tree, {graceMs, wait = waitTreeGone, kill = process.kill.bind(process)} = {}) {
  // Why (1 Nov 2026, #2755, Gitar): no default; the 5 s a closing app gets is lib/app.mjs EXIT_GUARD_MS, owned by the caller, so there is one copy of it.
  if (!Number.isFinite(graceMs)) throw new Error('endTree: graceMs is the caller\'s (lib/app.mjs EXIT_GUARD_MS)');
  const left = await wait(tree, {capMs: graceMs});
  for (const row of left) { try { kill(row.pid, 'SIGKILL'); } catch { /* ESRCH: gone since the check; EPERM: it stays and the wait below names it, the other rows are still ended */ } }
  const stayed = await wait(left);   // a pure state wait on the step's own clock (stepTimeLeft), not a bound of its own: the OS lets go of a killed process's files a moment later
  if (stayed.length) throw new Error(`${stayed.length} process(es) of the closed app are still running after being killed: ${holdersOf(stayed)}`);
  return left;
}

/** "pid command | pid command": who is still running. */
export const holdersOf = rows => rows.map(row => `${row.pid} ${row.command}`).join(' | ');
