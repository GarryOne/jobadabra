// Waits until no earlier run holds the engine's run lock, so a step that times a run (the hung-AI one) measures that run alone (#1662).
// The holder writes {pid, label, at} into <data>/run.lock (src/paths.py run_lock) and leaves it there on release, so "held" = the noted pid is alive.
// Tests: desktop/e2e/test/run-lock.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

export const WAIT_LINE = /Another Jobadabra search is running/;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// The note's holder {pid, label, at} while that process is alive, else null.
export function lockHolder(dataDir, isAlive = alive) {
  let info;
  try { info = JSON.parse(fs.readFileSync(path.join(dataDir, 'run.lock'), 'utf8') || '{}'); } catch { return null; }
  return info && Number.isInteger(info.pid) && info.pid !== process.pid && isAlive(info.pid) ? info : null;
}

// Resolves once nobody holds the lock; throws, naming the holder, after maxMs.
export async function waitForRunLock(dataDir, {maxMs = 120000, pollMs = 1000, isAlive = alive, sleep = ms => new Promise(done => setTimeout(done, ms))} = {}) {
  const started = Date.now();
  for (;;) {
    const holder = lockHolder(dataDir, isAlive);
    if (!holder) return;
    if (Date.now() - started >= maxMs) throw new Error(`an earlier ${holder.label || ''} run (pid ${holder.pid}) still holds the run lock after ${Math.round(maxMs / 1000)} s`.replace('  ', ' '));
    await sleep(pollMs);
  }
}

// A stopped run's log must not have waited for another run: that is not the silence the step tests.
export const waitedForLock = log => WAIT_LINE.test(Array.isArray(log) ? log.join('\n') : String(log || ''));
