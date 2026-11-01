// Owns: the one-shot engine commands the app awaits for an answer: job list, calendar, import/add/lead, posting, Focus, interview prep,
// reassign, feedback, unapply/not-submitted, outcomes, delete, set status. None is queued; each is a run() plus parsing the last line.
// Guarded by: test/lead-confirm.test.js, test/app.test.js, test/app-scenarios.test.js, test/notion-trying.test.js.
// Split out of pipeline.js (a pure move); pipeline.js re-exports everything.
import {markFinished} from './job-flags.js';
import {jobFrom, jobFromResult} from './job-line.js';
import {log as appLog} from './log.js';

import {dailyArgs, deliveryReady, triggerEnv} from './pipeline-args.js';
import {readable} from './pipeline-env.js';
import {run} from './pipeline-run.js';
const engineRun = run;   // the default of the shared reads below (a test passes its own)
import {afterWrite, sharedRead} from './shared-read.js';
import * as viewCache from './view-cache.js';

// limit: how many of the best rows to send (the list's "Show more" raises it); the counts cover every row (src/desktop.py jobs).
// One read at a time per limit, for every caller (17 Oct 2026: a card asked for the list on every activity event, each read took ~60 s on a slow Notion day and 187 Python runs piled up): a second ask joins the running one.
export const jobs = sharedRead('engine jobs', async (storage, limit = 200, run = engineRun) => {
  // Until the first search has ended, the jobs it found and has not scored yet are listed too (they say "Scoring…"): the list grows while it runs.
  const firstRun = !storage.settings().lastSearchAt;
  const {code, stdout} = await run(storage, ['src.desktop', 'jobs', '--limit', String(limit), ...(firstRun ? ['--first-run'] : [])]);
  if (code !== 0) throw new Error('Could not read the job list');
  return viewCache.withHeldWrites(storage, markFinished(storage, JSON.parse(stdout.trim().split('\n').pop())));   // Why (#2758): the app's own recent writes, for every caller of the list (view-cache.js)
}, {keyOf: (storage, limit) => limit ?? 200});

// The Calendar's jobs: Applications rows only (src/desktop.py calendar), a fraction of the full list's read.
export const calendarJobs = sharedRead('engine calendar', async (storage, run = engineRun) => {
  const {code, stdout} = await run(storage, ['src.desktop', 'calendar']);
  if (code !== 0) throw new Error('Could not read the calendar');
  return JSON.parse(stdout.trim().split('\n').pop());
});

// A job applied to elsewhere: Applications row (Applied, with the date), the event, the frozen record, a Gmail
// check, and the job in the Jobs list as Applied. Waits for it, so the list can refresh; returns its one line.
// details: {title, company, text, origin} (origin: 'inbound' when a recruiter or company wrote first) for pages that aren't read (LinkedIn…); the AI stages then score it like a found job.
// A job the search has not found: one link, then the same read, facts, fit score and Job Matches row a found
// job gets. It stays New. It is not marked Applied.
export async function importJob(storage, url, onLine = () => {}) {
  const {code, stdout, result} = await run(storage, dailyArgs(storage, {mode: 'import', job: url}), onLine);
  const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
  const text = readable(line);
  const ok = code === 0 && !text.startsWith('⚠️');
  return {ok, text: text || 'Could not add it (see the activity log)', job: ok ? (jobFromResult(result) || jobFrom(stdout.split('\n'))) : null};
}

export async function addApplied(storage, url, when = '', onLine = () => {}, details = {}) {
  const inputs = {mode: 'add', job: url, note: when, jobTitle: details.title, jobCompany: details.company, jobText: details.text, origin: details.origin};
  // Why (1 Nov 2026, #2909): --from-app is how the engine knows the caller is the app (Source "Jobadabra app"), as the two log paths below pass it.
  const {code, stdout, result} = await run(storage, [...dailyArgs(storage, inputs), '--from-app'], onLine);
  const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
  const text = readable(line);
  const ok = code === 0 && !text.startsWith('⚠️');
  return {ok, text: text || 'Could not add it (see the activity log)', job: ok ? (jobFromResult(result) || jobFrom(stdout.split('\n'))) : null};
}

// A pasted message or screenshot (LinkedIn, Gmail, WhatsApp): Claude finds the job it's about and updates it in Notion,
// or adds it (src/ai/inbox.py), like /add <message> or a screenshot sent to the bot. file: the screenshot's path;
// target: '' (Claude decides), 'new', or a job URL.
// The confirmation step's answers as the engine's flags (src/daily.py add mode). company/agency '' = not named.
export function confirmedArgs(confirmed = {}) {
  const c = confirmed || {};
  const flag = (name, value) => (value ? [name, String(value)] : []);
  return [...flag('--kind', c.kind), ...flag('--channel', c.channel), ...flag('--channel-other', c.other),
    ...flag('--started', c.started), ...flag('--interview-at', c.interview), ...flag('--last-at', c.lastAt),
    ...(typeof c.company === 'string' ? ['--company', c.company] : []), ...(typeof c.agency === 'string' ? ['--agency', c.agency] : []),
    ...(typeof c.firstContact === 'boolean' ? ['--first-contact', c.firstContact ? 'yes' : 'no'] : []),
    ...(typeof c.agreed === 'boolean' ? ['--agreed', c.agreed ? 'yes' : 'no'] : []), ...flag('--origin', c.origin)];
}
// Two steps, so nothing reaches Notion before you confirmed where the conversation is from and when it started:
// proposeLead reads it (the one AI call) and says what it would log; addLead with {reading, confirmed} writes it.
// With reading (an earlier proposal's JSON file): the same reading proposed again for the job you picked (target), no AI.
export async function proposeLead(storage, text, onLine = () => {}, {file = '', target = '', reading = ''} = {}) {
  const {code, stdout} = await run(storage, [...dailyArgs(storage, {mode: 'add', note: text, file, target}), '--from-app', '--propose',
    ...(reading ? ['--reading', reading] : [])], onLine);
  const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
  try { const proposal = JSON.parse(line); if (proposal.ok) return proposal; } catch {}
  const plain = readable(line);
  return {ok: false, text: code === 0 ? 'Could not read it (see the activity log)' : plain || 'Could not read it (see the activity log)'};
}
// reading: the path of proposeLead's result, saved as JSON; confirmed: what you confirmed (renderer/lead-confirm.js),
// including whether you agreed to talk to the recruiter (asked only when the conversation doesn't show it).
export async function addLead(storage, text, onLine = () => {}, {file = '', target = '', reading = '', confirmed = null} = {}) {
  const extra = ['--from-app', ...(reading ? ['--reading', reading, ...confirmedArgs(confirmed)] : [])];
  const {code, stdout} = await run(storage, [...dailyArgs(storage, {mode: 'add', note: text, file, target}), ...extra], onLine);
  const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
  const plain = readable(line);
  const ok = code === 0 && !plain.startsWith('⚠️');
  // The job it created or updated, for the Log box's links to it (Open job in Notion, Show in Jobs).
  return {ok, text: plain || 'Could not add it (see the activity log)', job: ok ? jobFrom(stdout.split('\n')) : null};
}

// One job's posting (title, company, description), for tailoring the CV to it.
export async function posting(storage, code) {
  const {code: exit, stdout} = await run(storage, ['src.desktop', 'posting', code]);
  if (exit !== 0) throw new Error('Could not read the job posting');
  return JSON.parse(stdout.trim().split('\n').pop());
}

// Why a rejected application was turned down (src/ai/rejection.py, Claude Sonnet 5): verdict + lesson on its
// Applications row and page. The last output line is the one-line summary.
export async function reviewRejection(storage, url, onLine = () => {}) {
  const {code, stdout} = await run(storage, ['src.ai.rejection', '--job', url], onLine, {JOBADABRA_TRIGGER: 'Mac (you)'});
  const lines = stdout.trim().split('\n').filter(Boolean);
  const summary = lines.find(line => line.includes('Why rejected')) || '';
  return {ok: code === 0 && !!summary, text: summary || lines.pop() || 'The review failed (see the activity log)'};
}

// Focus (src/focus.py, no AI): what to do next, from Notion.
export async function focus(storage) {
  const {code, stdout} = await run(storage, ['src.focus']);  // the target comes from ⚙️ Search settings
  try { return {ok: code === 0, focus: JSON.parse(stdout.trim().split('\n').pop())}; }
  catch { return {ok: false, error: 'Could not read your Notion (see the activity log).'}; }
}
// what: 'replied' (you answered them), 'followed_up' (Focus → Follow up: your nudge, which re-arms it),
// or 'details_skipped' (you don't know the employer yet: the card stays gone after a refresh).
export async function focusDone(storage, pageId, what = 'replied') {
  const which = {followed_up: 'followed_up', details_skipped: 'details_skipped'}[what] || 'replied';
  const {code} = await run(storage, ['src.focus', 'done', pageId, which]);
  appLog('focus', `marked ${which}`, {page_id: pageId, ok: code === 0});
  return {ok: code === 0};
}
// What you resolved from Focus, newest first (Notion: 📈 Application Events from the app, 💡 Insights you rated).
export async function focusHistory(storage) {
  const {code, stdout} = await run(storage, ['src.focus', 'history']);
  try { return {...JSON.parse(stdout.trim().split('\n').pop()), ok: code === 0}; }
  catch { return {ok: false, error: 'Your history could not be read. Try again.', items: []}; }
}
const lastJson = (stdout, fallback) => { try { return JSON.parse(stdout.trim().split('\n').pop()); } catch { return fallback; } };
// Interview prep kit (src/ai/prep.py): built on the job's Notion page; needs_description when the role is unknown.
export async function interviewPrep(storage, pageId, onLine = () => {}) {
  const {stdout} = await run(storage, ['src.ai.prep', 'build', pageId], onLine, triggerEnv('you'));
  return lastJson(stdout, {ok: false, text: 'The prep kit could not be built. Try again.'});
}
export async function describeJob(storage, pageId, text = '', url = '') {
  const {stdout} = await run(storage, ['src.ai.prep', 'describe', pageId, ...(text ? ['--text', text] : []), ...(url ? ['--url', url] : [])]);
  return lastJson(stdout, {ok: false, text: 'The description could not be saved. Try again.'});
}
// An email the Gmail check wasn't sure where to place: move it to a job ("new", "none" or a job URL).
export async function reassignEmail(storage, eventId, target) {
  const {stdout} = await run(storage, ['src.ai.reassign', 'move', eventId, target]);
  return lastJson(stdout, {ok: false, text: 'The email could not be moved. Try again.'});   // any store (src/ai/reassign.py)
}
// Focus → "Did the interview happen?" (src/ai/interviews.py held | moved | cancelled, no AI).
export async function interviewHappened(storage, pageId, answer, {notes = '', at = ''} = {}) {
  if (!['held', 'moved', 'cancelled'].includes(answer)) return {ok: false, error: 'Unknown answer'};
  const args = ['src.ai.interviews', answer, pageId, ...(answer === 'held' && notes ? [`--notes=${notes}`] : []),
    ...(answer === 'moved' ? [`--at=${at}`] : [])];
  const {code, stdout} = await run(storage, args);
  const result = lastJson(stdout, {ok: false, error: 'The interview could not be updated. Try again.'});
  return {...result, ok: code === 0 && !!result.ok};
}
export async function feedbackAction(storage, pageId, action, text = '') {
  const {code, stdout} = await run(storage, ['src.feedback', pageId, action, ...(text ? ['--text', text] : [])]);
  try { const result = JSON.parse(stdout.trim().split('\n').pop()); return {...result, ok: code === 0 && result.ok}; }
  catch { return {ok: false, error: 'Feedback could not be saved. Try again.'}; }
}
// The reminder text (empty when nothing is worth interrupting for); send: also to Telegram.
export async function focusReminder(storage, send = false) {
  const {code, stdout} = await run(storage, ['src.focus', 'remind', ...(send && deliveryReady(storage) ? ['--send'] : [])]);
  try { return code === 0 ? JSON.parse(stdout.trim().split('\n').pop()).text || '' : ''; } catch { return ''; }
}

// The stage writes below are afterWrite: a job-list read asked after one must not join a read that began before it (shared-read.js), whoever
// asked (a session's Cancel, a row's menu, the extension's submit report). test/job-writes.test.js finds every one by its engine command.
// A session ended without a submission: the job goes back from Applying to Kit ready (in Notion first).
// Why (#2758, 1 Nov 2026): a write whose new stage the engine's own answer states is held in the Jobs reads (view-cache.js withHeldWrites), as setStatus's is; Notion lists a write late.
export const unapply = afterWrite(async (storage, url) => {
  const {stdout} = await run(storage, ['src.desktop', 'unapply', url]);
  const result = JSON.parse(stdout.trim().split('\n').pop() || '{"ok":false}');
  if (result.ok && result.notion === 'updated') viewCache.statusChanged(storage, url, 'unreviewed', 'Kit ready');
  return result;
});
// The owner says an Applied was wrong (the extension inferred a submission that never happened): the engine puts the
// stage back to Applying and trashes the false 📈 Applied event. Only a bare Applied is undone (src/desktop.py).
export const notSubmitted = afterWrite(async (storage, url) => {
  const {stdout} = await run(storage, ['src.desktop', 'not-submitted', url]);
  const result = JSON.parse(stdout.trim().split('\n').pop() || '{"ok":false}');
  if (result.ok && result.notion === 'updated') viewCache.statusChanged(storage, url, 'applied', 'Applying');
  return result;
});
// The user said how an application went (desktop/lib/outcomes.js): the same stage event the Gmail check writes, in Notion.
export const markOutcome = afterWrite(async (storage, url, stage) => {
  const {code, stdout} = await run(storage, ['src.notion.ledger', 'event', url, stage, '--note', 'Marked in Jobadabra', '--source', 'CLI']);
  const last = stdout.trim().split('\n').filter(Boolean).pop() || '';
  return code === 0 ? {ok: true, stage} : {ok: false, error: last || 'It was not saved. Try again.'};
});
// A dismissed job deleted (src/desktop.py delete_job): its Notion pages to the trash, the local copy a marker.
export const deleteJob = afterWrite(async (storage, url) => {
  const {stdout} = await run(storage, ['src.desktop', 'delete', url]);
  let result; try { result = JSON.parse(stdout.trim().split('\n').pop() || '{}'); } catch { return {ok: false, error: 'The app could not read the answer.'}; }
  if (result.ok) viewCache.jobDeleted(storage, url);   // out of the saved list, and held out of the reads while Notion lists it late
  return result;
});
// Settings → Clear my job list (src/clear_jobs.py): `dryRun` only counts; the person's own dismissals are always kept.
export const clearJobs = afterWrite(async (storage, {dryRun = false} = {}) => {
  const {stdout} = await run(storage, ['src.desktop', 'clear-jobs', ...(dryRun ? ['--dry-run'] : [])]);
  try { return JSON.parse(stdout.trim().split('\n').pop() || '{}'); } catch { return {ok: false, error: 'The app could not read the answer.'}; }
});
export const setStatus = afterWrite(async (storage, url, status) => {
  const {stdout} = await run(storage, ['src.desktop', 'status', url, status]);
  const result = JSON.parse(stdout.trim().split('\n').pop() || '{}');
  if (result.ok) viewCache.statusChanged(storage, url, status, result.stage);   // whoever asked: the row's menu, a session's Skip or Close, the extension's report
  return result;
});
