// The app's own log, for debugging: <data folder>/logs/app.log for today, app-YYYY-MM-DD.log for each of the last 30
// days (lib/log-days.js), and the console. Written through electron-log's file transport (logTo(folder, logger));
// without one (tests, scripts) straight to the file.
// Never secrets and never your personal data: log field names, counts, sources and errors, not values.
import fs from 'node:fs';
import path from 'node:path';
import {rollDay, capDay} from './log-days.js';

let file = null, write = null, logger = null;
export const DAY_MAX = 5_000_000, TOTAL_MAX = 100_000_000;
export function logTo(folder, electronLog = null) {
  try { fs.mkdirSync(folder, {recursive: true}); file = path.join(folder, 'app.log'); } catch { file = null; }
  logger = file && electronLog ? electronLog : null;
  write = logger ? throughLogger(logger, file) : null;
}
// electron-log writes the lines this module formats, as they are (one greppable format for every area); a day past
// DAY_MAX keeps its newest half.
function throughLogger(electronLog, target) {
  for (const [name, transport] of Object.entries(electronLog.transports)) if (name !== 'file' && transport) transport.level = false;
  Object.assign(electronLog.transports.file, {level: 'info', format: '{text}', maxSize: DAY_MAX, resolvePathFn: () => target,
    archiveLogFn: old => old.crop(Math.floor(electronLog.transports.file.maxSize / 2))});
  return line => electronLog.info(line);
}
// A new day: yesterday's lines move to app-<day>.log and electron-log starts today's file afresh.
function newDay(now) {
  if (!rollDay(file, {now, maxTotal: TOTAL_MAX})) return;
  try { logger?.transports.file.getFile().reset(); } catch {}
}
export const logFile = () => file;
// A field is evidence, not a dump: each string is cut to FIELD_MAX and the line to LINE_MAX. 7 Oct 2026: every job-list
// run logged its last 3 output lines, 116 KB of job JSON each, so the 1 MB log held about a minute of history.
// The fill's own "fields:" line (extension/fill-fields.js logFieldsLine: up to 40 rows of labels and fixed words) is the one line that is evidence by design: the pool's report reads
// every field from it, and a form of 36 fields went past 4000 (13 Oct 2026: 3 fields of one row could not be named); it gets FIELDS_LINE_MAX.
export const FIELD_MAX = 300, LINE_MAX = 4000, FIELDS_LINE_MAX = 12000;
const FIELDS_LINE = /^fill: fields\b/;
const cut = (text, max) => (text.length > max ? `${text.slice(0, max)}… (+${text.length - max} chars)` : text);
const shorten = value => (typeof value === 'string' ? cut(value, FIELD_MAX)
  : Array.isArray(value) ? value.map(shorten)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shorten(item)])) : value);
export function format(area, message, data, at = new Date()) {
  return cut(`${at.toISOString()} [${area}] ${message}${data === undefined ? '' : ` ${JSON.stringify(shorten(data))}`}`, FIELDS_LINE.test(message) ? FIELDS_LINE_MAX : LINE_MAX);
}
export function log(area, message, data) {
  const line = format(area, message, data);
  // The terminal (npm start) shows only what went wrong; everything is in logs/app.log. JOBADABRA_VERBOSE=1: all of it.
  if (process.env.JOBADABRA_VERBOSE || data?.error || /\b(fail|error|refused|429)\b/i.test(message)) console.log(line);
  if (!file) return;
  newDay(new Date());
  if (write) { try { write(line); return; } catch {} }
  capDay(file, DAY_MAX);
  try { fs.appendFileSync(file, `${line}\n`); } catch {}
}
