// The helper that moves a Microsoft Store user's data out of the package's private cache into the real data folder, while the app is not running (run by lib/store-data-copy.js as a node script
// through ELECTRON_RUN_AS_NODE):  node store-data-copy-helper.mjs <app pid> <from folder> <to folder> <exe> [exe args...]
// It waits for the app to exit, copies the folder (never deletes anything in <from>), writes the marker, and starts the app again.
// Why (31 Oct 2026, owner: "Build the copy"): Chromium's `Local State` holds the key that unseals the saved tokens (secrets.json), and a running app has already loaded its own and rewrites it on exit.
// A copy made inside the running app would be overwritten by the app's own fresh copy, so the data would come over but its secrets would not open. Hence: exit first, copy, restart.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const MARKER = 'store-cache-copy.json';
const SKIP = new Set(['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']);   // held by a running Chromium, never data

/** The copy's state in <folder>: {state: 'started' | 'done' | 'failed', tries, ...} or {} when none. */
export function readMarker(folder) {
  try { return JSON.parse(fs.readFileSync(path.join(folder, MARKER), 'utf8')); } catch { return {}; }
}
/** Writes the marker whole (temp file, then rename), so a crash never leaves half of it. */
export function writeMarker(folder, value) {
  fs.mkdirSync(folder, {recursive: true});
  const file = path.join(folder, MARKER), temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value));
  fs.renameSync(temp, file);
}

/**
 * Copies every file under <from> to <to> (overwriting what is there: the target holds no data of a person, only what a start made by itself), each through a temp file and a rename.
 * Returns {files, failed: [{file, error}]}. Never writes to <from>.
 */
export function copyFolder(from, to) {
  const result = {files: 0, failed: []};
  const walk = (source, target) => {
    fs.mkdirSync(target, {recursive: true});
    for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
      if (SKIP.has(entry.name)) continue;
      const src = path.join(source, entry.name), dest = path.join(target, entry.name);
      if (entry.isDirectory()) { walk(src, dest); continue; }
      if (!entry.isFile()) continue;
      const temp = `${dest}.copying`;
      try { fs.copyFileSync(src, temp); fs.renameSync(temp, dest); result.files++; } catch (error) { result.failed.push({file: path.relative(from, src), error: error.code || error.message}); try { fs.rmSync(temp, {force: true}); } catch { /* the temp file is only ours */ } }
    }
  };
  walk(from, to);
  return result;
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
async function waitForExit(pid, {limitMs = 30000, settleMs = 1500} = {}) {
  const until = Date.now() + limitMs;
  while (alive(pid) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 200));
  if (alive(pid)) return false;
  await new Promise(resolve => setTimeout(resolve, settleMs));   // the app's child processes close their files a moment after it
  return true;
}

/** The whole job: wait, copy, mark, restart. Takes [pid, from, to, exe, ...exeArgs]; returns the copy's result. */
export async function run([pid, from, to, exe, ...exeArgs], {settleMs, limitMs} = {}) {
  // Why (31 Oct 2026, code review): a copy under a running app is clobbered by it (`Local State` is rewritten), so an app that does not exit within the limit gets no copy and no restart; the marker stays 'started' and the next start tries again.
  if (!await waitForExit(Number(pid), {settleMs, limitMs})) return {files: 0, failed: [{file: '.', error: 'app-still-running'}], skipped: true};
  const before = readMarker(to);
  let result;
  try { result = copyFolder(from, to); } catch (error) { result = {files: 0, failed: [{file: '.', error: error.code || error.message}]}; }
  writeMarker(to, {...before, state: result.failed.length ? 'failed' : 'done', files: result.files, failed: result.failed.slice(0, 5), at: new Date().toISOString()});
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  spawn(exe, exeArgs, {detached: true, stdio: 'ignore', env}).unref();
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) run(process.argv.slice(2)).then(() => process.exit(0), () => process.exit(1));
