// Test helper: is a process gone, read from its state, not from kill(pid, 0) alone (which also answers for a dead process nobody has reaped yet).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

/**
 * 'gone' (no such pid), or the first letter of its state: Z a dead process waiting to be reaped, X dying, anything else running.
 * Why (31 Oct 2026, a8; #2726 run 41231359925): a killed grandchild is reparented to init and stays a zombie until init reaps it; kill(pid, 0) answers for a zombie,
 * so `alive(grandchild) === false` right after the quit failed on a loaded runner. A test's own child is reaped by node before its 'exit': only an orphan needs this.
 */
export function stateOf(pid) {
  try { process.kill(pid, 0); } catch (error) { if (error.code !== 'EPERM') return 'gone'; }
  try {
    if (process.platform === 'linux') return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '')[0];   // after the "(name)" field
    return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {encoding: 'utf8'}).trim()[0] || 'gone';
  } catch { return 'gone'; }   // it went between the two reads
}

/** True when the process no longer runs: no such pid, or dead and not yet reaped. */
export const isGone = pid => ['gone', 'Z', 'X'].includes(stateOf(pid));

/** Waits for the process to be gone for at most `ms`; -> {gone, state}, the state it was last seen in (for the failure message). Not a retry: it ends on the state it waits for. */
export async function untilGone(pid, ms = 5000) {
  let state = stateOf(pid);
  for (const end = Date.now() + ms; !['gone', 'Z', 'X'].includes(state) && Date.now() < end;) {
    await new Promise(resolve => setTimeout(resolve, 20));
    state = stateOf(pid);
  }
  return {gone: ['gone', 'Z', 'X'].includes(state), state};
}
