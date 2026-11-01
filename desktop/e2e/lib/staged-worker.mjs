// A live or smoke run uses desktop/shared/worker, a copy of worker/src that `node scripts/stage.mjs` makes: after a worker edit a stale copy ran the OLD prompt (11 Oct 2026).
// ensureStagedWorker compares the two folders and re-stages when they differ (one line says so); staging that does not fix it throws. Guard: test/harness/staged-worker.test.mjs.
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

export function ensureStagedWorker({src = path.join(desktop, '..', 'worker', 'src'), staged = path.join(desktop, 'shared', 'worker'),
  stage = () => execFileSync(process.execPath, [path.join(desktop, 'scripts', 'stage.mjs')], {cwd: desktop, stdio: 'ignore'}), say = line => console.log(line)} = {}) {
  const stale = stagedWorkerDiffers(src, staged);
  if (!stale.length) return false;
  say(`staged worker was stale (${stale.slice(0, 5).join(', ')}): re-staged before the run`);
  stage();
  const still = stagedWorkerDiffers(src, staged);
  if (still.length) throw new Error(`desktop/shared/worker still differs from worker/src after staging: ${still.slice(0, 5).join(', ')}`);
  return true;
}
