// Runs tar without blocking the app (Settings → Move your data, the automatic backup): the window keeps drawing while a big data folder is packed or unpacked,
// and a caller gets {done, total} to show. Export counts the entries tar lists as it goes against the entries counted first; import counts the bytes
// of the file fed to tar against the file's size. Replaces the blocking tar call in lib/reset.js (21 Oct 2026: the whole app froze, beachball, for the length of an export).
// Guards: desktop/test/archive.test.js (no *Sync tar call in the main process, progress, cancel, the event loop answers during a pack).
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {tar} from './tar.js';

const EVERY_MS = 120;   // progress is told at most this often
export const CANCELLED = 'cancelled';
const KILL_AFTER_MS = 3000;   // a tar that ignored the polite stop is killed hard after this
const live = new Set();       // tar children running now: none may outlive the app (it would keep the data folder open, Windows)

// Starts tar tracked, and stopped (politely, then hard) when `signal` fires.
function startTar(args, stdio, signal) {
  const child = spawn(tar(), args, {stdio});
  live.add(child);
  child.on('close', () => live.delete(child));
  const stop = () => { child.kill(); setTimeout(() => { if (live.has(child)) child.kill('SIGKILL'); }, KILL_AFTER_MS).unref(); };
  signal?.addEventListener('abort', stop, {once: true});
  if (signal?.aborted) stop();
  return child;
}
// How many tar children are alive, and a last resort that kills them all at once (the app is exiting).
export const liveTars = () => live.size;
export const killAllTars = () => { for (const child of live) child.kill('SIGKILL'); };
process.on('exit', killAllTars);

// -> how many entries (files and folders) `names` hold under dir, not counting what `skip` (tar --exclude patterns, only "*.lock" and exact relative paths) leaves out
export async function countEntries(dir, names, skip = [], signal) {
  const left = rel => skip.some(rule => (rule.startsWith('*') ? rel.endsWith(rule.slice(1)) : rel === rule));
  let count = 0;
  const walk = async rel => {
    if (signal?.aborted || left(rel.split(path.sep).join('/'))) return;
    count++;
    let kids;
    try { kids = await fs.promises.readdir(path.join(dir, rel), {withFileTypes: true}); } catch { return; }   // a file, or gone since
    for (const kid of kids) if (kid.isDirectory()) await walk(path.join(rel, kid.name)); else if (!left(path.join(rel, kid.name).split(path.sep).join('/'))) count++;
  };
  for (const name of names) await walk(name);
  return count;
}

function throttled(onProgress) {
  let last = 0;
  return (done, total, force = false) => {
    const now = Date.now();
    if (!force && now - last < EVERY_MS) return;
    last = now;
    onProgress?.({done, total});
  };
}

// GNU tar exits 1, not 0, when a file changed while it was read ("file changed as we read it": the app's own log or database moved on during a backup of its live data folder),
// and still writes the whole archive: that is a finished backup, not a failure (the settings suite, main's 21:47 run on 25 Oct 2026: a backup due at start failed on it). Any other code fails.
export const tarFinished = (code, tail = '') => code === 0 || (code === 1 && /file changed as we read it/i.test(tail) && !/(?:cannot|can't|error|fatal)/i.test(String(tail).replace(/file changed as we read it/gi, '')));

// Waits for the child; rejects with tar's own last words when it fails, or CANCELLED when `signal` fired.
function finish(child, signal, label, {tolerateChange = false} = {}) {
  return new Promise((resolve, reject) => {
    let tail = '';
    const keep = chunk => { tail = (tail + chunk).slice(-400); };
    child.stderr.on('data', keep);
    child.on('error', reject);
    child.on('close', code => {
      if (signal?.aborted) reject(Object.assign(new Error(CANCELLED), {code: CANCELLED}));
      else if (tolerateChange ? tarFinished(code, tail) : code === 0) resolve();
      else reject(new Error(`${label} failed (${code}): ${tail.trim().split('\n').pop()}`));
    });
  });
}

// Packs `names` (relative to dir) into the .tar.gz `file`. Removes a half-written file when it fails or is cancelled.
export async function pack(dir, file, {names, excludes = [], onProgress, signal} = {}) {
  const tell = throttled(onProgress);
  tell(0, null, true);
  const total = await countEntries(dir, names, excludes, signal);
  let done = 0;
  const child = startTar(['-czvf', file, ...excludes.map(pattern => `--exclude=${pattern}`), '-C', dir, ...names], ['ignore', 'pipe', 'pipe'], signal);
  const count = chunk => { done += String(chunk).split('\n').length - 1; tell(Math.min(done, total), total); };
  child.stdout.on('data', count);   // GNU tar lists the entries on stdout, bsdtar on stderr
  child.stderr.on('data', count);
  try { await finish(child, signal, 'tar', {tolerateChange: true}); } catch (error) { fs.rmSync(file, {force: true}); throw error; }
  tell(total, total, true);
}

// Unpacks the .tar.gz `file` into the (existing) folder `into`, feeding tar through a stream so the bytes read are the progress.
export async function unpack(file, into, {onProgress, signal} = {}) {
  const tell = throttled(onProgress);
  const total = fs.statSync(file).size;
  tell(0, total, true);
  let done = 0;
  const child = startTar(['-xzf', '-', '-C', into], ['pipe', 'ignore', 'pipe'], signal);
  const source = fs.createReadStream(file);
  source.on('data', chunk => { done += chunk.length; tell(done, total); });
  source.on('error', () => child.kill());
  child.stdin.on('error', () => {});   // tar stopped early (a bad file): its exit code says so
  source.pipe(child.stdin);
  await finish(child, signal, 'tar');
  tell(total, total, true);
}
