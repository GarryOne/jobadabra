// A run's logs kept with its artifacts, for every suite (lib/app.mjs keepLogs, at each app's close): the app's own logs, and always the two that answer
// "what did this run reach?": notion-requests.log (every Notion request the app and its Python made: route and status, never content) and store-call.log
// (every ctx.data call of the suite itself, lib/store-call.mjs: which store, which Notion host). A run that made none still leaves the file, empty: zero
// is then a fact, not a missing file. Guarded by test/run-logs.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

export const KEPT_LOGS = ['notion-requests.log', 'store-call.log'];

// The store-call log of a profile (lib/store-call.mjs appends to it).
export const storeCallLog = profile => path.join(profile, 'logs', 'store-call.log');

// One line per store call: time, entity.method, store, the Notion host it went to (none on this Mac's store), and how it ended. Never the arguments or the answer.
export function logStoreCall(profile, {entity, method, store, notionUrl = '', ok, error = ''}) {
  let host = 'none';
  if (store !== 'sqlite') { try { host = new URL(notionUrl || 'https://api.notion.com').host; } catch { host = 'unreadable'; } }
  const line = [new Date().toISOString(), `${entity}.${method}`, `store=${store}`, `notion=${host}`, ok ? 'ok' : `failed: ${String(error).split('\n')[0].slice(0, 120)}`].join('\t');
  try {
    fs.mkdirSync(path.dirname(storeCallLog(profile)), {recursive: true});
    fs.appendFileSync(storeCallLog(profile), `${line}\n`);
  } catch { /* a log is a help, never a reason to fail */ }
}

// Copies every log of the profile into <artifacts>/logs, and makes sure each KEPT_LOGS file is there (empty when the run made no such request).
// -> {name: lines} for the kept ones, so the caller can say the counts.
export function keepRunLogs(profile, artifacts) {
  const from = path.join(profile, 'logs'), to = path.join(artifacts, 'logs');
  fs.mkdirSync(to, {recursive: true});
  for (const name of fs.existsSync(from) ? fs.readdirSync(from) : []) {
    if (fs.statSync(path.join(from, name)).isFile()) fs.copyFileSync(path.join(from, name), path.join(to, name));
  }
  const counts = {};
  for (const name of KEPT_LOGS) {
    const file = path.join(to, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, '');
    counts[name] = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
  }
  return counts;
}
