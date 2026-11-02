// Prints {changed data file: [code files that read it at run time]} as JSON, for tools/affected-tests.py (reuses desktop/e2e/lib/data-reads.mjs, the after-merge picker's rule).
// Why (2 Nov 2026, betas 16 and 17; owner chose "e2e + integration"): a change to docs/notion-profile-template.md picked no test, though desktop/lib/strategy.js reads it into the wizard's AI ask.
//   node tools/data-readers.mjs <changed file>...   (a code file or a file no code names gives no entry)
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDataFile, READER_DIRS, readHunks} from '../desktop/e2e/lib/data-reads.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = {};
for (const file of process.argv.slice(2).filter(isDataFile)) {
  let found = '';
  try { found = execFileSync('git', ['grep', '-n', '-F', '-e', path.posix.basename(file), '--', ...READER_DIRS], {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}); }
  catch (error) { if (error.status !== 1) throw error; }   // git grep exits 1 when no line names the file
  const readers = Object.keys(readHunks(found, file)).sort();
  if (readers.length) out[file] = readers;
}
process.stdout.write(JSON.stringify(out));
