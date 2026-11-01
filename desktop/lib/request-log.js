// Every Notion request, one line each, for debugging and tuning: <data folder>/logs/notion-requests.log for today,
// notion-requests-YYYY-MM-DD.log for the last 30 days (lib/log-days.js; only the app rolls and caps it). Written by the app (lib/notion.js) and its Python jobs (src/notion/client.py, told the path through
// JOBADABRA_NOTION_LOG), so one file shows who asked what, when:
//   2026-09-29T18:54:58.564Z  app:extension  GET  pages/3e96…  429  183ms  try 1
// Routes and statuses only: never a request's content.
import fs from 'node:fs';
import {rollDay, capDay} from './log-days.js';

const DAY_MAX = 10_000_000, TOTAL_MAX = 100_000_000;
let file = null;
export const setFile = path => { file = path; };
export const logPath = () => file;

// Which part of the app made the call: the first module on the stack that isn't the Notion client itself.
export function caller(stack = new Error().stack) {
  for (const line of String(stack).split('\n').slice(1)) {
    const match = line.match(/(?:lib|pages|renderer)[/\\]([\w-]+)\.m?js/);
    if (match && !['notion', 'notion-pace', 'request-log'].includes(match[1])) return `app:${match[1]}`;
  }
  return 'app';
}

export function write({method, route, status, ms, attempt, who = caller()}) {
  if (!file) return;
  const line = [new Date().toISOString(), who, method, String(route).split('?')[0], status, `${ms}ms`, `try ${attempt + 1}`].join('\t');
  rollDay(file, {maxTotal: TOTAL_MAX});
  capDay(file, DAY_MAX);
  fs.appendFile(file, `${line}\n`, () => {});
}
