// Owns: the tracked tasks the Mac starts: refresh (Find jobs), syncMatches, checkMail, scout, work, task, scoreVisits, mailResult.
// Each runs its engine commands through run() and is queued, shown and recorded by tracked() (pipeline-queue.js).
// Guarded by: test/mail-report.test.js, test/run-join.test.js, test/run-note.test.js, test/run-cards.test.js, test/run-kinds.test.js, test/stop-task.test.js.
// Split out of pipeline.js (a pure move); pipeline.js re-exports everything.
import {engineOf, familyOfEngine} from './ai/names.js';
import {deliveryProblem, mailProblem as mailProblemFrom} from './run-result.js';

import {mailArgs, SCOUT_BUDGET_S, syncMatchesArgs, deliveryReady, triggerEnv, visitsArgs} from './pipeline-args.js';
import {appMessage, failedLine, taskSummary} from './pipeline-lines.js';
import {tracked} from './pipeline-queue.js';
import {run} from './pipeline-run.js';
import {searchSteps} from './search-steps.js';
import {searchDone} from './search-report.js';
import {offer as offerBrowserReads} from './refused-offer.js';

// note: what this search is for beyond a refresh ("Re-scoring 75 older scores"), shown on its row from queued to finished.
export function refresh(storage, onLine, mode = 'run', trigger = 'you', {note = '', employers = false} = {}) {
  return tracked(storage, 'search', trigger, onLine, tee => searchOnce(storage, tee, mode, trigger, employers), {mode}, (record, log) => {
    const problem = deliveryProblem(log);   // the digest the bot could not deliver: said on the run, not only as "Failed"
    let summary = {};
    try { summary = JSON.parse(storage.readText('data/reports/last-run.json')); } catch {}
    const fresh = summary.started_at && Date.parse(summary.started_at) >= record.id - 60000;
    return {...(problem ? {problem} : {}), ...(fresh ? {found: summary.jobs ?? null, feeds: summary.feeds ?? null, new: summary.new ?? 0, changed: summary.changed ?? 0,
      scored: summary.score?.done ?? summary.score?.scored ?? null, usd: summary.usd ?? 0, warnings: summary.warnings || []} : {})};
  }, {note});
}
export function syncMatches(storage, onLine, trigger = 'you') {
  return tracked(storage, 'search', trigger, onLine, tee => run(storage, syncMatchesArgs(), tee, triggerEnv(trigger))
    .then(({code, result}) => ({ok: code === 0, result})), {mode: 'today'}, () => ({}));
}
// A check that ended normally (exit 0, so a GitHub run isn't marked crashed) without reading the mail: why, or null.
export function mailProblem(stdout, result, family = 'claude') {
  return mailProblemFrom(stdout, result, family);
}
export function checkMail(storage, onLine, trigger = 'you') {
  let off = false, problem = null;
  return tracked(storage, 'mail', trigger, onLine, async tee => {
    const {code, stdout, result} = await run(storage, mailArgs(storage), tee, triggerEnv(trigger));
    off = /Gmail \+ Calendar is off/.test(stdout);
    problem = code === 0 ? mailProblem(stdout, result, familyOfEngine(engineOf(storage))) : null;
    // lastMailAt paces the schedule (a failed or "not connected" check waits for the next time too);
    // lastMailOkAt sets how far back the next check looks: only a check that read the mail moves it.
    const at = new Date().toISOString();
    const ok = code === 0 && !problem;
    storage.saveSettings({lastMailAt: at, ...(ok && !off ? {lastMailOkAt: at} : {})});
    return {ok, result};
  }, {}, (record, log) => ({...mailResult(log), off, problem}));
}
// What a Gmail check recorded and its "Mail: …" summary line (also read from GitHub runs' logs, cloud-runs.js).
export function mailResult(log) {
  const start = log.indexOf('Updates:');
  // The update lines sit between "Updates:" and the "Mail: …" summary; what follows (the run-log link) isn't one.
  const after = start < 0 ? [] : log.slice(start + 1);
  const end = after.findIndex(line => /^Mail: /.test(line));
  const updates = (end < 0 ? after : after.slice(0, end)).filter(line => /^\S/.test(line) && !/^Cronjob run logged/.test(line));
  return {updates, summary: log.filter(line => /^Mail: /.test(line)).pop() || null};
}
// Find new employers (the scout), from the button, Telegram or the schedule; its time paces the next one.
// paste: a file holding a page the person pasted (Employers → Add from a page): its companies are checked first (src/scout_paste.py).
export function scout(storage, onLine, trigger = 'you', batch = null, {paste = ''} = {}) {   // null: the engine's own size for the queue (src/scout.py batch_for)
  const send = deliveryReady(storage) ? ['--send'] : [];  // no Telegram: the app shows it
  storage.saveSettings({lastScoutAt: new Date().toISOString()});
  return task(storage, 'scout', ['src', 'scout', ...send, '--log-run', ...(batch ? ['--batch', String(batch)] : []), ...(paste ? ['--paste-file', paste] : []),
    '--budget', String(SCOUT_BUDGET_S)], onLine, trigger, paste ? {note: 'Companies from a page you pasted'} : {});
}
// A tracked task whose work is the app's own code, not an engine command (Tailor CVs): the same banner, live log, history row and result line. Not resumed after a restart.
// Stop (owner, 7 Oct 2026: "I miss a Stop button"): doWork gets an AbortSignal and ends at its next step; the engine commands it runs are ended as for any task.
export function work(storage, kind, onLine, doWork, trigger = 'you') {
  // A task that failed says why: its first "✗ <what>: <why>" line (7 Oct 2026: a browser run where Tiffany never started read "stopped
  // unexpectedly · No final result was recorded", though its reason was right under it).
  return tracked(storage, kind, trigger, onLine, async (tee, signal) => ({ok: !!(await doWork(tee, signal))}), null,
    (record, log) => ({summary: taskSummary(kind, log), message: appMessage(log), ...(record.ok ? {} : {problem: failedLine(log)})}));
}
export function task(storage, kind, args, onLine, trigger = 'you', {note = ''} = {}) {
  return tracked(storage, kind, trigger, onLine, async tee => {
    const {code, result} = await run(storage, args, tee, triggerEnv(trigger));
    return {ok: code === 0, result};
  }, {args}, (record, log) => ({summary: taskSummary(kind, log), message: appMessage(log)}), {note});
}
function searchOnce(storage, onLine, mode, trigger = 'you', employers = false) {
  return (async () => {
    const startedAt = new Date().toISOString();   // "Your search changed" compares with when a refresh began, not ended (renderer/search-changed.js)
    const {code, result} = await searchSteps(storage, onLine, mode, trigger, undefined, {employers});
    storage.saveSettings({lastSearchAt: new Date().toISOString(), lastSearchStartedAt: startedAt, lastSearchOk: code === 0});
    searchDone({startedAt, ok: code === 0, stopped: code === null, trigger});
    if (code !== null) offerBrowserReads(storage, run).catch(() => {});   // the run offers "Find jobs using your browser" for the sites that refused it; it never reads them (lib/refused-offer.js)   // the search report (lib/search-report.js), when Technical reports are on
    return {ok: code === 0, result};
  })();
}

export function scoreVisits(storage, onLine, trigger = 'you') {
  return tracked(storage, 'today', trigger, onLine, async tee => {
    tee('Scoring the jobs read in Chrome, on this Mac…');
    const {code, result} = await run(storage, visitsArgs(storage), tee, triggerEnv(trigger));
    return {ok: code === 0, result};
  }, null, () => ({}), {first: true});
}
