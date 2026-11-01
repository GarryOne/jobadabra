// Display-only: turns a stored run row into the record Recent activity shows; it judges and fills nothing.
// One run as an activity record (the shape of this Mac's runs.json records), from a store's row: a Notion ⏱️ Search runs page
// (fromRow) or a store record (fromRecord: src/stores CRON_RUN_FIELDS). Pure: no store, no Notion calls. Moved out of
// run-history.js so the store adapters (lib/store/*) and Recent activity share it. Guarded by test/run-history.test.js, store-runs.test.js.
import {CRASH_LINE} from './crash-line.js';

export const KIND = {scheduled: 'search', run: 'search', first: 'search', today: 'today', mail: 'mail', scout: 'scout', insight: 'insight',
  weekly: 'weekly', kits: 'kits', tailor: 'tailor', visits: 'visits', prepare: 'prepare', interview: 'interview', add: 'add', rejection: 'rejection', prep: 'prep', import: 'import'};
// What started it: the Mac's schedule, you (the app, Telegram, GitHub's Run button) or GitHub's schedule.
const TRIGGER = {'Mac schedule': 'schedule', Schedule: 'schedule', 'Always on': 'schedule'};
export const STALE_MS = 3 * 3600 * 1000;  // a row still "Running" after this long lost its job (the machine went away)
// A "Running" row nobody edited for this long lost its job too: a running engine edits it at least every 5 minutes (HEARTBEAT_S,
// src/notion/cron_runs.py). 7 Oct 2026: a run killed hard (a GitHub force-cancel) cannot close its row and showed as running for 3 h.
export const LOST_MS = 30 * 60 * 1000;

export const text = prop => (prop?.rich_text || prop?.title || []).map(part => part.plain_text ?? part.text?.content ?? '').join('');

const notionPage = id => `https://www.notion.so/${String(id).replace(/-/g, '')}`;
// From the row alone (before its page is read): the Application relation, and "Tracked…" (a new job) in its Summary.
function rowJob(p, mode, summary) {
  const id = mode === 'add' && p.Application?.relation?.[0]?.id;
  return id ? {pageId: id, url: notionPage(id), title: '', jobUrl: '', created: /^\W*Tracked\b/.test(summary)} : null;
}

// Where a run ran, the same for a Notion row and a store record: the place the store wrote (Where, src/stores/notion_cron_runs.py and the
// record's `where`), else, on a run from before it, its Run URL (GitHub) or Trigger ("Mac …"). 9 Oct 2026, the storemove e2e: a run made on
// this Mac read as GitHub on Notion and as nowhere on this Mac's store.
const placeOf = (written, runUrl, trigger) => {
  if (['mac', 'github', 'cloud'].includes(written)) return written;   // cloud: Always on on our servers (src/hosted_run.py merge)
  return runUrl ? 'github' : /^Mac/.test(trigger) ? 'mac' : 'elsewhere';
};

/** What a run's stored Telegram words say -> {telegram: whether a message went out, telegramNote: the words}. Both stores keep the engine's words
 *  (src/daily_search_reporting.py deliver_digest; other kinds store 1). Why (1 Nov 2026, #2750): one rule for both readers; the Notion one took any text as a send (#1393 fixed only the other). */
export function telegramOf(said) {
  const words = String(said ?? '');
  return {telegram: !!said && !/^(not sent|nothing)/i.test(words), telegramNote: words};
}

// One row as an activity record (the same shape as the Mac's own runs.json records).
export function fromRow(page, now = Date.now()) {
  const p = page.properties || {};
  const startedAt = p.Started?.date?.start || page.created_time;
  const mode = p.Mode?.select?.name || 'scheduled';
  const status = p.Status?.select?.name || '';
  const trigger = p.Trigger?.select?.name || '';
  const seconds = p['Duration (s)']?.number;
  const summary = text(p.Summary);
  const seen = Math.max(Date.parse(startedAt), Date.parse(page.last_edited_time || '') || 0);   // its last sign of life
  const running = status === 'Running' && now - Date.parse(startedAt) < STALE_MS && now - seen < LOST_MS;
  const ended = !running && seconds != null ? new Date(Date.parse(startedAt) + seconds * 1000).toISOString() : (running ? undefined : startedAt);
  // Notion keeps start times to the minute: two runs started in the same minute (a scheduled Gmail check and one you
  // started) would share an id, and the activity list would select both. A tie-breaker from the page id (< 1 s).
  const tie = parseInt(String(page.id).replace(/-/g, '').slice(-6), 16) % 1000 || 0;
  // The Interviews page's insights share the daily insight's mode; their result line tells them apart.
  const kind = mode === 'insight' && /^Interview insights\b/.test(summary) ? 'interviewInsight' : KIND[mode] || 'action';
  const record = {id: Date.parse(startedAt) + tie, pageId: page.id, notionUrl: page.url, url: p['Run URL']?.url || null, kind, mode,
    runId: text(p['Run id']) || null, startedBy: trigger,   // the Trigger as written (Schedule, Manual, Telegram…), for the run's detail
    trigger: TRIGGER[trigger] || 'you', where: placeOf(p.Where?.select?.name || '', p['Run URL']?.url, trigger), startedAt};
  // A crash line is not a step (7 Oct 2026: a run killed mid-way left "⏳ Traceback (most recent call last):" on its row, and Recent activity showed it).
  const step = summary.replace(/^⏳\s*/, '');
  if (running) return {...record, live: true, step: step && !CRASH_LINE.test(step) ? step : 'Running'};
  const ok = status !== 'Failed' && !(status === 'Running');  // a stale "Running" row: the job never reported
  const job = ok ? rowJob(p, mode, summary) : null;
  return {...record, endedAt: ended, ok, warned: status === 'Warnings', new: p['New jobs']?.number ?? null, feeds: p.Feeds?.number ?? null, usd: p['AI cost (USD)']?.number || 0,
    billing: p['Billed to']?.select?.name || null, ...telegramOf(text(p.Telegram)),
    result: result(summary, status, p['New jobs']?.number, mode), ...(job ? {job} : {})};
}

// One line on what it did: the row's Summary without the cost, or the count of new jobs for a search.
export function result(summary, status, fresh, mode) {
  if (status === 'Running') return 'never finished (see the log)';
  const cost = String.raw`(?:AI cost \$[\d.]+(?: \+ Claude Code)?|Claude Code, your plan)`;
  const line = summary.replace(new RegExp(String.raw`\s*\(${cost}\)\.?$`), '').replace(new RegExp(String.raw`;?\s*${cost}\.?$`), '').trim();
  if (KIND[mode] === 'search' && fresh != null) return fresh ? `${fresh} new job${fresh === 1 ? '' : 's'}` : 'nothing new';
  return line || (status === 'Failed' ? 'failed' : 'done');
}


// A store record (src/stores/base.py CRON_RUN_FIELDS, its numbers in `stats`: RUN_STATS) as an activity record, read exactly as
// fromRow reads a Notion row's columns. `notionUrl` is the run's ref in the store (store:cron_runs/<id>, base.ref), the one the engine prints
// on "Cronjob run logged:" so this Mac's runs.json record merges with it; it is a key, not a page to open.
export const recordLink = id => `store:cron_runs/${id}`;
export function fromRecord(row, now = Date.now()) {
  const stats = row.stats || {};
  const startedAt = row.started_at, mode = row.mode || row.kind || 'scheduled', status = row.status || '', trigger = row.trigger || '';
  const summary = String(row.summary || ''), progress = Array.isArray(row.progress) ? row.progress : [];
  const seconds = stats.duration_s;
  // The engine's heartbeat rewrites the elapsed seconds while the run lives (src/run_log.py): started + elapsed is its last sign of life, as a Notion row's
  // last edit is. A run killed hard (force-quit, crash) keeps Status Running and went quiet: not live after LOST_MS (#339).
  const seen = Date.parse(startedAt) + (Number(seconds) || 0) * 1000;
  const running = status === 'Running' && now - Date.parse(startedAt) < STALE_MS && now - seen < LOST_MS;
  const ended = running ? undefined : row.finished_at || (seconds != null ? new Date(Date.parse(startedAt) + seconds * 1000).toISOString() : startedAt);
  const kind = mode === 'insight' && /^Interview insights\b/.test(summary) ? 'interviewInsight' : KIND[mode] || 'action';
  const where = placeOf(row.where, row.run_url, trigger);
  const record = {id: Date.parse(startedAt), pageId: row.id, notionUrl: recordLink(row.id), url: row.run_url || null, kind, mode, runId: row.log_id || null, startedBy: trigger,
    trigger: TRIGGER[trigger] || 'you', where, startedAt};
  if (running) {
    const step = String(progress[progress.length - 1] || summary).replace(/^⏳\s*/, '');
    return {...record, live: true, step: step && !CRASH_LINE.test(step) ? step : 'Running'};
  }
  const ok = status !== 'Failed' && status !== 'Running';
  const job = ok && mode === 'add' && row.application ? {pageId: row.application, url: null, title: '', jobUrl: '', created: /^\W*Tracked\b/.test(summary)} : null;
  return {...record, endedAt: ended, ok, warned: status === 'Warnings', new: stats.new_jobs ?? null, feeds: stats.feeds ?? null, usd: stats.ai_cost_usd || 0,
    billing: stats.billed_to || null, ...telegramOf(stats.telegram), result: where === 'cloud' ? summary : result(summary, status, stats.new_jobs, mode), ...(job ? {job} : {})};
}
