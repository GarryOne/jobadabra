// Job: wait on state
// Ends a throwaway test browser by its process tree ending, and fails only when a process of it is still running afterwards.
// Why (31 Oct 2026, a8, run 41239658001): close() waited 3.5 s for the browser's own graceful context.close() and re-threw on expiry, so a case whose assertions had
// passed went red because a disposable profile closed slowly on a loaded runner (green on other branches the same minute). The profile is unique and has nothing to keep:
// the end state is "no process of this profile is alive", not "the browser answered a close request". Guard: test/browser-end.test.mjs.
import {descendantsOf, holdersOf, isAlive, listProcesses, waitTreeGone} from './app-tree.mjs';

const WHOLE_COMMAND = 100000;   // Chromium puts --user-data-dir after ~1500 characters of flags; app-tree's default 200 would never see it

/** Every process that was started with this profile (`--user-data-dir=<profile>`) plus the children below them. [] when the lister finds none. */
export function profileTree(profile, rows = listProcesses({width: WHOLE_COMMAND})) {
  if (!profile) return [];
  const flag = new RegExp(`--user-data-dir=["']?${profile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![^\\s"'])`);   // the whole path: a profile that starts with this one is another browser
  const own = rows.filter(row => flag.test(row.command));
  const ids = new Set(own.map(row => row.pid));
  const roots = own.filter(row => !ids.has(row.ppid));
  const below = roots.flatMap(root => descendantsOf(rows, root.pid));
  return [...new Map([...own, ...below].map(row => [row.pid, row])).values()];
}

/**
 * Ends the browser that owns `profile`: asks it to quit through `control` (CDP Browser.close, not awaited), kills the profile's processes, then waits for them to be gone
 * (the step's own hang cap is the only clock: app-tree waitTreeGone). Throws naming the holders only when a process is still alive after a second kill.
 * `launched`: the browser was started, so seeing none of its processes is no verdict (the lister failed, or its command lines were cut): `fallback` (the browser's own close) ends it instead.
 * `list`, `kill`, `alive` and `capMs` are injectable for the unit test.
 */
export async function endBrowser({profile, control = null, launched = false, fallback = null, list = () => listProcesses({width: WHOLE_COMMAND}), kill = (pid, signal) => process.kill(pid, signal), alive = isAlive, capMs}) {
  void control?.send('Browser.close').catch(() => {});   // the polite way, never waited for
  let left = profileTree(profile, list());
  if (!left.length && launched && fallback) { await fallback(); return; }
  for (let attempt = 0; attempt < 2 && left.length; attempt++) {
    for (const row of left) { try { kill(row.pid, 'SIGKILL'); } catch { /* already gone */ } }
    left = await waitTreeGone(left, {alive, ...(capMs === undefined ? {} : {capMs})});
  }
  if (left.length) throw new Error(`isolated browser: still running after kill: ${holdersOf(left)}`);
}
