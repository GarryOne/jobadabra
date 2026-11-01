// The replay ratchet (owner, 15 Oct 2026: "~40 fixes and still some old replays don't work anymore"): replay-faithful.json pins every row that was proven same as live, per
// place (mac, runner) with the commit it was proven on. The gate's baseline is that file, not the last green run, so a lost row can never leave the counted set on its own.
// The tool only RAISES the file (pin); a row leaves it only in a PR that names it in a Replay-accept line. Pure parts here; guard: e2e/test/replay/replay-ratchet.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {platformOf} from './platform.mjs';

export const FILE = new URL('../replay-faithful.json', import.meta.url);

// A row's KIND of form (what a PR picks one row of, replay-pick.mjs): the pool's platform of the host the FORM was on (the extension's own log: "fill: filling {host}"), else of the row's
// start address; a site on no known platform is its own kind (its name). Kept in the pinned file per row, so the pick never guesses from a start address (a company site that embeds
// another platform's form starts on its own host: 15 Oct 2026, coreweave and Databricks start on their own pages and fill a Greenhouse form).
export const formHostOf = log => (String(log).match(/fill: filling \{"host":"([^"]+)"/) || String(log).match(/details for ([^\s:]+)/) || [])[1] || '';
export const kindFor = ({formHost = '', startHost = '', name}) => { for (const host of [formHost, startHost]) { const platform = host ? platformOf(host) : 'Custom'; if (platform !== 'Custom') return platform; } return name; };
export const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);   // replay-records.mjs's folder name for a row
// The pool's rows by name -> their start host (desktop/e2e/smoke-sites.json: the first address of the row's shape).
export function startHosts(file = new URL('../smoke-sites.json', import.meta.url)) {
  let shapes = []; try { shapes = JSON.parse(fs.readFileSync(file, 'utf8')).shapes || []; } catch { /* no pool file */ }
  return new Map(shapes.flatMap(item => { try { return [[item.shape, new URL(item.urls[0]).host]]; } catch { return []; } }));
}
export const PLACES = ['mac', 'runner', 'linux'];   // runner: the macOS CI runner; linux: the Linux runner the PR gate moved to (1e, 15 Oct 2026)

export const load = (file = FILE) => { try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return data && typeof data.rows === 'object' ? data : {rows: {}}; } catch { return {rows: {}}; } };

// The rows the gate holds to "same as live": those pinned on a CI runner (macOS or Linux: the places the PR gate and the scheduled run replay on). The Mac place is a record, not held.
export const pinned = (data = load()) => Object.keys(data.rows || {}).filter(name => data.rows[name]?.runner === true || data.rows[name]?.linux === true).sort();

// (a results.json of a run: {rows: {name: {same, deferred}}}, the file, {place, commit, at}) -> a new file with every row that was same as live in the run set true for that place.
// Never lowers (a row not same stays as it was), never pins a deferred row.
export function pin(results, data = {rows: {}}, {place = 'runner', commit = '', at = new Date().toISOString(), starts = new Map()} = {}) {
  if (!PLACES.includes(place)) throw new Error(`place must be one of ${PLACES.join(', ')}`);
  const rows = {...(data.rows || {})};
  for (const [name, row] of Object.entries(results?.rows || {})) {
    if (row?.same !== true || row.deferred || /^deferred/.test(row.why || '')) continue;   // a results.json row says a deferred row in its why (replay-gate.mjs), a step-4 record in its deferred
    const old = rows[name] || {mac: null, runner: null};
    const kind = kindFor({formHost: row.formHost, startHost: starts.get(name), name});
    rows[name] = {...old, kind: row.formHost || !old.kind ? kind : old.kind, [place]: true, [`${place}Commit`]: old[place] === true ? old[`${place}Commit`] || commit : commit, [`${place}At`]: old[place] === true ? old[`${place}At`] || at : at};
  }
  return {rows: Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)))};
}

// Rows pinned in the base's file and missing (or not true on the runner) in this PR's file: a pin lowered. Each needs a Replay-accept line naming it.
export const lowered = (base, now) => pinned(base).filter(name => !pinned(now).includes(name));

// Rows same as live in this run and not pinned yet: the gate says "ratchet up".
export const newlyFaithful = (results, data) => Object.entries(results?.rows || {}).filter(([name, row]) => row?.same === true && !row.deferred && !pinned(data).includes(name)).map(([name]) => name).sort();

// (the file, a folder of replays <slug>/app.log, the pool's start hosts) -> the file with every pinned row's kind set from the host its form was on.
export function withKinds(data, logsDir = '', starts = new Map()) {
  const rows = Object.fromEntries(Object.entries(data.rows || {}).map(([name, row]) => {
    let log = ''; try { log = fs.readFileSync(path.join(logsDir, slugOf(name), 'app.log'), 'utf8'); } catch { /* no log for this row */ }
    return [name, {...row, kind: kindFor({formHost: formHostOf(log), startHost: starts.get(name), name})}];
  }));
  return {rows};
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [command, resultsFile, ...rest] = process.argv.slice(2), arg = flag => { const at = rest.indexOf(flag); return at >= 0 ? rest[at + 1] : ''; };
  if (command === 'kinds') {   // node lib/replay-ratchet.mjs kinds <a replay-offline-<run> folder of <slug>/app.log> [--file <replay-faithful.json>]
    const file = arg('--file') || FILE, after = withKinds(load(file), resultsFile || '', startHosts());
    fs.writeFileSync(file, `${JSON.stringify(after, null, 1)}\n`);
    console.log(`replay-ratchet: kinds set: ${[...new Set(Object.values(after.rows).map(row => row.kind))].length} kinds over ${Object.keys(after.rows).length} rows`);
    process.exit(0);
  }
  if (command !== 'pin' || !resultsFile) { console.error('usage: node lib/replay-ratchet.mjs pin <results.json> --commit <sha> [--place runner|linux|mac] [--file <replay-faithful.json>]'); process.exit(2); }
  const file = arg('--file') || FILE, before = load(file), results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  const after = pin(results, before, {place: arg('--place') || 'runner', commit: arg('--commit') || results.sha?.slice(0, 7) || '', starts: startHosts()});
  fs.writeFileSync(file, `${JSON.stringify(after, null, 1)}\n`);
  const added = Object.keys(after.rows).filter(name => !before.rows[name] || PLACES.some(place => before.rows[name][place] !== after.rows[name][place]));
  console.log(`replay-ratchet: ${pinned(after).length} rows pinned on the runner (${added.length} new this time${added.length ? `: ${added.join(', ')}` : ''})`);
}
