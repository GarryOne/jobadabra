// The Find jobs card on Jobs, one picture per state on the demo's fictional data: npm run find-card-shots [-- --out <dir>]. Each card alone, then the
// searching state on the whole Jobs screen (the list grows below the card). The states are renderer/find-card-model.js; the model is fed by hand here.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dir = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(os.tmpdir(), 'find-card-shots'));
// The page redraws the card from the demo's own runs now and then (pages/jobs.js, every 2 s): the picture is taken right after the feed, or it shows the demo's run, not this state.
const feed = state => `window.__jp.findCard(${JSON.stringify(state)}); await new Promise(r => setTimeout(r, 120));`;
const SLICE = ['Finding your first jobs…', 'First jobs: reading 15 of 212 employer sites first', 'First jobs: 9 found', 'Scored 1 of 3 job(s)'];
const WIDE = [...SLICE, 'First jobs: 3 scored in 21 s; the full search goes on', 'Time budget: this search stops its AI steps at 3 min 00 s; what is left waits for the next one', '⏳ Reading employer job sites: 120 of 212 · 3,412 jobs listed', 'Run counts: looked=612 matches=14 scored=9 good=3'];
const BIG = [...SLICE, 'Searching job boards…', '⏳ Reading employer job sites: 1953 of 2251 · 131,825 jobs listed · under a minute left', 'Added 9 new job(s): Zurich 9', 'Run counts: looked=135769 matches=31 scored=4 good=2'];   // the owner\'s 19 Oct case, demo numbers
const CASES = [
  ['1-empty-first-run', feed({running: null, runs: [], lastSearchAt: '', listed: 0}), '#find-card'],
  ['2-searching-first-jobs', feed({running: {kind: 'search', log: SLICE}, runs: [], lastSearchAt: ''}), '#find-card'],
  ['3-searching-all-employers', feed({running: {kind: 'search', log: WIDE}, runs: [], lastSearchAt: ''}), '#find-card'],
  ['4-searching-on-the-jobs-screen', feed({running: {kind: 'search', log: WIDE}, runs: [], lastSearchAt: ''}), ''],
  ['6-searching-many-employers', feed({running: {kind: 'search', log: BIG}, runs: [], lastSearchAt: ''}), '#find-card'],
  ['7-done', feed({running: {kind: 'search', log: BIG}, runs: [], lastSearchAt: ''}) + feed({running: null, runs: [{kind: 'search', ok: true, new: 14, log: ['Run counts: looked=135769 matches=31 scored=24 good=6']}], lastSearchAt: '2026-10-19T10:00:00Z', listed: 31}), '#find-card'],
  ['5-failed', feed({running: null, runs: [{kind: 'search', ok: false, problem: 'Claude Code is not answering. Open Settings → Connections → AI.'}], lastSearchAt: '2026-10-16T10:00:00Z', listed: 0}), '#find-card'],
];
fs.mkdirSync(dir, {recursive: true});
spawnSync('node', ['scripts/stage.mjs'], {cwd: desktop, stdio: 'ignore'});
for (const [name, js, select] of CASES) {
  const out = path.join(dir, `${name}.png`);
  fs.rmSync(out, {force: true});
  spawnSync('node', ['scripts/shot.mjs', 'jobs', '--js', js, ...(select ? ['--select', select] : []), '--out', out], {cwd: desktop, stdio: 'ignore'});
  console.log(`${fs.existsSync(out) ? 'ok  ' : 'FAIL'} ${out}`);
}
