// Owns: the report of one finished Find jobs run (owner, 18 Oct 2026: "register real users' job searches and see their results"): the engine measures it
// (src/search_report.py: counts and seconds), this file keeps only the listed fields, adds the nth search and the runs until the first 70+, and records it as
// a technical report (kind "search", so the Technical reports switch decides and the last 20 stay visible in Settings). Never a job, title, company, link,
// CV, name or typed word; the one place string is a city candidate the site shows only when 3+ installs share it.
// Read counts: read_<method>_<measure>, five method names, never a host, URL or company.
// Guarded by: test/search-report.test.js (the record has only listed fields: a new field fails it until it is listed here and on the privacy page).
import {engineOf} from './ai/names.js';
import {run} from './pipeline-run.js';
import {log as appLog} from './log.js';

// Every field a search report may carry, with the test its value must pass. Anything else is dropped.
const count = v => Number.isInteger(v) && v >= 0 && v < 1e6;
const oneOf = list => v => list.includes(v);
export const FAMILIES = ['software', 'sales_b2b', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades', 'other'];   // src/role_kinds.py KINDS (test keeps them equal)
export const READ_METHODS = ['feed_api', 'plain_page', 'ai_board', 'browser', 'extension_tab'], READ_MEASURES = ['sources', 'jobs', 's', 'ai_cents'];   // src/read_methods.py (test keeps them equal)
export const FIELDS = {
  family: oneOf(FAMILIES),
  country: v => /^[A-Z]{2}$/.test(v),
  city: v => typeof v === 'string' && v.length <= 40 && /^[\p{L} .'-]+$/u.test(v),
  in_places: count, scored: count, fit70: count, first_s: count, tenth_s: count, first_fit70_s: count,
  nth: count, runs_to_fit70: count,
  engine: oneOf(['api', 'cli', 'openai', 'codex']),
  trigger: oneOf(['first', 'you', 'schedule', 'telegram', 'other']),
  result: oneOf(['done', 'failed', 'stopped']),   // a search that did not finish sends only this, its engine and its trigger
  ...Object.fromEntries(READ_METHODS.flatMap(method => READ_MEASURES.map(measure => [`read_${method}_${measure}`, count]))),   // how its sources were read, per fixed method name
};

// The report from the engine's measured record plus the app's own facts; unlisted or invalid fields are left out.
export function record(measured, extra) {
  const out = {};
  for (const [key, value] of Object.entries({...measured, ...extra})) if (FIELDS[key]?.(value)) out[key] = value;
  return out;
}

const listeners = new Set();
export const onSearchDone = listener => listeners.add(listener);
export const searchDone = info => { for (const listener of listeners) { try { listener(info); } catch { /* never breaks a search */ } } };

// After a finished Find jobs run: measure it and record it. Never throws, never waits on the user.
export async function reportSearch(storage, telemetry, {startedAt, ok, stopped = false, trigger = 'you'}, exec = run, say = appLog) {
  try {
    if (!telemetry?.enabled()) return null;
    const base = {engine: engineOf(storage), trigger: ['first', 'you', 'schedule', 'telegram'].includes(trigger) ? trigger : 'other'};
    if (!ok) return telemetry.record('search', record({}, {...base, result: stopped ? 'stopped' : 'failed'}));   // nothing to measure: it counts toward "reached a 70+" as a miss
    const {stdout, code} = await exec(storage, ['src', 'search_report', '--since', startedAt], () => {}, {}, {privateOutput: true});
    if (code !== 0) { say('telemetry', 'search report not sent: the measuring step failed', {code}); return null; }
    const measured = JSON.parse(String(stdout).trim().split('\n').pop());
    const state = storage.settings().searchReport || {n: 0, toFit: null};
    const n = state.n + 1;
    const toFit = state.toFit ?? (measured.fit70 > 0 ? n : null);   // runs until the first 70+ (this one included), fixed once reached
    storage.saveSettings({searchReport: {n, toFit}});
    return telemetry.record('search', record(measured, {...base, nth: n, runs_to_fit70: toFit, result: 'done'}));
  } catch (error) {
    try { say('telemetry', 'search report not sent: it could not be built', {error: error.message}); } catch { /* the log never breaks a search */ }
    return null;
  }
}
