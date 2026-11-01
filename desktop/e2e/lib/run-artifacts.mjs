// A folder of its own for each run's artifacts and a safe way to save a shared memo, so two runs at once never write the same files (lib/app.mjs ARTIFACTS is per SUITE,
// and every pool run is the applyflows suite). Guarded by test/run-artifacts.test.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const runArtifacts = (base = os.tmpdir()) => fs.mkdtempSync(path.join(base, 'jp-run-artifacts-'));

// Write a file so a reader never sees half of it and a second writer never corrupts it: a temp file of our own, then a rename.
export function writeAtomic(file, text) {
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}
