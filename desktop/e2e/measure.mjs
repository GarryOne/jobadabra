// Job: report health
// npm run measure -- [--days N] [--every] [--root <captures>] [--old <extension dir>] [--compare] [--out <dir>]: the pool's numbers for THIS build, offline, on the
// captures library (lib/capture-library.mjs): each row's newest capture of the last N days (default 1) replayed by lib/row-replay.mjs (unchanged), read as a live row is
// (lib/measure.mjs: parseLive, the ending, the shadow / acted / person tables). Nothing reaches a site, no site limit is used, $0: the kept answers only (memo); an ask the capture
// never made is a miss, and a row with any miss is NOT MEASURED, the step and the differing part named (a prompt change shows at once) (an --ask through the plan's claude -p, capped, is a later step of the spec).
// --compare: the captures' own live numbers, in their own table. Every line is labelled offline (memo|plan) and "unverified" until the positive control passed (spec PR 3).
// A fix is confirmed OFFLINE on a recording (the Fixed tab's "Confirmed offline"), never by a live run: these numbers decide what to try. Spec docs/superpowers/specs/2026-10-13-capture-once-measure-many.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {capturesRoot} from './lib/capture-library.mjs';
import {capturesOf, measuredRow, offlineLabel, settingsOf, tableLines, tablesOf, unreplayedRow} from './lib/measure.mjs';
import {replayRows, staleCapture} from './lib/row-replay.mjs';
import {slug} from './lib/replay-candidate.mjs';

const args = process.argv.slice(2), flag = name => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : ''; }, has = name => args.includes(`--${name}`);
const root = path.resolve(flag('root') || capturesRoot());
const dirs = capturesOf(root, {days: Number(flag('days')) || 1, every: has('every')});
const stale = dirs.filter(dir => staleCapture(dir));
for (const dir of stale) console.log(`measure: ${path.basename(dir)}: STALE, not measured: ${staleCapture(dir)}`);
const todo = dirs.filter(dir => !stale.includes(dir));
if (!todo.length) { console.error(`measure: no capture to measure in ${root} (npm run captures -- pull, or a live row first)`); process.exit(2); }
const label = offlineLabel();
console.log(`measure: ${todo.length} captures, ${label}; nothing reaches a site`);
const started = Date.now();
// Each capture replays with the run settings it was made with (lib/capture-library.mjs RUN_SETTINGS: the applicant, the model): a group per setting set, its env set for that
// group's offline app; a capture missing one is not measured, never replayed with a guess. One row at a time: side by side, a row's log keeps only the lines naming its host
// (lib/row-replay.mjs `mine`) and the app's own miss lines name none: a missed answer ask went uncounted (13 Oct 2026 positive control: Personio 2 misses alone, 0 side by side).
const byDir = new Map(), groups = new Map();
for (const dir of todo) {
  const {env, why} = settingsOf(JSON.parse(fs.readFileSync(path.join(dir, 'capture.json'), 'utf8')));
  if (why) { byDir.set(dir, unreplayedRow(dir, why)); continue; }
  const key = JSON.stringify(env);
  groups.set(key, [...(groups.get(key) || []), dir]);
}
for (const [key, dirs] of groups) {
  const env = JSON.parse(key), before = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(env)) { if (value) process.env[name] = value; else delete process.env[name]; }
  console.log(`measure: ${dirs.length} capture${dirs.length > 1 ? 's' : ''} as ${Object.entries(env).map(([name, value]) => `${name}=${value || '(default)'}`).join(' ')}`);
  try {
    const results = await replayRows(dirs, {extensionDir: flag('old') ? path.resolve(flag('old')) : undefined, tabs: 1});
    dirs.forEach((dir, at) => byDir.set(dir, measuredRow(dir, results[at])));
  } finally { for (const [name, value] of Object.entries(before)) { if (value == null) delete process.env[name]; else process.env[name] = value; } }
}
const rows = todo.map(dir => byDir.get(dir));
for (const row of rows) if (row.offline) console.log(`[${label}] ${row.row}: ${row.offline.misses ? `${row.offline.misses} asks with no kept answer` : 'every ask had its kept answer'}${row.offline.divergence ? `, diverged: ${row.offline.divergence}` : ''}${row.offline.unrecorded.length ? `, ${row.offline.unrecorded.length} addresses not recorded` : ''}`);
for (const line of tableLines(tablesOf(rows, 'offline'), label)) console.log(line);
if (has('compare')) {   // the positive control's other side: the captures' own app logs, read the same way, in their own table
  const builds = [...new Set(rows.map(row => `${String(row.build.commit || '?').slice(0, 9)} (ext ${row.build.extension || '?'})`))];
  for (const line of tableLines(tablesOf(rows, 'live'), `live, captured on ${builds.join(', ')}`)) console.log(line);
}
// Emit the live pool report shape (<day>.json + <day>-<row>.app.log); its logs can be analyzed with lib/pool-shadow.mjs and lib/pool-acted.mjs.
const out = path.resolve(flag('out') || fs.mkdtempSync(path.join(os.tmpdir(), 'jp-measure-')));
const day = new Date().toISOString().slice(0, 10), report = {label, results: {}};
fs.mkdirSync(out, {recursive: true});
for (const row of rows.filter(one => one.measured)) {
  report.results[row.row] = {...row.offline.result, ending: row.offline.ending, offline: label};
  fs.writeFileSync(path.join(out, `${day}-${slug(row.row)}.app.log`), row.offline.log);
}
fs.writeFileSync(path.join(out, `${day}.json`), `${JSON.stringify(report, null, 1)}\n`);
console.log(`measure: ${rows.filter(row => row.measured).length} of ${rows.length} rows measured in ${Math.round((Date.now() - started) / 1000)} s; ${label}; report in ${out}`);
