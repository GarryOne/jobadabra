// Writes a file only this user can read (0600), also when it already exists: Node's {mode} applies only to a NEW file, so a secrets file made earlier stayed 0644
// (13 Oct 2026: the test app's job-site passwords were readable by every account on the computer). Every private write goes through here; guard: test/private-file.test.js.
import fs from 'node:fs';

let written = 0;
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Windows refuses a rename over a file another process holds open for a moment (an antivirus scan, a reader): EPERM/EBUSY/EACCES. Try again briefly.
function renameOver(from, to) {
  for (let tries = 0; ; tries++) {
    try { return fs.renameSync(from, to); } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || tries >= 10) throw error;
      pause(20);
    }
  }
}

// Why (27 Oct 2026, e2e red on #2266): writeFileSync empties the file before it writes, so a reader at that moment (the engine, a test) found an empty
// settings.json, and an app killed mid-save left one. The data goes to a temp file in the same folder (same volume), is flushed, then renamed over it.
/**
 * Writes `data` to `file`, readable only by this user (0600), whole or not at all: a reader sees the old content or the new, never a part.
 * @param {string} file  @param {string|Buffer} data
 * @throws the write or rename error; the temp file is removed and `file` keeps its old content
 */
export function writePrivate(file, data) {
  const temp = `${file}.${process.pid}-${++written}.tmp`;
  try {
    const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.chmodSync(temp, 0o600);
    renameOver(temp, file);
  } catch (error) {
    fs.rmSync(temp, {force: true});
    throw error;
  }
}
