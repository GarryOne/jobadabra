// Saves a smoke site's result to the day's report the moment the site ends (not only after the last site), so stopping a run loses only the site in progress.
// It owns: reading the earlier days' reports, merging one site into <dir>/<day>.json (a second run the same day adds to it), and the site's regression check
// against ITS last run. record-sites.mjs calls it after each site. Guard: e2e/test/record/record-sites-record.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {compare} from './record-sites.mjs';

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// The reports of the days before `day`, oldest first by file name; an unreadable file is skipped.
export function earlierReports(dir, day) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => /^\d{4}-\d\d-\d\d\.json$/.test(name) && name < `${day}.json`).sort().map(name => readJson(path.join(dir, name))).filter(Boolean);
}

// Adds `result` for `shape` to the day's report (newer wins), keeps what other runs of the day saved, and returns the shape's regression ({shape, why, url}) or null.
// `earlier` is lastSeen(earlierReports(...)): each shape's last result across the earlier days.
export function recordSite({dir, day, shape, result, earlier = {}}) {
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, `${day}.json`), report = readJson(file) || {day};
  const found = compare(earlier, {[shape]: result})[0] || null;
  report.results = {...report.results, [shape]: result};
  report.regressions = [...(report.regressions || []).filter(item => item.shape !== shape), ...(found ? [found] : [])];
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(report, null, 1)}\n`);
  fs.renameSync(`${file}.tmp`, file);   // a stop mid-write leaves the old report whole
  return found;
}
