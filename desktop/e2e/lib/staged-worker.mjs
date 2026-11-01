// A live or smoke run uses desktop/shared/app-core, a copy of app-core/src that `node scripts/stage.mjs` makes: after a worker edit a stale copy ran the OLD prompt (11 Oct 2026).
// Job: run the backbone
// ensureStagedWorker compares the two folders and re-stages when they differ (one line says so); staging that does not fix it throws. Guard: test/staged-worker.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = dir => Object.fromEntries(fs.readdirSync(dir, {recursive: true, withFileTypes: true}).filter(item => item.isFile() && !/__pycache__|node_modules|\.DS_Store/.test(item.parentPath))
  .map(item => { const file = path.join(item.parentPath, item.name); return [path.relative(dir, file), fs.readFileSync(file, 'utf8')]; }));

// The files (relative names) that differ, are missing or are extra in the staged copy.
export function stagedWorkerDiffers(src, staged) {
  const from = read(src), to = fs.existsSync(staged) ? read(staged) : {};
  return [...new Set([...Object.keys(from), ...Object.keys(to)])].filter(name => from[name] !== to[name]).sort();
}

/**
 * Re-stages desktop/shared/app-core when it differs from app-core/src; returns true when it had to. Takes `src`, `staged`, `stage` and `say` (all injectable for tests);
 * throws when staging does not make the two folders equal. Reads only the two folders.
 */
export function ensureStagedWorker({src = path.join(desktop, '..', 'app-core', 'src'), staged = path.join(desktop, 'shared', 'app-core'),
  stage = () => execFileSync(process.execPath, [path.join(desktop, 'scripts', 'stage.mjs')], {cwd: desktop, stdio: 'ignore'}), say = line => console.log(line)} = {}) {
  const stale = stagedWorkerDiffers(src, staged);
  if (!stale.length) return false;
  say(`staged worker was stale (${stale.slice(0, 5).join(', ')}): re-staged before the run`);
  stage();
  const still = stagedWorkerDiffers(src, staged);
  if (still.length) throw new Error(`desktop/shared/app-core still differs from app-core/src after staging: ${still.slice(0, 5).join(', ')}`);
  return true;
}
