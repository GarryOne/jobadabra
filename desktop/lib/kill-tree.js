// Owns: killTree(), how a run of the engine is ended together with everything it started (pip, a browser…), per platform. Used by lib/pipeline-run.js and lib/pipeline-queue.js.
// Guarded by: test/kill-tree.test.js.
import {spawnSync} from 'node:child_process';
import {log as appLog} from './log.js';

// Ends a run and everything it started. A run is its own process group on Mac/Linux and its tree on Windows: the add-on setup's `pip install --target <data folder>` (a grandchild)
// outlived the app, kept the folder from being renamed on Windows, and a Reset or Import failed with EPERM (18 Oct 2026, Windows settings suite); on Mac/Linux it would keep
// writing into the folder orphaned. Windows: taskkill /T. Elsewhere: the engine is spawned detached (a group of its own), and the signal goes to the whole group.
// Guard: test/pipeline-run.test.js (a grandchild is gone after the stop, per platform branch).
// Windows logs what taskkill said and, 2 s later, whether the pid is still alive (25 Oct 2026, beta 0.8.30: a run shown Stopped held the run lock for ~4 minutes and
// nothing recorded whether taskkill had worked). `after` and `alive` are for the tests.
export function killTree(child, {platform = process.platform, run = spawnSync, signal = 'SIGTERM', kill = process.kill.bind(process), log = appLog, after = setTimeout,
  alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } }} = {}) {
  if (platform === 'win32') {
    if (child.pid) {
      try {
        const done = run('taskkill', ['/pid', String(child.pid), '/T', '/F'], {windowsHide: true, timeout: 5000});
        log('engine', 'taskkill', {pid: child.pid, status: done?.status ?? null, error: done?.error?.code || null, said: String(done?.stderr || done?.stdout || '').trim().slice(0, 160)});
        after(() => { if (alive(child.pid)) log('engine', 'taskkill: the process is still alive 2 s later', {pid: child.pid}); }, 2000)?.unref?.();
        return;
      } catch {}
    }
  } else if (child.pid) { try { kill(-child.pid, signal); return; } catch {} }
  try { child.kill(signal); } catch {}
}
