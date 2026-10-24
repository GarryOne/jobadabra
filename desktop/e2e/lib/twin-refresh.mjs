/* global chrome */
// Live update of a running twin (owner, 9 Oct 2026: "if we push a change, can we avoid closing the twin app?", "we're losing the browser/tab state every time").
// The launcher (twin.mjs) owns the browser and keeps it; this file is what a refresh does: bring the twin's worktree to origin/main, say what the
// change touches, and put the extension's new files into the copy the browser already has loaded. The app window is reloaded (renderer) or the app
// alone restarted (its main process) by twin.mjs / twin-drive.mjs; the browser and its tabs stay. Guarded by test/twin-refresh.test.mjs.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {copyExtension} from './extension.mjs';

// What a list of changed files (repo-relative) asks of the running twin. `app`: the Electron main process, its libs or the staged shared files
// (a restart of the app alone). `renderer`: the window's own files (a reload). `extension`: the browser's copy (a reload of the extension).
// The Python engine starts afresh for every run: it needs nothing.
export function classify(files) {
  const has = test => files.some(file => test.test(file));
  return {
    app: has(/^desktop\/(lib|shared)\//) || has(/^desktop\/[^/]+\.(c?js|mjs|json)$/) || has(/^(worker\/src|shared)\//),
    renderer: has(/^desktop\/renderer\//),
    extension: has(/^extension\//),
  };
}

// The twin's copy holds the "all sites" access the owner's Chrome has granted by one click (twin.mjs, 8 Oct 2026).
export function grantAllSites(dir) {
  const file = path.join(dir, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), ...(manifest.optional_host_permissions || [])])];
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
}

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8'}).trim();

// → {from, to, files, kinds} ; {error} when the worktree cannot move (local edits in the way, no network): nothing is changed then.
// `extensionDir`/`port`: the twin's extension copy is rewritten in place when the change touches it.
export function refresh({repo, extensionDir, port}) {
  try {
    git(repo, 'fetch', '-q', 'origin');
    const from = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'merge', '--ff-only', '-q', 'origin/main');
    const to = git(repo, 'rev-parse', 'HEAD');
    const files = from === to ? [] : git(repo, 'diff', '--name-only', from, to).split('\n').filter(Boolean);
    const kinds = classify(files);
    if (kinds.extension) { copyExtension(port, path.join(repo, 'extension'), extensionDir); grantAllSites(extensionDir); }
    return {from: from.slice(0, 7), to: to.slice(0, 7), files: files.length, kinds};
  } catch (error) {
    return {error: String(error.stderr || error.message).split('\n')[0].slice(0, 200)};
  }
}

// Reloads the twin's extension in the running browser the way chrome://extensions' own Reload button does. chrome.runtime.reload() is NOT used: in this
// Chromium (153) it leaves a command-line-loaded extension DISABLED ("unsupportedDeveloperExtension", found 9 Oct 2026 by the first real refresh), with no
// worker and no way back. Developer mode on, then developerPrivate.reload(id) re-reads the same folder (twin.mjs rewrote it in place); it also brings back one
// that is already disabled. → {state, version, running} read back after the reload, so the caller says what is true, not what was asked.
export async function reloadExtension(context) {
  const page = await context.newPage();
  try {
    await page.goto('chrome://extensions/');
    await new Promise(resolve => setTimeout(resolve, 1000));
    return await page.evaluate(async () => {
      const dp = chrome.developerPrivate, list = () => new Promise(resolve => dp.getExtensionsInfo(resolve));
      const [ext] = await list();
      await new Promise(resolve => dp.updateProfileConfiguration({inDeveloperMode: true}, resolve));
      await new Promise(resolve => dp.reload(ext.id, {failQuietly: false, populateErrorForUnpacked: true}, resolve));
      await new Promise(resolve => setTimeout(resolve, 2500));
      const [after] = await list();
      return {state: after.state, version: after.version, running: (after.views || []).some(view => view.type === 'EXTENSION_SERVICE_WORKER_BACKGROUND')};
    });
  } finally { await page.close().catch(() => {}); }
}

// Stops the app the launcher started, as a whole: `spawn` gives the `node .bin/electron` shim, and the real Electron (and its helpers) are its children, so a kill of the
// shim alone leaves them running with the ports and the app's own "Jobadabra is still working" quit prompt up (9 Oct 2026: the first restart hung 90 s on that prompt;
// a SIGKILL of the shim left an orphan on the debugging port). The child is started detached (its own group); the group gets SIGTERM, then SIGKILL when the prompt
// or anything else holds it. The twin's folder is a copy and its Notion a mirror: nothing to protect from a hard stop.
const alive = pid => { try { process.kill(-pid, 0); return true; } catch { return false; } };
const gone = async (pid, ms) => { for (let waited = 0; waited < ms && alive(pid); waited += 100) await new Promise(resolve => setTimeout(resolve, 100)); return !alive(pid); };
export async function killGroup(child, graceMs = 3000) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  if (await gone(child.pid, graceMs)) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone meanwhile */ }
  await gone(child.pid, 5000);
}

// Resolves when nothing listens on any of the ports any more (a new app that binds before this fails: "Address already in use").
export async function portsFree(ports, ms = 10000) {
  const free = port => new Promise(resolve => { const server = net.createServer(); server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => server.close(() => resolve(true))); });
  for (let waited = 0; waited < ms; waited += 250) {
    if ((await Promise.all(ports.map(free))).every(Boolean)) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}
