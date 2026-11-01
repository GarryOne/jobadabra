// Replays each journey of journeys.json from the newest record of its row and judges the card and the panel at every step (journey.mjs): the PR check for flow changes.
//   node journey-run.mjs <records dir> <out dir> [--only=<row name>] [--watch]     --watch: the pool's daily watch rows instead of journeys.json (watch-live.yml). exit 1 when a journey fails or has no record. Guard: e2e/test/replay/journey-run.test.mjs.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {newestPerRow} from './replay-records.mjs';
import {watchRows} from './lib/watch-list.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const journeyRows = (file = path.join(here, 'journeys.json')) => JSON.parse(fs.readFileSync(file, 'utf8')).rows;
// rows: journeys.json rows; found: newestPerRow's [{name, dir}] -> [{row, why, dir}] and the rows with no record
export function plan(rows, found, only = '', platform = process.platform) {
  const wanted = rows.filter(one => (!only || one.row === only) && !one.pending), skipped = wanted.filter(one => one.macOnly && platform !== 'darwin'), picked = wanted.filter(one => !skipped.includes(one));
  return {skipped, pending: rows.filter(one => one.pending && (!only || one.row === only)), run: picked.flatMap(one => { const hit = found.find(row => row.name === one.row); return hit ? [{...one, dir: hit.dir}] : []; }),
    missing: picked.filter(one => !found.some(row => row.name === one.row)).map(one => one.row)};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [recordsDir, out] = process.argv.slice(2), only = (process.argv.find(arg => arg.startsWith('--only=')) || '').slice(7);
  if (!recordsDir || !out) { console.error('usage: node journey-run.mjs <records dir> <out dir> [--only=<row>]'); process.exit(2); }
  const rows = process.argv.includes('--watch') ? watchRows(JSON.parse(fs.readFileSync(path.join(here, 'smoke-sites.json'), 'utf8')).shapes).map(row => ({row: row.shape, why: 'daily watch row'})) : journeyRows();
  const {run, missing, pending, skipped} = plan(rows, newestPerRow(recordsDir), only);
  let failed = missing.length;
  for (const one of skipped) console.log(`journey-run: SKIPPED ${one.row} on this computer: ${one.macOnly}`);
  for (const one of pending) console.log(`journey-run: PENDING ${one.row}: ${one.pending}`);   // said every run, never silent
  for (const row of missing) console.log(`journey-run: FAIL ${row}: no record of this row (a journey with nothing to replay is red, never skipped)`);
  for (const one of run) {
    const slug = one.row.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    console.log(`journey-run: ${one.row} (${one.why})`);
    const ran = spawnSync(process.execPath, [path.join(here, 'journey.mjs'), one.dir, path.join(out, slug)], {stdio: 'inherit'});
    if (ran.status !== 0) { failed++; console.log(`journey-run: FAIL ${one.row} (exit ${ran.status})`); }
  }
  console.log(`journey-run: ${failed ? `${failed} FAILED` : 'all passed'} of ${run.length + missing.length}`);
  process.exit(failed ? 1 : 0);
}
