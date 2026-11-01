// What the evidence folder keeps (owner, 14 Oct 2026: 525 pictures, 360 MB in 5 days, never cleaned; end.png opened 60 times, step pictures 12): end.png of every run;
// step pictures only of a run whose row needs a fix or is a site problem; older folders pruned at the start of a smoke run (the newest of each row always stays). Guard: test/evidence-clean.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {rowStatus} from './applying-status.mjs';
import {stepFilesIn} from './step-shots.mjs';

export const KEEP_DAYS = 30;
// A run's step pictures are kept only when the row ends "needs a fix" or "site problem" (the pool's own status words, site/src/applying-status.js); a row that works or is held on purpose keeps end.png only.
export const keepsSteps = run => ['fix', 'site'].includes(rowStatus(run).state);

// Removes the step pictures of a bundle folder (and of its electron/ leg). -> how many files.
export function dropSteps(folder) {
  let removed = 0;
  for (const where of [folder, path.join(folder, 'electron')]) for (const name of stepFilesIn(where)) { fs.rmSync(path.join(where, name)); removed++; }
  return removed;
}

// The row's status word of a run ('works', 'held', 'site', 'fix', 'unrun'), written beside its evidence so a later cleanup knows whether the row now works.
export const stateOf = run => rowStatus(run).state;
export const STATUS_FILE = 'status.json';

// At the start of a smoke run (owner, 15 Oct 2026: "If we don't fix the issue in 14 days, we lose evidence"): the NEWEST folder of every row is always kept, however old. Any other folder
// goes after KEEP_DAYS days, or earlier when a newer run of the same row exists and that newest run works. Only the evidence folder itself is touched: any other dir is refused.
// -> the folders removed (day/row).
export function removeOldEvidence(dir, now = new Date(), log = console.log) {
  if (path.basename(dir) !== 'evidence') throw new Error(`not an evidence folder: ${dir}`);
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const rows = new Map();   // row folder name -> [{day, folder}] oldest first
  let days = [];
  try { days = fs.readdirSync(dir).filter(name => /^\d{4}-\d\d-\d\d$/.test(name)).sort(); } catch { return []; }
  for (const day of days) for (const row of fs.readdirSync(path.join(dir, day))) {
    const folder = path.join(dir, day, row);
    if (fs.statSync(folder).isDirectory()) rows.set(row, [...(rows.get(row) || []), {day, folder}]);
  }
  const removed = [];
  for (const [row, runs] of rows) {
    const newest = runs.at(-1);
    let works = false;
    try { works = JSON.parse(fs.readFileSync(path.join(newest.folder, STATUS_FILE), 'utf8')).state === 'works'; } catch { /* a run before the status file: not known to work */ }
    for (const run of runs.slice(0, -1)) if (works || run.day < cutoff) { fs.rmSync(run.folder, {recursive: true, force: true}); removed.push(`${run.day}/${row}`); }
  }
  for (const day of days) { try { if (!fs.readdirSync(path.join(dir, day)).length) fs.rmdirSync(path.join(dir, day)); } catch { /* gone */ } }
  log(`evidence: removed ${removed.length} folders (older than ${KEEP_DAYS} days, or replaced by a newer working run; the newest of each row is kept)`);
  return removed;
}
