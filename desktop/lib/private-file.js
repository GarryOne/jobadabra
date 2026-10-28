// Writes a file only this user can read (0600), also when it already exists: Node's {mode} applies only to a NEW file, so a secrets file made earlier stayed 0644
// (13 Oct 2026: the test app's job-site passwords were readable by every account on the computer). Every private write goes through here; guard: test/private-file.test.js.
import fs from 'node:fs';
import path from 'node:path';


// Design: (28 Oct 2026, owner: "Save shortly after"; #2351's Windows desktop job, EPERM after 1509 ms with the file held 1500 ms)
// States of one file's save, in the owner's words: saved / waiting for the file / could not save. ONE owner: this module (a caller never retries).
//   saved --(Windows holds the file past the brief retry)--> waiting --(file free: rename done)--> saved
//   waiting --(newer save of the same file)--> waiting with the newest value (an older one is never written after a newer one)
//   waiting --(held longer than timing.giveUpMs)--> could not save: onChange tells the person, whose Retry calls retryPrivate(file)
//   app quits while waiting --> flushPending(): one last try; what still fails is returned so the app reports it, never dropped silently
// While waiting the NEWEST value lives in memory and the file keeps its old whole content; no temp file is left (each failed try removes its own).
export const timing = {briefTries: 10, briefPauseMs: 20, retryMs: 250, giveUpMs: 10000};
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let written = 0;
const waiting = new Map();   // file -> {data, since, timer, failed}
const listeners = new Set();
/** Tells `listener({file, state})` when a file is 'waiting', 'saved' after waiting, or 'failed' (could not save). Returns the way to stop listening. */
export function onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
const tell = (file, state) => { for (const listener of listeners) { try { listener({file, state}); } catch { /* a listener never stops a save */ } } };

// Windows refuses a rename over a file another process holds open for a moment (an antivirus scan, the engine reading): EPERM/EBUSY/EACCES.
const isHeld = error => process.platform === 'win32' && ['EPERM', 'EBUSY', 'EACCES'].includes(error.code);

// One whole attempt: temp file, flush, rename. Returns true when saved, false when the file is held; any other error throws. The temp file never outlives the attempt.
function attempt(file, data, briefTries) {
  const temp = `${file}.${process.pid}-${++written}${TEMP_END}`;
  try {
    const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.chmodSync(temp, 0o600);
    for (let tries = 1; ; tries++) {
      try { fs.renameSync(temp, file); return true; } catch (error) {
        if (!isHeld(error)) throw error;
        if (tries >= briefTries) { fs.rmSync(temp, {force: true}); return false; }
        pause(timing.briefPauseMs);
      }
    }
  } catch (error) {
    fs.rmSync(temp, {force: true});
    throw error;
  }
}

function settle(file, entry) {
  clearTimeout(entry.timer);
  waiting.delete(file);
  tell(file, 'saved');
}
function schedule(file, entry) {
  entry.timer = setTimeout(() => {
    try {
      if (attempt(file, entry.data, 1)) return settle(file, entry);
    } catch { entry.failed = true; return tell(file, 'failed'); }   // a different error than a held file: the person is told, Retry tries again
    if (Date.now() - entry.since >= timing.giveUpMs) { entry.failed = true; return tell(file, 'failed'); }
    schedule(file, entry);
  }, timing.retryMs);
  entry.timer.unref?.();
}

/** The Retry of "could not save": starts the wait again for the newest value. @returns {boolean} false when nothing is waiting for `file` */
export function retryPrivate(file) {
  const entry = waiting.get(file);
  if (!entry) return false;
  entry.failed = false; entry.since = Date.now();
  tell(file, 'waiting');
  schedule(file, entry);
  return true;
}

/** At quit: one last try for every waiting file. @returns {string[]} the files that still could not be saved (the app reports them) */
export function flushPending() {
  const left = [];
  for (const [file, entry] of [...waiting]) {
    clearTimeout(entry.timer);
    let saved = false;
    try { saved = attempt(file, entry.data, timing.briefTries); } catch { /* reported below */ }
    if (saved) settle(file, entry); else left.push(file);
  }
  return left;
}

// Why (#2279, gitar-bot): a save killed before its rename leaves the private content in a temp file; the ending lets the export leave it out (reset.js)
// and the next save of the same file removes it once its process is gone.
export const TEMP_END = '.private-tmp';
function sweepLeftovers(file) {
  const dir = path.dirname(file), start = `${path.basename(file)}.`;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    const pid = name.startsWith(start) && name.endsWith(TEMP_END) ? Number(name.slice(start.length).split('-')[0]) : 0;
    if (!pid || pid === process.pid || alive(pid)) continue;
    try { fs.rmSync(path.join(dir, name), {force: true}); } catch { /* a locked leftover (Windows) never stops the save; the next save tries again */ }
  }
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

// Why (27 Oct 2026, e2e red on #2266): writeFileSync empties the file before it writes, so a reader at that moment (the engine, a test) found an empty
// settings.json, and an app killed mid-save left one. The data goes to a temp file in the same folder (same volume), is flushed, then renamed over it.
/**
 * Writes `data` to `file`, readable only by this user (0600), whole or not at all: a reader sees the old content or the new, never a part.
 * When Windows holds `file` past the brief retry the save is kept and finished shortly after (see Design above); a later reader may still see the old content meanwhile.
 * @param {string} file  @param {string|Buffer} data
 * @returns {'saved'|'waiting'}
 * @throws any write error other than a held file; the temp file is removed and `file` keeps its old content
 */
export function writePrivate(file, data) {
  sweepLeftovers(file);
  const before = waiting.get(file);
  if (before) clearTimeout(before.timer);
  if (attempt(file, data, timing.briefTries)) {
    if (before) settle(file, before);
    return 'saved';
  }
  const entry = {data, since: before?.since ?? Date.now(), timer: null, failed: false};
  waiting.set(file, entry);
  tell(file, 'waiting');
  schedule(file, entry);
  return 'waiting';
}
