// A suite's own "I ended" marker: the process that ran it writes done.txt in the artifacts folder, and the process that started it under the heavy lock refuses an exit 0 without one. Guarded by test/suite-done.test.mjs.
// Why (12 Oct 2026): on Windows the lock's Python launcher ended at once with 0, the CI step went green in 10 s while the suite ran on and failed unseen. Silence is not success.
import fs from 'node:fs';
import path from 'node:path';

const fileOf = (env = process.env) => (env.E2E_ARTIFACTS ? path.join(path.resolve(env.E2E_ARTIFACTS), 'done.txt') : '');

// Before the run starts, in the outer process: an old marker (same folder, an earlier run) must not vouch for this one.
export function clearDone(env = process.env) { const file = fileOf(env); if (file) try { fs.rmSync(file, {force: true}); } catch { /* nothing to clear */ } }

// The process that ran the suite, just before it exits with `code`.
export function markDone(code, env = process.env) { const file = fileOf(env); if (file) try { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, String(code)); } catch { /* the outer check then says so */ } }

// The outer process, with the status the lock returned: a 0 with no marker is a run that never finished.
export function verdict(status, env = process.env, log = console.log) {
  const file = fileOf(env);
  if (status !== 0 || !file || fs.existsSync(file)) return status;
  log(`✗ the suite returned 0 but left no ${path.basename(file)} in ${path.dirname(file)}: it did not finish (the lock gave back its exit code before the suite ended)`);
  return 1;
}
