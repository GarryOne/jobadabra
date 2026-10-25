// Recent activity: run names, phases, outcomes, the Gmail connection and the card chooser (cardFor).
// Split out of activity.js as a pure move. Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js) and the e2e activity suites.
import {billingLabel} from '../ai-engine-view.js';
import {claudeHelp} from '../claude-help.js';
import {AI_BUSY, groupWarnings, humanError, limitedJobs, sentences} from '../run-warnings.js';
import {aiLimitHead, failedOutcome, stoppedHead, deliveryHead, notConnectedHead, waitedHead, unsavedRun} from '../run-status.js';
import {el} from '../components.js';
import {parseRunMessage} from '../run-cards.js';
import {parseVisits} from '../visits-card.js';
import {mailCardShown, parseMailReport} from '../mail-report.js';
import {parseInsight} from '../insight-card.js';
import {parseWeekly} from '../weekly-card.js';
import {parseInterviewReview} from '../interview-review.js';
import {parseKitsReady} from '../kits-ready.js';
import {openSetting} from './settings.js';
import {$} from './core.js';
import {lastAnswered, pendingMailQuestions} from './focus.js';
import {keepPress, setPress, pressWhile, claudeReadButton, renderVisitsCard, viewJobsButton} from './activity-visits.js';
import {lastActivity, renderActivity} from './activity-render.js';
import {renderRunCard} from './activity-run-card.js';
import {renderMailCard} from './activity-mail.js';
import {renderInsightCard, renderInterviewCard, renderKitsCard, renderWeeklyCard} from './activity-cards.js';
import {storeName} from '../store-words.js';
import {WORDS} from '../run-result-card.js';

// ---------- runs ----------
export const clockTime = iso => new Date(iso).toLocaleString([], {weekday: 'short', hour: '2-digit', minute: '2-digit'});
export const duration = (a, b) => { const s = Math.round((Date.parse(b) - Date.parse(a)) / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`; };
// The line under "Jobs": what's happening now, or when the last search ran.
export async function showSearchStatus() {
  const {running, lastSearchAt, runs} = await window.pilot.runs();
  const box = $('search-status');
  const [title, detail] = [box.querySelector('b'), box.querySelector('small')];
  const searching = running && (running.kind || 'search') === 'search';
  box.dataset.state = searching ? 'busy' : lastSearchAt ? 'ok' : 'none';
  // Running: a link to its progress (the bottom bar's panel); done: what it found.
  if (searching) { title.textContent = 'Finding jobs →'; detail.textContent = searchPhase(running.step) || 'Starting…'; return; }
  if (!lastSearchAt) { title.textContent = 'No check yet'; detail.textContent = ''; return; }
  const last = runs.find(run => (run.kind || 'search') === 'search');
  const found = last?.new != null ? ` · ${last.new} new match${last.new === 1 ? '' : 'es'}` : '';
  const cost = billingLabel(last || {}) ? ` · ${billingLabel(last)}` : last?.usd ? ` · $${last.usd.toFixed(2)}` : '';
  if (last && !last.ok) { title.textContent = 'Last check had problems →'; detail.textContent = clockTime(lastSearchAt); return; }
  title.textContent = `Checked ${clockTime(lastSearchAt)}${found}${cost}`;
  detail.textContent = '';
}

// ---------- activity bar (bottom of every screen) ----------
// Plain-language phases of a search, recognised from its log lines.
export const PHASES = [
  {match: /^(Searching job boards|Job boards:)/, label: 'Job boards'},
  {match: /^Checking employer career pages/, label: 'Employer career pages'},
];
// A running task's step as words, wherever it is shown (Actions banner and summary, header, bottom bar): a known phrase, else the engine's line
// without its technical tail (7 Oct 2026: "Scored 60 of 60 job(s) with claude-sonnet-5-5; 0 failed; tokens in 120 (+173594 cached), out 22743").
export function stepWords(step = '') {
  return searchPhase(step) || String(step).split(';')[0].replace(/\s+with claude-[\w.-]+/g, '').replace(/\s*\(\+?[\d,]+ cached\)/g, '').trim();
}
// A "⏳ <step>: N of M …" counter line as its words, or '' (the app's own "⏳ Still running" heartbeat is not a counter).
export const liveCount = (line = '') => (/^⏳\s*(?!Still running)(.+: \d[\d,]* of \d[\d,]*.*)$/.exec(line) || [])[1] || '';
// A search's current log line as a short phrase for the header and the bottom bar (the raw line is in the log).
export function searchPhase(step = '') {
  const live = liveCount(step);   // the engine's own counter (src/progress.py): "Reading employer job sites: 120 of 202 · 3,412 jobs listed"
  if (live) return live;
  const phase = PHASES.find(item => item.match.test(step));
  if (phase) return phase.label;
  if (/^Scored (\d+) of (\d+)/.test(step)) return 'Matching jobs to your profile';
  if (/^Enriched (\d+) of (\d+)/.test(step)) return 'Reading new jobs';
  if (/^Checked: /.test(step)) return 'Employer career pages';
  if (/^Job Matches:/.test(step)) return `Saving to ${storeName()}`;
  if (/digest|telegram/i.test(step)) return 'Sending your digest';
  return step.length > 60 ? `${step.slice(0, 57)}…` : step;
}
// icon: emoji for text the owner reads (toasts, messages); line: the line icon for rows and headers (same as Actions → Recent runs).
export const KIND = {search: {icon: '🔎', line: 'search', name: 'Find jobs'}, mail: {icon: '📧', line: 'mail', name: 'Gmail check'}, insight: {icon: '💡', line: 'chart', name: 'Insight'},
  interviewInsight: {icon: '💡', line: 'bulb', name: 'Interview insights'}, tailor: {icon: '✂️', line: 'scissors', name: 'Tailor CV + cover letter'}, visits: {icon: '🌐', line: 'globe', name: 'Find jobs using your browser'},
  weekly: {icon: '📊', line: 'file', name: 'Search analysis'}, kits: {icon: '📝', line: 'file-text', name: 'Prepare top matches'}, today: {icon: '📋', line: 'send', name: "Today's list"}, scout: {icon: '🔭', line: 'building', name: 'More employers'},
  action: {icon: '⚡', line: 'zap', name: 'Telegram action'}, prepare: {icon: '📝', line: 'file-text', name: 'Application kit'}, interview: {icon: '🎤', line: 'mic', name: 'Interview review'},
  add: {icon: '📥', line: 'inbox', name: 'Logged activity'}, import: {icon: '➕', line: 'search', name: 'Add a job'}, rejection: {icon: '🔍', line: 'search', name: 'Rejection review'},
  prep: {icon: '🎤', line: 'mic', name: 'Interview prep kit'}};
export const KITS_CARD = new Set(['kits', 'prepare', 'tailor']);   // the runs whose result is a list of jobs on the kits card
export const kindOf = run => (KIND[run?.kind] ? run.kind : 'search');
export const WHO = {schedule: 'scheduled', you: 'by you', first: 'first check'};
export const WHERE = {github: 'GitHub', mac: 'this Mac', cloud: 'our servers'};  // where a run ran, after who started it
// The warnings in one plain sentence (the list is one click away).
export function warningSummary(warnings) {
  // The Anthropic account's spending limit: jobs were left unscored. Said plainly, with what to do.
  const limited = limitedJobs(warnings);
  if (limited && warnings.some(text => /Claude Code/.test(text))) {  // the user's own Claude Code: its plan's usage window
    return `Your Claude usage window is exhausted (or Claude Code is signed out), so ${plural(limited, 'job')} ${limited === 1 ? 'wasn\'t' : 'weren\'t'} scored. `
      + 'The next check scores them once your plan\'s limit resets; Settings → Connections → AI shows Claude Code\'s status.';
  }
  if (limited) {
    return `Your Anthropic API spending limit was reached, so ${plural(limited, 'job')} ${limited === 1 ? 'wasn\'t' : 'weren\'t'} scored. `
      + 'Raise the limit at console.anthropic.com → Settings → Limits; the next check scores them.';
  }
  // The same limit stopped a step that scores nothing (a Gmail check's own AI call, an insight): say that, not the
  // API's error dump.
  if (warnings.some(text => /usage limits?|credit balance|AI limit reached|spending limit/i.test(text))) {
    return 'Your Anthropic API spending limit was reached, so this step couldn\'t finish. '
      + 'Raise the limit at console.anthropic.com → Settings → Limits; the next check runs it again.';
  }
  if (warnings.some(text => AI_BUSY.test(text))) {
    return 'The AI service is busy (rate limit), so some jobs may not be scored yet. Try again in a few minutes.';
  }
  if (warnings.some(text => /429|Too Many Requests/i.test(text))) {
    return 'Notion was busy (rate limit): saved settings were used and some Notion steps were skipped. They run again next time.';   // about Notion
  }
  // Otherwise the warnings in plain words (run-warnings.js groupWarnings): one or two said here, more under "View N details".
  const plain = groupWarnings(warnings);
  if (plain.length) return sentences(plain, plain.length > 2);
  return humanError(warnings[0]) || '';
}
// "<task> completed with warnings": which run it is, said in the box's title.
export const WARN_NOUN = {search: 'Job search', scout: 'Employer search', mail: 'Gmail check', tailor: 'Tailoring', visits: 'Site reading', kits: 'Kit drafting',
  weekly: 'Search analysis', insight: 'The insight', today: 'Today’s list'};
export const runResults = new Map();  // run id -> the message a finished task produced, for Recent activity
export const runDetails = new Map();  // a Notion run's result and log, read once (pageId -> {message, log})
// Find jobs using your browser' step card (renderer/visits-card.js parseSiteRows): the meter (the few-jobs box's score-track) and one row per site.
const SITE_MARK = {next: 'todo', opening: 'now', waiting: 'warn', reading: 'now', done: 'done', stopped: 'fail', closed: 'fail'};
// How far a running task is, over the shared meter: Find jobs using your browser ("N of M sites"), and any task whose live step counts (owner, 7 Oct 2026: "a live
// progress bar above the Technical log"): Find new employers' "checked 33 of 91", a search's "Reading employer job sites: 120 of 202".
export function runProgress({done, total, percent}, noun = '') {
  const li = el('li', 'run-progress');
  const track = el('span', 'score-track'), fill = el('span', 'score-fill');
  fill.style.width = `${percent}%`;
  track.append(fill);
  li.append(el('span', '', `${done} of ${total}${noun ? ` ${noun}` : ''} · ${percent}%`), track);
  return li;
}
// The one thing to do on a row, as a link after its words (as "Explain with AI"): a wait on you, a tab to look at, a tab you closed, a silent extension.
// Each row's one action, a button on its right (owner, 7 Oct 2026: "per row, on the right, Open in Chrome"): the tab while it reads, the site
// once it is done, Allow while it waits on you, Open again for a tab you closed, the extension when it did not answer.
function siteAction(site) {
  if (site.state === 'waiting') return ['Go to Chrome and allow', () => window.pilot.focusBrowser()];
  if (site.state === 'reading' || site.state === 'opening') return ['Open in Chrome', () => window.pilot.visitShowTab(site.url)];
  if (site.state === 'closed') return ['Open again', () => window.pilot.visitAgain(site.url)];
  if (site.state === 'stopped' && /no answer from the extension|did not answer/.test(site.words)) return ['Check the extension', () => openSetting('extension')];
  if (site.state === 'next') return null;   // not opened yet: no tab to show
  return ['Open in Chrome', () => window.pilot.openVisit(site.url)];   // done or stopped: the site itself
}
// live: the run is going. A finished run keeps its rows and marks (owner, 7 Oct 2026: "keep the ticks and crosses after the task completes"),
// without the links that act on a running tab; a site the run left mid-way reads as stopped there, not as still going.
const settled = site => (['done', 'stopped', 'closed'].includes(site.state) ? site : {...site, state: 'stopped', words: `${site.words.replace(/…$/, '')}: the run ended here`});
export function siteRow(site, live = true, since = '') {
  if (!live) site = settled(site);
  const li = el('li', `${SITE_MARK[site.state] || 'todo'} site-row`);
  const words = el('div', 'site-words', site.name);
  words.append(el('span', 'phase-note', capital(site.words)));
  li.append(words);
  const viewJobs = site.state === 'done' && viewJobsButton(site, site.words, since);   // more than one new job: Jobs filtered to them
  if (viewJobs) li.append(viewJobs);
  // A finished run keeps only what still makes sense: the site itself, or the extension check (not a running tab's actions).
  // A finished run's stopped site: Read with Claude beside Open in Chrome (= Open it myself), as the result card's row had them.
  const finishedMiss = !live && ['stopped', 'closed'].includes(site.state);
  if (finishedMiss && site.url && claudeHelp() && !/no answer from the extension|did not answer/.test(site.words)) li.append(claudeReadButton(site, words));   // only with Claude help on (claude-help.js)
  const action = site.url && (finishedMiss && site.state === 'closed' ? ['Open in Chrome', () => window.pilot.openVisit(site.url)] : siteAction(site));
  if (action && (live || ['done', 'stopped', 'closed'].includes(site.state))) {
    const key = `site:${site.url}:${action[0]}`;
    const button = keepPress(key, Object.assign(el('button', 'secondary item-action', action[0]), {type: 'button', title: site.url}));
    button.addEventListener('click', async () => {
      const done = await pressWhile(key, '', async () => action[1]()).catch(error => ({ok: false, error: error.message}));
      if (done?.ok === false) setPress(key, {text: done.error || 'Could not do it now'});
    });
    li.append(button);
  }
  return li;
}
// A phase's label, with the sources the engine said it used ("Job boards: jobs.ch, …") instead of a fixed list.
export function phaseLabel(phase, lines) {
  const named = phase.match.test('Job boards:') && lines.map(line => /^Job boards: (.+)/.exec(line)).filter(Boolean).pop();
  // The boards by name, without the engine's own notes after them ("(Swiss place word: <a regex>)").
  return named ? `${phase.label} (${named[1].replace(/\s*\([^()]*:.*$/, '').trim()})` : phase.label;
}
export function phaseIndex(lines) {
  let index = -1;
  lines.forEach(line => PHASES.forEach((phase, i) => { if (phase.match.test(line)) index = i; }));
  return index;
}
export const hhmm = ms => new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const capital = text => String(text || '').replace(/^./, c => c.toUpperCase());
// One line on what a finished run did.
export function outcome(run) {
  const said = outcomeOf(run);
  return deliveryHead({...run, kind: kindOf(run)}) ? `${capital(said)} · Telegram not sent` : said;
}
function outcomeOf(run) {
  if (run.stopped === 'you') return 'Stopped by you · what it saved is kept, the next run continues';
  // Closed while it ran (lib/pipeline.js INTERRUPTED): said as such, as its box does (7 Oct 2026: the row read "Unexpected error")
  if (run.interrupted) return 'Interrupted · Jobadabra was closed while this ran; run it again to continue';
  const explained = notConnectedHead(run) || waitedHead({...run, kind: kindOf(run)});
  if (explained) return explained.short;   // the box says the rest
  const stopped = stoppedHead({...run, kind: kindOf(run)});
  if (stopped) return `Stopped · ${stopped.stopped}`;   // the watchdog stopped it: the box says why and where
  if (run.problem && (kindOf(run) === 'mail' || !run.ok)) return run.problem;   // why it read nothing or did not arrive comes before the counts a Notion row says (#290, #298)
  if (aiLimitHead({...run, kind: kindOf(run)})) return 'results unavailable';   // the AI provider stopped it: the box says why
  const failed = failedOutcome(run);
  if (failed) return failed;   // a failed run says so before what its Notion row reports (#301)
  if (!run.ok && !run.problem && !run.live && !run.waiting) return 'Unexpected error';   // no reason recognised: the box says what to do
  if (run.result) return run.result;  // a run read from Notion ⏱️ Search runs says it itself
  if (unsavedRun(run)) return 'its result was not saved';   // the pill says No result (run-status.js)
  if (kindOf(run) === 'mail') {
    if (run.off) return 'Gmail not connected (Settings → Connections)';
    if (run.problem) return run.problem;
    if (!run.ok) return 'had problems';
    if (run.updates?.length) return plural(run.updates.length, 'application update');
    // "Mail: 2 new email(s) classified, 0 update(s), …": emails were read but none changed an application.
    const read = Number(/^Mail: (\d+) new email/.exec(run.summary || '')?.[1] || 0);
    return read ? `${plural(read, 'email')} checked · no updates` : 'nothing new';
  }
  if (!run.ok) return 'had problems';
  // A one-off job (insight, weekly report, today's list, find employers): the result line it printed.
  // An employers search or today's list says its number from its message (run-result-card.js WORDS), as its result card's top does: never "done".
  const card = !run.summary && WORDS[kindOf(run)] && run.message ? parseRunMessage(run.message) : null;
  if (kindOf(run) !== 'search') return run.summary || (card ? WORDS[kindOf(run)](card) : 'done');
  return run.new != null ? plural(run.new, 'new job') : 'done';
}
// An Actions page command waits for its run (by kind) to end, then its answer shows the result.
// A Google sign-in that failed during a run, with Gmail working now: the run stays as it was, without the obsolete button.
export const GOOGLE_SIGNIN = /Google sign-in/i;
export const signedInSince = head => (head && GOOGLE_SIGNIN.test(head.problem || '') && gmailConnected() === true
  ? {...head, title: 'Google sign-in failed during this run', summary: 'Gmail is connected now. You can run another check.', hint: '', fix: null} : head);
// Whether Gmail is connected now (true / false / null = not known yet): Settings keeps the last check (localStorage
// 'serviceChecks'); it is read again from the app when Recent activity opens. A run's own state is history, not this.
let gmailNow = null;
export const gmailConnected = () => {
  if (gmailNow !== null) return gmailNow;
  try { return JSON.parse(localStorage.getItem('serviceChecks') || 'null')?.google?.connected ?? null; } catch { return null; }
};
export async function refreshGmailConnection() {
  const was = gmailConnected();
  gmailNow = await window.pilot.googleStatus().then(google => !!google?.connected).catch(() => null);
  if (gmailNow !== was && lastActivity) renderActivity(lastActivity);
}
// A kind's Run button on the Actions page (its data-command), or nothing for a kind without one.
export const runButton = kind => {
  if (kind === 'tailor') return document.getElementById('tailor-top');   // no Telegram command: its own button
  if (kind === 'visits') return document.getElementById('visits-run');
  const command = Object.keys(COMMAND_KIND).find(key => COMMAND_KIND[key] === kind);
  return command ? document.querySelector(`button.action[data-command="${command}"]`) : null;
};
export const COMMAND_KIND = {insight: 'insight', weekly: 'weekly', today: 'today', kits: 'kits', mail: 'mail', run: 'search'};
// Buttons outside the Actions cards that start the same task (Jobs → Refresh jobs, Settings → Check Gmail now, Tailor's own card): turned off while
// it runs (runs-page.js syncRunButtons) and left out of ⌘K when an Actions card already offers it (nav.js paletteCommands), so a task is listed once.
export const TASK_BUTTONS = [['search', '#refresh'], ['mail', '#check-mail'], ['tailor', '#tailor-top', '#tailor-top-n'], ['visits', '#visits-run', '#visits-at-once', '#board-run']];
// The Actions page's result card: a finished task's header (what, how it ended, when) over the Recent activity card.
// The card a finished run's message makes, as a function that draws it into a card box, or null when the message has no card shape (then it is shown as text).
// One place for both views: the Actions page and Recent activity must never show the same run as a card in one and as Telegram text in the other (5 Oct 2026:
// "Search analysis" was raw text on the Actions page, with its emoji lines and a bare Notion address).
// A Gmail check's card, wherever the run came from: a Notion row (its report lines and result) or a run this Mac kept
// (its `updates` from the log and a "Mail: …" summary). Always on and on-the-Mac runs read the same card (6 Oct 2026: a
// Mac run's "💬 Reply received · …" was a bare bullet, and "1 new email read, 0 updates" had no card at all).
export function mailReportOf(run, message = run?.message) {
  if (!run || kindOf(run) !== 'mail' || !mailCardShown(run)) return null;
  const rows = run.report?.length ? run.report : run.updates?.length ? ['', ...run.updates] : [];
  return parseMailReport(message || '', run.result || run.summary || '', rows);
}
export function cardFor(run, text) {
  const card = text ? parseRunMessage(text) : null;
  if (card) return target => renderRunCard(card, run, target);
  const mail = mailReportOf(run, text === run?.result ? '' : text);
  if (mail) return target => renderMailCard(mail, pendingMailQuestions(), lastAnswered(), target);
  if (!text) return null;
  const insight = parseInsight(text);
  if (insight) return target => renderInsightCard(insight, target);
  const weekly = parseWeekly(text);
  if (weekly) return target => renderWeeklyCard(weekly, target);
  const review = kindOf(run) === 'interview' ? parseInterviewReview(text) : null;
  if (review) return target => renderInterviewCard(review, target);
  const kits = KITS_CARD.has(kindOf(run)) ? parseKitsReady(text) : null;
  if (kits) return target => renderKitsCard(kits, target);
  const sites = parseVisits(text);
  if (sites) return target => renderVisitsCard({...sites, since: run?.startedAt}, target);
  return null;
}

