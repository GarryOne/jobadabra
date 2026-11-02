// Scans tracked files for the old product name (job-pilotto in every spelling) and classifies each hit with tools/rename-map.json; shared by rename-inventory.mjs and rename-apply.mjs.
// Invariant: a hit is one token (letters, digits, - and _ around the name) plus its line context; the first rule of the map that matches decides step, kind and action.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');   // Why (1 Nov 2026, CI Windows red): URL.pathname is /D:/a/... there and doubled the drive letter
export const MAP_FILE = path.join(root, 'tools', 'rename-map.json');
const TOKEN = /[A-Za-z0-9_-]*job[-_ ]?pilotto[A-Za-z0-9_-]*/gi;
const BINARY = /\.(png|jpe?g|gif|ico|icns|pdf|zip|woff2?|ttf|mp4|webm|gz|sqlite|dmg|exe)$/i;

/** The committed rules, in order, with `skip` paths (peers' files and the files that must keep old names). */
export const loadMap = (file = MAP_FILE) => {
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {...map, skipPaths: map.skip.map(s => new RegExp(s.path)), rules: map.rules.map(r => ({...r, re: new RegExp(r.match), before: r.before && new RegExp(r.before), after: r.after && new RegExp(r.after), lineRe: r.line && new RegExp(r.line), paths: r.paths && new RegExp(r.paths)}))};
};

/** Tracked text files (relative paths), from the work tree's own git. */
export const trackedFiles = (cwd = root) => execFileSync('git', ['ls-files', '-z'], {cwd, maxBuffer: 1 << 28}).toString().split('\0').filter(f => f && !BINARY.test(f));

/** Every occurrence in one file: {file, line, col, token, before, after}. */
export function occurrences(file, cwd = root) {
  let text;
  try { text = fs.readFileSync(path.join(cwd, file), 'utf8'); } catch { return []; }
  if (text.length > 4e6 || text.includes('\0')) return [];
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(TOKEN)) out.push({file, line: i + 1, col: m.index, token: m[0], before: line.slice(0, m.index), after: line.slice(m.index + m[0].length), text: line});
  });
  return out;
}

/** The first rule matching this occurrence, or undefined (an unowned hit: the inventory fails on it). */
export const classify = (map, occ) => map.rules.find(r => r.re.test(occ.token) && (!r.before || r.before.test(occ.before)) && (!r.after || r.after.test(occ.after)) && (!r.lineRe || r.lineRe.test(occ.text)) && (!r.paths || r.paths.test(occ.file)));

/** The new spelling of a token: the same name in the same case style (JOB_PILOTTO_X -> JOBADABRA_X, jobPilottoX -> jobadabraX, Job Pilotto -> Jobadabra). */
export const renamed = token => token
  .replace(/JOB[-_ ]?PILOTTO/g, 'JOBADABRA')
  .replace(/Job[-_ ]?Pilotto/g, 'Jobadabra')
  .replace(/job[-_ ]?[Pp]ilotto/g, 'jobadabra');

/** Is this file one the script must never rewrite (peers' files, guard and compatibility readers)? */
export const skipped = (map, file) => map.skipPaths.some(re => re.test(file));
