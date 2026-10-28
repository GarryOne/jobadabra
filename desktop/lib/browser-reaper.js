// Supervisor that ties the hidden browser's life to the app's: it polls the app's pid and kills the browser once the app is gone, however it went.
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const POLL_MS = 1000;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

/** The command that runs this file as a plain Node script with the Electron binary: {command, args, env}. */
export function reaperCommand(appPid, browserPid) {
  return {command: process.execPath, args: [SELF, String(appPid), String(browserPid)], env: {ELECTRON_RUN_AS_NODE: '1'}};
}

/** Start the reaper detached, so it outlives the app that started it; returns its child (already unref'd). */
export function startReaper(appPid, browserPid, spawnImpl = spawn) {
  const {command, args, env} = reaperCommand(appPid, browserPid);
  const child = spawnImpl(command, args, {detached: true, stdio: 'ignore', windowsHide: true, env: {...process.env, ...env}});
  child.on?.('error', () => {});
  child.unref?.();
  return child;
}

// Kills the browser's whole group (it spawns helpers) on POSIX, its tree on Windows.
function killBrowser(pid) {
  if (process.platform === 'win32') { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true}); return; }
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
}

const [appPid, browserPid] = process.argv.slice(2).map(Number);
if (process.argv[1] === SELF && appPid > 0 && browserPid > 0) {
  const timer = setInterval(() => {
    if (!alive(browserPid)) { clearInterval(timer); return; }   // the browser was closed on purpose: nothing left to watch
    if (alive(appPid)) return;
    clearInterval(timer);
    killBrowser(browserPid);
  }, POLL_MS);
}
