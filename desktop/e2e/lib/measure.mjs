// The measure step of capture once, measure many (spec docs/superpowers/specs/2026-10-13-capture-once-measure-many.md): a row replayed offline by lib/row-replay.mjs
// (unchanged) is read as a live row is: its app log turned into the live run's output (lib/record-sites.mjs outputOfLog) and parsed by parseLive, its ending by lib/ending.mjs,
// the dead-end tables by lib/pool-shadow.mjs and lib/pool-acted.mjs. It owns only the safeguards that keep an offline number from passing for a live one (owner via cc,
// 13 Oct 2026): every table labelled offline (memo|plan), never beside a live number; a row with ANY ask its capture has no kept answer for is "not measured", by route and differing part (13 Oct 2026: one missed page-kind ask of 16 took a fill from 5 to 1);
// a press the capture never saw is "unseen", never worked or failed; "unverified" until the positive control passed. Pure but for the captures' files.
// CLI: measure.mjs (npm run measure). Guard: e2e/test/measure.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {RUN_SETTINGS} from './capture-library.mjs';
import {endingOf} from './ending.mjs';
import {actedOf} from './pool-acted.mjs';
import {personPrecision, shadowTable} from './pool-shadow.mjs';
import {outputOfLog, parseLive} from './record-sites.mjs';

// The positive control (spec PR 3): until it passed, every output says "unverified". Flipped by the PR that records its numbers in the spec.
export const VERIFIED = false;

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

// The library (lib/capture-library.mjs) -> the capture folders to measure: each row's newest capture of the last `days` days (cc: the library follows site changes).
export function capturesOf(root, {days = 1, today = new Date().toISOString().slice(0, 10), every = false} = {}) {
  const since = Date.parse(today) - (days - 1) * 86400000, newest = new Map();
  let dayNames = [];
  try { dayNames = fs.readdirSync(root).filter(name => /^\d{4}-\d\d-\d\d$/.test(name) && Date.parse(name) >= since).sort(); } catch { return []; }
  const found = [];
  for (const day of dayNames) for (const name of fs.readdirSync(path.join(root, day)).sort()) {
    const dir = path.join(root, day, name), meta = readJson(path.join(dir, 'capture.json'), null);
    if (!meta || !fs.existsSync(path.join(dir, 'case.json'))) continue;
    if (every) found.push(dir); else newest.set(meta.row, dir);   // days and times ascend: the last one kept is the newest
  }
  return every ? found : [...newest.values()];
}

// A capture's run settings (lib/capture-library.mjs RUN_SETTINGS) -> {settings, env: what the replay sets, why: '' or why it cannot be replayed}. A setting not recorded is never
// guessed (a capture before 13 Oct 2026 knew its applicant only in its result).
export function settingsOf(meta = {}) {
  const settings = {}, env = {};
  for (const [name, setting] of Object.entries(RUN_SETTINGS)) {
    const value = meta.settings?.[name] ?? (name === 'applicant' ? meta.result?.applicant : undefined);
    if (value == null || value === '') return {settings, env, why: `${name} not recorded`};
    if (setting.only && value !== setting.only) return {settings, env, why: `${name} ${value} is not replayed offline (only ${setting.only})`};
    settings[name] = value;
    if (setting.replayEnv) env[setting.replayEnv] = name === 'model' && value === 'default' ? '' : value;
  }
  return {settings, env, why: ''};
}
// A capture refused before its replay -> a row that is not measured, its live side still read
export function unreplayedRow(captureDir, why) {
  const meta = readJson(path.join(captureDir, 'capture.json'), {}), item = readJson(path.join(captureDir, 'case.json'), {});
  const url = (item.pages || []).find(page => !page.frameOf)?.url || '';
  return {row: meta.row || path.basename(captureDir), capture: captureDir, build: meta.build || {}, live: readingOf(read(path.join(captureDir, 'app.log')), url), measured: false, reasons: [why], why: `not measured: ${why}`};
}

// One row's reading from an app log, the same for the capture's own (live) log and a replay's: -> {result (parseLive), ending, log}
export function readingOf(appLog, url) {
  const result = parseLive(outputOfLog(appLog, appLog.trim() ? url : ''));
  return {result, ending: endingOf(result, appLog).ending || null, log: appLog};
}

// A press no capture saw (the replay's acted presses of a kind beyond the live run's count of that kind) is unseen: its effect is the recorded page's, not the site's.
export function pressesOf(replayLog, liveLog) {
  const seen = {};
  for (const press of actedOf(liveLog)) seen[press.why] = (seen[press.why] || 0) + 1;
  return actedOf(replayLog).map(press => (seen[press.why]-- > 0 ? press : {...press, effect: 'unseen'}));
}

// captureDir + its replay result (lib/row-replay.mjs replay) -> one measured row
// The asks a replay made that its capture has no kept answer for, from the app's own line (lib/ai/model-memo.js: "...: <step> (model memo: not in the row's kept answers ...;
// the nearest kept ask differs in: <parts>)"): -> [{what: the step that asked, e.g. 'page kind', parts: 'use'}]. A prompt or schema change shows here at once.
const MISS = /\] ([^:(]+?): .*?model memo: not in the row's kept answers[^;]*(?:; the nearest kept ask differs in: ([^;)]*))?/;
export const missesIn = appLog => String(appLog).split('\n').map(line => MISS.exec(line)).filter(Boolean).map(([, what, parts]) => ({what: what.trim(), parts: (parts || '?').trim()}));
export const missReason = miss => `${miss.what}: ${miss.parts} differs`;

// captureDir + its replay result (lib/row-replay.mjs replay) -> one measured row. Any miss: not measured (cc, 13 Oct 2026); the positive control (spec PR 3) may later show a miss kind harmless.
export function measuredRow(captureDir, replay) {
  const meta = readJson(path.join(captureDir, 'capture.json'), {}), item = readJson(path.join(captureDir, 'case.json'), {});
  const url = (item.pages || []).find(page => !page.frameOf)?.url || '', liveLog = read(path.join(captureDir, 'app.log'));
  const row = {row: meta.row || path.basename(captureDir), capture: captureDir, build: meta.build || {}, live: readingOf(liveLog, url)};
  if (!replay || replay.error) return {...row, measured: false, reasons: ['the replay failed'], why: `the replay failed: ${replay?.error || 'no result'}`};
  const misses = missesIn(replay.appLog || ''), count = Math.max(replay.misses || 0, misses.length);
  const offline = {...readingOf(replay.appLog || '', url), presses: pressesOf(replay.appLog || '', liveLog), misses: count, missed: misses, unrecorded: replay.unrecorded || [], divergence: replay.divergence || ''};
  if (count) {
    const reasons = misses.length ? misses.map(missReason) : Array.from({length: count}, () => 'an ask: ? differs');
    return {...row, offline, measured: false, reasons, why: `${count} ask${count > 1 ? 's' : ''} with no kept answer (${reasons.join(', ')}): not measured`};
  }
  return {...row, offline, measured: true};
}

// The tables of measured rows, from one side ('offline' or 'live'): never both in one table.
export function tablesOf(rows, side) {
  const used = rows.filter(row => row.measured && row[side]);
  const logs = used.map(row => ({row: row.row, log: row[side].log, reached: row[side].result.reached}));
  const presses = used.flatMap(row => (side === 'offline' ? row.offline.presses : actedOf(row.live.log)).map(press => ({...press, row: row.row})));
  const count = effect => presses.filter(press => press.effect === effect).length;
  const endings = {};
  for (const row of used) { const word = row[side].ending || 'none'; endings[word] = (endings[word] || 0) + 1; }
  const fill = used.reduce((sum, row) => ({filled: sum.filled + (row[side].result.filled || 0), left: sum.left + (row[side].result.left || 0)}), {filled: 0, left: 0});
  const reasons = {};
  for (const row of rows.filter(one => !one.measured)) for (const reason of row.reasons || [row.why]) reasons[reason] = (reasons[reason] || 0) + 1;
  return {rows: used.length, reasons, notMeasured: rows.filter(row => !row.measured).map(row => ({row: row.row, why: row.why})), shadow: shadowTable(logs), person: personPrecision(logs),
    acted: {acted: presses.length, worked: count('worked'), failed: presses.length - count('worked') - count('unseen'), unseen: count('unseen')}, endings, fill,
    perRow: used.map(row => ({row: row.row, reached: row[side].result.reached, ending: row[side].ending, filled: row[side].result.filled ?? null, left: row[side].result.left ?? null}))};
}

// The label every offline line carries.
export const offlineLabel = ({ask = false, verified = VERIFIED} = {}) => `offline (${ask ? 'plan' : 'memo'})${verified ? '' : ', unverified'}`;

// -> the lines to print for one side's tables, each led by its label
export function tableLines(tables, label) {
  const why = Object.entries(tables.reasons).sort((a, b) => b[1] - a[1]).map(([reason, n]) => `${reason} x${n}`).join(', ');
  const lines = [`[${label}] ${tables.rows} rows measured, ${tables.notMeasured.length} NOT MEASURED${why ? ` (${why})` : ''}`];
  for (const item of tables.notMeasured) lines.push(`[${label}]   not measured: ${item.row}: ${item.why}`);
  for (const row of tables.perRow) lines.push(`[${label}]   ${row.row}: reached ${row.reached}, ending ${row.ending || '-'}${row.filled != null ? `, ${row.filled} filled, ${row.left} left` : ''}`);
  lines.push(`[${label}] endings: ${Object.entries(tables.endings).map(([word, n]) => `${word} ${n}`).join(', ') || 'none'}; fill: ${tables.fill.filled} filled, ${tables.fill.left} left`);
  const byWhy = Object.entries(tables.shadow.byWhy).sort().map(([why, e]) => `${why} agree ${e.agree} would_act ${e.would_act} worse ${e.worse} not_asked ${e.not_asked}`);
  lines.push(`[${label}] shadow: ${tables.shadow.total} stops${byWhy.length ? `; ${byWhy.join('; ')}` : ''}; worse ${tables.shadow.worse.length}`);
  lines.push(`[${label}] acted: ${tables.acted.acted} presses: worked ${tables.acted.worked}, failed ${tables.acted.failed}, unseen ${tables.acted.unseen} (a press no capture saw: proven only live)`);
  lines.push(`[${label}] person verb: ${tables.person.answers} answers, right ${tables.person.right}, wrong ${tables.person.wrong}, unjudged ${tables.person.unjudged}`);
  return lines;
}
