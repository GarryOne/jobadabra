// The app's own log as the tests read it: today's logs/app.log AND the day files it rolled into (app-YYYY-MM-DD.log, lib/log-days.js), oldest first.
// 7 Oct 2026: a step counted engine starts in app.log alone; the app's midnight (22:00 UTC, Zurich) moved the first run's line to app-2026-10-07.log
// mid-step, so "one click started 0 runs" failed the Windows employers suite. Read every app.log line through this, never app.log by itself.
import fs from 'node:fs';
import path from 'node:path';
import {dayFiles} from '../../lib/log-days.js';

export function appLogText(profile) {
  const today = path.join(profile, 'logs', 'app.log');
  const files = [...dayFiles(today).reverse().map(item => item.file), today];
  return files.map(file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }).filter(Boolean).join('\n');
}
export const appLogLines = profile => appLogText(profile).split('\n');
/**
 * The sessions whose menu the app armed again ("[fill] menu armed again ... {"id":"<session>"}", lib/menu-rearm.js), in a slice of the app log.
 * @param {string} text app log text  @returns {Set<string>} session ids
 */
export const rearmedSessions = text => new Set([...text.matchAll(/\[fill\] menu armed again[^\n]*"id":"([^"]+)"/g)].map(found => found[1]));
