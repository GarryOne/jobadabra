// Recent activity: renderActivity, the Recent activity panel redraw, its panel height and its list state.
// Split out of activity.js as a pure move. Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js) and the e2e activity suites.
import {billingLabel} from '../ai-engine-view.js';
import {groupWarnings, limitedJobs, newDetails, runWarningLines, stepNote} from '../run-warnings.js';
import {aiLimitHead, barState, failureHead, phaseStatus, runPill, runWarned, stoppedHead, deliveryHead, notConnectedHead, notChecked, waitedHead, stepCount} from '../run-status.js';
import {el, moreButton, pill, tag} from '../components.js';
import {icon} from '../icons.js';
import {cardText, emptyResult, markFallback, newJobsShown, parseRunMessage, plainMessage} from '../run-cards.js';
import {parseSiteRows, parseVisits, rerunSites} from '../visits-card.js';
import {employersAdvice} from '../onboarding.js';
import {settleQuestion} from '../mail-report.js';
import {parseInsight} from '../insight-card.js';
import {parseWeekly} from '../weekly-card.js';
import {parseInterviewReview} from '../interview-review.js';
import {kitsOutcome, parseKitsReady} from '../kits-ready.js';
import {filterRuns, groupRuns, runTime} from '../run-list.js';
import {shared} from './shared.js';
import {seeded} from '../live-log.js';
import {showScheduleState} from './connections.js';
import {$, show} from './core.js';
import {lastAnswered, lastQuestions, pendingMailQuestions} from './focus.js';
import {remembered} from './nav.js';
import {readableLog} from '../human-log.js';
import {renderActionsPage} from './runs-page.js';
import {toastMessage} from './startup.js';
import {showStop} from '../stop-task.js';
import {clockTime, duration, PHASES, stepWords, liveCount, searchPhase, KIND, KITS_CARD, kindOf, WHO, WHERE, warningSummary, WARN_NOUN, runResults, runDetails, runProgress, siteRow, phaseLabel, phaseIndex, hhmm, plural, capital, outcome, GOOGLE_SIGNIN, signedInSince, gmailConnected, runButton, mailReportOf} from './activity-basics.js';
import {renderVisitsCard} from './activity-visits.js';
import {showAwaitedResult, keepStatusBar, withKept, byYou} from './activity-results.js';
import {showJumpToLatest, showRunJob, linked, refreshActivity, renderRunCard, renderCardSkeleton} from './activity-run-card.js';
import {renderMailCard} from './activity-mail.js';
import {renderInsightCard, renderInterviewCard, renderKitsCard, renderWeeklyCard} from './activity-cards.js';
import {kindFilter, barLabel, PANEL_KEY, panelMemory} from './activity-panel.js';
import {byStore} from '../store-words.js';
import {startSearch} from './jobs.js';
import {showPartial, splitPartial} from './activity-partial.js';
import {newJobsCard} from '../new-jobs-card.js';
export let lastActivity = null;
const RUNS_PAGE = 8;
let shownRuns = RUNS_PAGE;
export const showMoreRuns = () => { shownRuns += RUNS_PAGE; };
// The panel's height, as you drag its top edge: never smaller than this, never taller than 90% of the window, kept
// for the next time the app opens.
const PANEL_MIN = 320;
export const PANEL_HEIGHT = 'jobpilotto.activity-height';
const panelMax = () => Math.round(window.innerHeight * 0.9);
export function setPanelHeight(height, keep = true) {
  const value = Math.max(PANEL_MIN, Math.min(panelMax(), Math.round(height)));
  $('activity-panel').style.height = `${value}px`;
  if (keep) { try { localStorage.setItem(PANEL_HEIGHT, String(value)); } catch {} }
  return value;
}
export let foldedWarnings = '';    // the run whose warnings card is folded away, by id
export const setFoldedWarnings = value => { foldedWarnings = value; };
export let detailRunId = '';       // the run the detail pane is showing (the fold button needs to know)
// What the panel holds, for `npm run shot --eval` and a failing e2e step: which run is selected, which pages were read and what they gave.
const readTrace = [];   // each run-page read: started, then what came back (or the error)
window.__activity = () => ({selected: shared.selectedRun, shownId: detailRunId, reading: [...readingPages], trace: readTrace,
  details: [...runDetails].map(([page, read]) => ({page, message: !!read.message, log: (read.log || []).length}))});
const readingPages = new Set();  // run pages being read from Notion right now: their card shows as skeleton bars
// An answer given on Focus (or the card itself) reaches the open check's card as soon as Focus is read again.
window.addEventListener('focus-updated', () => { if (lastActivity) renderActivity(lastActivity); });
// Actions drawn from what the window already knows BEFORE it is shown (#286): its run banner and the result card of a run not seen yet were drawn at the next
// refresh, a moment after the page appeared, and pushed the task grid down under the person's pointer. openView calls this while the page is still hidden.
export function prepareActions() {
  if (!lastActivity) return;
  renderActionsPage(lastActivity);
  showAwaitedResult(lastActivity.runs, {opening: true});
}
// "Remove" on a queued row (and its ⌘K twin, nav.js): the task never starts; Recent activity is drawn again either way.
export async function unqueue(run) {
  const result = await window.pilot.unqueueTask(run.id).catch(error => ({ok: false, error: error.message}));
  if (!result.ok) toastMessage('Could not remove it', result.error || 'Try again.');
  refreshActivity();
}
function removeLink(run) {
  const link = el('span', 'run-link', 'Remove');
  Object.assign(link, {title: `Take ${KIND[kindOf(run)].name} out of the queue: it will not start`, tabIndex: 0});
  link.setAttribute('role', 'button');
  const go = event => { event.preventDefault(); event.stopPropagation(); unqueue(run); };
  link.addEventListener('click', go);
  link.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') go(event); });
  return link;
}

export function renderActivity(fresh) {
  if (!$('activity-panel').hidden) remembered(PANEL_KEY, panelMemory(true, shared.selectedRun));   // another run picked in the open panel
  const data = withKept(fresh);
  renderActionsPage(data);
  lastActivity = data;
  // Settings → Automation shows the same next times beside each schedule.
  shared.nextRuns = {search: data.nextSearchAt, mail: data.nextMailAt, scout: data.nextScoutAt};
  showScheduleState(shared.nextRuns);
  window.dispatchEvent(new Event('activity-updated'));   // Focus → Get started ticks the steps a finished run completed
  showAwaitedResult(data.runs);
  const {running, runs, nextSearchAt, nextMailAt, nextScoutAt} = data;
  if (!running) shared.idleSeen = true;
  else shared.logLines = seeded(running.log, shared.logLines);   // the app's copy wins when the window lost lines (reopened, ⌘R)
  const last = runs[0];
  const lastSearch = runs.find(run => kindOf(run) === 'search');
  const lastMail = runs.find(run => kindOf(run) === 'mail');
  $('activity').dataset.state = barState(running, lastSearch || lastMail || last);
  const liveLines = running ? shared.logLines : null;
  const mailNote = lastMail ? `Gmail ${notChecked(lastMail) ? 'not checked' : `checked ${clockTime(lastMail.endedAt || lastMail.startedAt)} · ${outcome(lastMail)}`}`
    : gmailConnected() === false ? 'Gmail not checked · not connected'   // #541: no "due now" for a check that cannot run
    : nextMailAt ? `First Gmail check ${nextMailAt <= Date.now() ? 'due now' : hhmm(nextMailAt)}` : '';
  if (running) {
    const kind = KIND[kindOf(running)];
    const next = (data.queued || []).length;
    $('activity-title').textContent = kindOf(running) === 'search' ? `Finding jobs${running.where === 'github' ? ' (on GitHub)' : ''}${next ? ` · ${next} queued` : ''}`
      : `${kind.icon} ${kind.name} running (${WHO[running.trigger] || running.trigger}${running.where === 'github' ? ', on GitHub' : ''})${next ? ` · ${next} queued` : ''}`;
    $('activity-step').textContent = stepWords(running.step) || 'Starting…';
    barLabel();
    $('activity-meta').textContent = [duration(running.startedAt, new Date().toISOString())].filter(Boolean).join(' · ');
  } else if (lastSearch || lastMail) {
    barLabel();
    $('activity-title').textContent = lastSearch ? (lastSearch.ok ? 'Last refresh' : 'Last refresh had problems') : 'No jobs check yet';
    $('activity-step').textContent = lastSearch ? `${clockTime(lastSearch.endedAt || lastSearch.startedAt)} · ${outcome(lastSearch)}` +
      (lastSearch.ok ? '' : ' · click to see why') : '';
    // The next jobs check, unless the open panel's Upcoming checks already says it.
    $('activity-meta').textContent = [mailNote, $('activity-panel').hidden && nextSearchAt && `Next refresh ${hhmm(nextSearchAt)}`].filter(Boolean).join(' · ');
  } else {
    $('activity-title').textContent = 'No search yet';
    $('activity-step').textContent = 'Click "Find jobs" on Jobs to start one.';
    $('activity-meta').textContent = mailNote;
  }
  if (!running) keepStatusBar();

  // Recent activity: newest first; click one to see its log below.
  const shown = runs.find(run => run.id === shared.selectedRun) || null;
  // Newest on top: the queued ones (the latest queued first), then the running one, then the finished ones.
  // Each queued one says what it waits for: the one queued before it, or the running task.
  const queue = data.queued || [];
  const waiting = queue.map((run, i) => ({...run, waiting: true,
    after: i ? KIND[kindOf(queue[i - 1])].name : running ? KIND[kindOf(running)].name : 'the current task'})).reverse();
  // The header's filter keeps one kind of run; the list then shows a page of them (queued and running first).
  const liveRows = filterRuns(waiting.concat(running ? [{...running, live: true}] : []), kindFilter, kindOf);
  const kept = filterRuns(runs, kindFilter, kindOf);
  const recent = liveRows.concat(kept.slice(0, shownRuns));
  $('activity-count').textContent = `${recent.length} recent`;
  show($('activity-filter'), runs.length > 1);
  $('activity-filter').classList.toggle('is-active', !!kindFilter);
  // One row: the task and what it found, where it ran, its AI cost, its time and its status pill. The time is its
  // own column (not part of the sentence), and the rows are grouped Today / Earlier (renderer/run-list.js).
  const recentRow = run => {
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'recent-row'});
    button.classList.toggle('current', run.live ? !shown : shown ? run === shown : run === last && !running);
    button.dataset.state = run.live ? 'busy' : run.waiting ? 'queued' : run.ok && !run.off ? 'ok' : 'error';
    const kind = KIND[kindOf(run)];
    // Its warnings: from the log (a run on this Mac), else the row's Status in Notion (a GitHub run: no log until opened).
    const warned = runWarned(run);

    if (warned) button.dataset.state = 'warn';
    const words = el('span', 'run-words');
    // A run's note says what it is for beyond its kind ("Re-scoring 75 older scores", lib/pipeline.js refresh), queued, running and done.
    words.append(el('b', 'run-kind', kind.name), el('span', 'muted run-what', run.live ? [`Running now`, run.note, searchPhase(run.step) || 'starting'].filter(Boolean).join(' · ') : run.waiting
      ? [run.note, `Waiting · starts after ${run.after}`].filter(Boolean).join(' · ')
      : [run.note, capital(outcome(run)), WHERE[run.where]].filter(Boolean).join(' · ')));
    if (byYou(run)) words.lastChild.prepend(tag('By you', {title: 'You started it (not a schedule)'}), ' ');
    // No cost and no live log here: the list is for finding a run and seeing its state; the log and the cost are in the detail pane.
    const when = el('span', 'run-time', run.live || run.waiting ? '' : runTime(run));
    if (run.live && run.where === 'github' && run.url) {
      const link = el('span', 'run-github', 'GitHub ↗');
      link.title = 'Open this run on GitHub';
      link.setAttribute('role', 'link');
      link.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); window.pilot.openExternal(run.url); });
      when.replaceChildren(link);
    }
    // A queued task can be taken out of the queue before it starts (owner, 7 Oct 2026): the same inline link as "GitHub ↗", not a button in a button.
    if (run.waiting && run.id) when.replaceChildren(removeLink(run));
    button.append(el('span', 'run-icon', icon(kind.line)), words, when, pill(...runPill(run)));
    button.addEventListener('click', () => { if (run.waiting) return; shared.selectedRun = run.live ? null : run.id; renderActivity(lastActivity);
      $('activity-recent').querySelector('.recent-row.current')?.focus({preventScroll: true}); });   // a click on a row (focused by the browser, then redrawn) keeps it too
    return button;
  };
  // Every redraw (a click, a refresh, a run's detail arriving) would drop the keyboard focus: if it was on a row, the current row gets it back.
  const keepFocus = $('activity-recent').contains(document.activeElement);
  $('activity-recent').replaceChildren(...groupRuns(recent).flatMap(group => [
    Object.assign(document.createElement('li'), {className: 'recent-group', textContent: group.label}),
    ...group.runs.map(run => { const item = document.createElement('li'); item.append(recentRow(run)); return item; })]));
  if (keepFocus) $('activity-recent').querySelector('.recent-row.current')?.focus({preventScroll: true});
  if (!recent.length) $('activity-recent').append(Object.assign(document.createElement('li'), {className: 'muted',
    textContent: runs.length ? `No ${KIND[kindFilter]?.name || kindFilter} runs here.` : 'Nothing has run yet.'}));
  // "View more": the runs the filter keeps that the list hasn't shown yet (they scroll in below).
  show($('activity-all'), kept.length > shownRuns);

  // How often: from Settings → How often (GitHub does it when Always on is on).
  const cloud = !!shared.state?.settings?.cloud?.repo;
  // A card per scheduled task: what, which day, and the time in large type (or why there's none).
  // "Gmail check · Today 18:00": its icon, what, and when (Today / Tomorrow / the weekday).
  const day = at => {
    const date = new Date(at), today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    return date.toDateString() === today.toDateString() ? 'Today' : date.toDateString() === tomorrow.toDateString() ? 'Tomorrow'
      : date.toLocaleDateString([], {weekday: 'short'});
  };
  const plan = {search: 4, mail: 3, scout: 'daily', ...(shared.state?.settings?.schedule || {})};
  // No time: "Off" only when Settings → Automation says so; else the app just doesn't know it yet (it was started
  // before an update: a restart fixes it), so it names where it runs.
  const unknown = cloud ? 'On GitHub' : 'On this Mac';
  const items = [['Find jobs', 'search', nextSearchAt, plan.search ? unknown : 'When you ask'], ['Gmail', 'mail', nextMailAt, plan.mail ? unknown : 'Off'],
    ...(cloud ? [['Employers', 'building', nextScoutAt, plan.scout !== 'off' ? unknown : 'Off']] : [])];
  const soonest = Math.min(...items.map(([, , at]) => at || Infinity));
  const gmailOff = gmailConnected() === false;   // Gmail as it is now, not as the selected run found it
  $('activity-schedule').replaceChildren(...items.map(([name, kind, at, none]) => {
    const item = el('span', `ap-item${at && at === soonest ? ' is-next' : ''}${at ? '' : ' is-off'}`);
    item.append(el('span', 'muted', name), ' ', el('b', '', at ? (at <= Date.now() ? 'Due now' : `${day(at)} ${hhmm(at)}`) : none));
    // A pill after the time, not a "Next:" before the name: that read as "Next Jobs" from a distance.
    if (kind === 'mail' && gmailOff) item.append(' ', pill('Connection required', 'warn'));   // the time stays; it won't check until connected
    else if (at && at === soonest) item.append(' ', el('span', 'ap-next', 'Next'));
    return item;
  }));
  // Check Gmail now: with a selected Gmail check, not in the schedule strip. While Gmail is not connected it connects it instead.
  const selected = shown || (running ? null : last);
  // A not-connected run's box already offers Connect Gmail: the header doesn't say it twice.
  show($('check-mail'), !!selected && kindOf(selected) === 'mail' && !(gmailOff && (selected.off || GOOGLE_SIGNIN.test(selected.problem || ''))));
  $('check-mail').textContent = gmailOff ? 'Connect Gmail' : 'Check Gmail now';
  $('check-mail').dataset.connect = gmailOff ? '1' : '';

  // The selected run (or the live / latest one): what it did, its phases, and its full log. A run read from
  // Notion brings its result and log from its page the first time it's shown.
  const picked = shown || (running ? {...running, live: true} : last);
  // A run recorded on this Mac has a log of its own but, when it was sent to Telegram (--send) or is a Gmail check, not
  // the message and report lines its Notion page holds: those are read from the page too, the local log kept (5 Oct 2026:
  // with Always on off, a Search analysis showed nothing and a Gmail check lost its header, as only GitHub runs read the page).
  const needsPage = r => !!r?.pageId && !r.live && (!r.log || !r.message || (kindOf(r) === 'mail' && !r.report?.length));
  const run = needsPage(picked) ? {...picked, ...runDetails.get(picked.pageId), ...(picked.log ? {log: picked.log} : {})} : picked;
  detailRunId = run?.id ?? '';
  if (needsPage(picked) && !runDetails.has(picked.pageId)) {
    const pageId = picked.pageId, hasLog = !!picked.log;
    readingPages.add(pageId);   // the card's skeleton bars show while the page is read, also for a local run that has its own log: the read waits its turn behind the app's other Notion calls (25 s+ right after a start) and the pane was empty meanwhile
    runDetails.set(pageId, hasLog ? {} : {log: [byStore('Reading from Notion…', 'Reading…')]});
    // A run that just finished may not have its log on its page yet (it's written a moment after the status):
    // an empty answer is read again a few times before it's kept.
    const read = (tries = 0) => (readTrace.push(`${pageId} read #${tries} asked`), window.pilot.runDetail(pageId)).then(detail => {
      readTrace.push(`${pageId} read #${tries} gave message=${!!detail?.message} log=${(detail?.log || []).length}`);
      const empty = !detail?.message && !(detail?.log || []).length;
      if (empty && tries < 4 && !hasLog) {
        runDetails.set(pageId, {log: [byStore('Waiting for the log from Notion…', 'Waiting for the log…')]});
        setTimeout(() => read(tries + 1), 5000);
      } else {
        readingPages.delete(pageId);
        runDetails.set(pageId, empty ? (hasLog ? {} : {log: [byStore('This run left no log on its Notion page.', 'This run left no log.')]}) : detail);
      }
      renderActivity(lastActivity);
    }).catch(error => { readTrace.push(`${pageId} read failed: ${error?.message || error}`); console.error('activity: a run page was not shown', pageId, error); readingPages.delete(pageId); renderActivity(lastActivity); });
    read();
  }
  // The log of the run shown, with what was read from its Notion page merged in (a GitHub run's log lives there).
  // A GitHub run has no local lines: the sidebar link opens the job. A local run streams shared.logLines.
  const githubLive = !!run?.live && run?.where === 'github';
  // The window's own buffer is empty after a reload (⌘R): then the app's copy of the running job's log (run.log) is what to show.
  const lines = githubLive ? (run?.log || []) : (shown ? run?.log || [] : (liveLines?.length ? liveLines : run?.log) || []);
  const kind = run ? KIND[kindOf(run)] : null;
  const detailWarnings = runWarningLines(run);
  // A result with only a few sources that did not answer keeps its card first: one small line under it, no box (pages/activity-partial.js); the step list does not say it again.
  const split = splitPartial(detailWarnings);
  const partial = run?.ok && !run.live && split.partial ? split : null;
  const stepWarnings = partial ? split.rest : detailWarnings;
  // The header: the run's name, its state as a pill, then one muted line — what it did, when it finished, how long it
  // took, what it cost and where it ran (the mockup's "Nothing new · Finished 18:06 · 62 s · GitHub").
  const status = !run ? null : runPill({...run, kind: kindOf(run)}, {long: true});
  $('activity-icon').replaceChildren(...(kind ? [icon(kind.line)] : []));
  $('activity-selected').textContent = run ? kind.name : 'Nothing has run yet';
  $('activity-status').replaceChildren(...(status ? [pill(...status)] : []));
  showStop($('activity-stop'), run?.live ? run : null);   // a task this Mac runs can be stopped from its detail too
  // What it found, without repeating the task's name ("Gmail check: 4 new emails…" → "4 new emails…").
  const shownText = cardText(run, run ? runResults.get(run.id) : null);
  // Its card says it better than the raw text, whole: the header doesn't repeat it cut short (a digest, an insight, a weekly report).
  const hasCard = !!(shownText && (parseRunMessage(shownText) || parseInsight(shownText) || parseWeekly(shownText)
    || (KITS_CARD.has(kindOf(run)) && parseKitsReady(shownText)) || parseVisits(shownText)));
  // A stopped run's box says why in full: the header doesn't repeat it.
  // A box that names what happened in full (stopped, couldn't start, stopped unexpectedly): the header doesn't repeat it.
  const boxSaysIt = run && (stoppedHead({...run, kind: kindOf(run)}) || waitedHead({...run, kind: kindOf(run)}) || ['unexpected', 'interrupted'].includes(failureHead({...run, kind: kindOf(run)})?.problem));
  const said = run && !run.live && !hasCard && !boxSaysIt ? capital(String(outcome(run)).replace(new RegExp(`^${kind?.name || ''}:\\s*`, 'i'), '')) : '';
  const seconds = run?.endedAt && run.startedAt ? Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000) : null;
  // A run that used no AI shows no cost: "$0" on every row was noise.
  const cost = run && !run.live && (billingLabel(run) || (run.usd > 0 && `AI $${run.usd < 0.01 ? run.usd.toFixed(3) : run.usd.toFixed(2)}`));
  $('activity-sub').textContent = !run ? '' : [
    run.note,
    run.live ? (searchPhase(run.step) || 'starting') : said,
    !run.live && `Finished ${hhmm(Date.parse(run.endedAt || run.startedAt))}`,
    !run.live && seconds > 0 && (seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`),
    cost,
    run.where === 'github' ? 'In the cloud' : '',   // owner, 24 Oct 2026: basics only here; who started it, the machine and counts live in Reports
    !run.live && run.telegram && 'Sent to Telegram',
  ].filter(Boolean).join(' · ');
  // A search that found new jobs: straight to them (newest first).
  const found = !run?.live && kindOf(run) === 'search' ? newJobsShown(run, shownText) : 0;   // the card's own count (run-cards.js)
  show($('activity-go'), found > 0);
  $('activity-go').textContent = `View new job${found === 1 ? '' : 's'} →`;
  // The header's one visible link, then the rest under ⋯: a Notion page is the run's record, its GitHub run the build
  // behind it. A GitHub-only run shows that link itself; with nothing else to offer there is no ⋯ at all.
  // A run's record opens only when it is a page somewhere (Notion); in the store on this Mac its link is only a key (store:cron_runs/<id>).
  const page = /^https:\/\//.test(run?.notionUrl || '') ? run.notionUrl : '';
  show($('activity-notion'), !!page);
  $('activity-notion').dataset.url = page;
  show($('activity-github'), !!run?.url && (!page || !!run?.live));
  $('activity-github').dataset.url = run?.url || '';
  $('activity-more').replaceChildren(...(run?.url && page && !run?.live
    ? [moreButton([{label: 'View GitHub run ↗', run: () => window.pilot.openExternal(run.url)}], 'More links')] : []));
  const result = run && !run.live ? runResults.get(run.id) || '' : '';
  $('activity-result').textContent = result;
  show($('activity-result'), !!result);
  showRunJob(!run?.live && kindOf(run) === 'add' ? run.job : null);
  const asked = lastQuestions();
  // A finished check's updates are the card's "What changed" (mailReportOf): listed here too they were a second box.
  const updates = !run?.live && kindOf(run) === 'mail' && !mailReportOf(run) ? (run.updates || []).map(text => settleQuestion(text, asked)) : [];
  const at = run && kindOf(run) === 'search' ? phaseIndex(lines) : -1;
  const stopped = run && stoppedHead({...run, kind: kindOf(run)});
  $('activity-phases').replaceChildren(...(updates.length ? updates.map(text => Object.assign(document.createElement('li'), {className: 'update', textContent: text}))
    : PHASES.map((phase, i) => {
      // The step a run that warned stopped at is not a clean tick: a refused AI call under "reading and scoring" must not look done (UI loop #51).
      const li = Object.assign(document.createElement('li'), {className: phaseStatus(run, i, at), textContent: phaseLabel(phase, lines)});
      // The step a stopped run was on says what it was doing and the last thing it reported.
      // The running step's live counter, outside the log (owner, 7 Oct 2026: "live updates on the job counter itself").
      const counter = run?.live && i === at ? lines.map(liveCount).filter(Boolean).pop() : '';
      if (counter) li.append(el('span', 'phase-note', counter));
      if (li.className === 'warn' && stepWarnings.length) li.append(el('span', 'phase-note', stepNote(stepWarnings)));   // why this step has the !
      if (i === at && stopped) li.append(...[stopped.doing && `Stopped while ${stopped.doing}.`, stopped.last && `Last reported: ${stopped.last}`].filter(Boolean).map(text => el('span', 'phase-note', text)));
      return li;
    })));
  // Find jobs using your browser: a row per tab it opens in Chrome, each at its state, and how far the run is (owner, 7 Oct 2026: "right now it's a black box").
  // The same step card and row marks as a search's steps, kept once it ends (its result card then adds the ways on for a stopped site).
  // While it runs only: once it ends, the sites are one list inside its result card, with the same marks and their buttons (owner, 7 Oct 2026),
  // read from the result message, which has every site (the kept log is cut to its last 400 lines).
  const tabs = run?.live && kindOf(run) === 'visits' ? parseSiteRows(lines) : null;
  const shownTabs = tabs && !run.live ? {...tabs, done: tabs.total, percent: 100} : tabs;   // a finished run: every site is settled (settled())
  if (tabs) $('activity-phases').replaceChildren(runProgress(shownTabs, 'sites'), ...tabs.sites.map(site => siteRow(site, !!run.live, run.startedAt)));
  const counted = run?.live && !tabs ? stepCount(run.step) : null;   // any other running task whose step counts
  // Over a search's steps; alone for any other task (the steps listed above are a search's only).
  if (counted) { if (at >= 0 || updates.length) $('activity-phases').prepend(runProgress(counted)); else $('activity-phases').replaceChildren(runProgress(counted)); }
  show($('activity-phases'), updates.length > 0 || at >= 0 || !!tabs || !!counted);
  // What a one-off job produced (the insight, the list, the report) when it wasn't sent to Telegram. Today's list and
  // Find new employers read better as a small card; anything else stays text. While its Notion page is still being
  // read, the card's own shape shows as skeleton bars, so the pane never looks half-built and then jumps.
  const card = (shownText ? parseRunMessage(shownText) : null) || (kindOf(run) === 'search' ? newJobsCard(run, lines) : null);   // no digest: the new jobs as a card
  // A Gmail check's message has no digest header but plenty of structure (the interview it is about, the topics to
  // strengthen, the recruiter's next step): it gets its own card, not its raw lines in a <pre>.
  const mail = !run?.live && !card ? mailReportOf(run) : null;
  // An insight is written to be sent, not read: its card is the finding, the numbers behind it and the one action
  // (the mockup, 30 Sep). Only what the insight carries is drawn — anything else is absent, never an empty slot.
  const insight = !card && !mail && shownText ? parseInsight(shownText) : null;
  // The week's report: the same card, with what worked and what to change in place of the finding's evidence.
  const weekly = !card && !mail && !insight && shownText ? parseWeekly(shownText) : null;
  // An interview review: the same card shape as the others, from the message src/ai/interviews.py wrote.
  const review = !run?.live && !card && !mail && !insight && !weekly && kindOf(run) === 'interview' && run?.message
    ? parseInterviewReview(run.message) : null;
  const kits = !run?.live && !card && !mail && !insight && !weekly && !review && KITS_CARD.has(kindOf(run)) && run?.message ? parseKitsReady(run.message) : null;
  if (kits) kits.outcome = kitsOutcome(kits, run.log);
  const sites = !run?.live && !card && !mail && !insight && !weekly && !review && !kits && run?.message ? parseVisits(run.message) : null;   // Find jobs using your browser
  const reading = !!run?.pageId && readingPages.has(run.pageId);
  show($('activity-help'), false);   // only a search card with few new jobs fills it
  if (card) renderRunCard(card, run);
  else if (mail) {
    renderMailCard(mail, pendingMailQuestions(), lastAnswered());
  }
  else if (insight) renderInsightCard(insight);
  else if (weekly) renderWeeklyCard(weekly);
  else if (review) renderInterviewCard(review);
  else if (kits) renderKitsCard(kits);
  else if (sites) renderVisitsCard({...sites, since: run.startedAt}, undefined, {list: !tabs});   // the step card above has the sites (parseSiteRows)
  else if (reading) renderCardSkeleton();
  if (card || insight || weekly || mail || review || kits || sites) show($('activity-result'), false);  // the card shows the same, laid out
  show($('activity-card'), !!card || !!mail || !!insight || !!weekly || !!review || !!kits || !!sites || reading);
  // A search that can't have found much yet suggests Find new employers, whatever its result card shows (renderer/onboarding.js employersAdvice).
  const advice = employersAdvice(run && {...run, kind: kindOf(run)}, {runs: lastActivity?.runs, settings: shared.state?.settings});
  if (advice) {
    const words = el('div', 'insight-next-words');
    const go = el('button', 'secondary', 'Find jobs again');   // the pane's one primary stays its own (View new jobs)
    go.addEventListener('click', () => startSearch({employers: true}));
    words.append(el('b', '', 'Recommended next step'), el('p', '', advice.text), go);
    $('activity-next').replaceChildren(el('span', 'insight-next-icon', icon('building')), words);
  }
  show($('activity-next'), !!advice);
  const plain = !run?.live && !card && !mail && !insight && !weekly && !review && !kits && !sites && run?.message;
  $('activity-message').textContent = plain ? plainMessage(plain) : '';
  show($('activity-message'), !!plain && !reading);
  markFallback($('activity-message'), kindOf(run), plain && !reading ? plain : '');
  const drew = !!card || !!mail || !!insight || !!weekly || !!review || !!kits || !!sites || reading || !!plain || !$('activity-result').hidden;
  if (emptyResult(kindOf(run), run, drew)) $('activity-panel').dataset.emptyResult = kindOf(run); else delete $('activity-panel').dataset.emptyResult;
  markFallback($('activity-result'), kindOf(run), $('activity-result').hidden ? '' : $('activity-result').textContent);
  // Warnings (Notion busy, a step skipped…) shown plainly above the log, not buried in it. A run whose row says
  // Warnings — its own verdict — still says so when neither its log nor its report has a line about it: the list's
  // pill and this card never contradict each other.
  const warnings = partial ? split.rest : detailWarnings;
  // A failed run says so in its box, with its reason and the fix the app can open (#290); one the AI provider stopped
  // says that in plain words, with the way to raise the limit (the owner's mockup, 6 Oct 2026).
  const head = (run && (aiLimitHead({...run, kind: kindOf(run)}, KIND[kindOf(run)]?.name) || stoppedHead({...run, kind: kindOf(run)})
    || deliveryHead({...run, kind: kindOf(run)}) || notConnectedHead(run, gmailConnected()) || waitedHead({...run, kind: kindOf(run)})))
    || signedInSince(failureHead(run && {...run, kind: kindOf(run)}, KIND[kindOf(run)]?.name));
  // A message not delivered comes after the run's results; every other box comes first. Its icon says what it is about.
  if (head?.delivery) $('activity-phases').after($('activity-warnings')); else $('activity-phases').before($('activity-warnings'));
  $('activity-warnings').querySelector('.ap-warn-icon').replaceChildren(icon(head?.icon || 'alert'));
  const warnedOnly = !warnings.length && !partial && !run?.live && !!run?.warned && !head;
  showPartial(partial?.partial);
  const limited = limitedJobs(warnings);
  show($('activity-warnings'), warnings.length > 0 || warnedOnly || !!head?.problem);
  if (warnings.length || warnedOnly || head?.problem) {
    // The headline says what it means for you ("9 jobs still need scoring"), not which card this is.
    $('activity-warnings-title').textContent = limited ? `${plural(limited, 'job')} still ${limited === 1 ? 'needs' : 'need'} scoring`
      : head ? head.title : run?.live ? 'Running with warnings' : `${WARN_NOUN[kindOf(run)] || 'Run'} completed with warnings`;
    const summary = head?.problem ? head.summary : warnings.length ? warningSummary(warnings) : 'The run recorded warnings, with no line about them in its log or report.';
    $('activity-warnings-summary').textContent = summary;
    show($('activity-warnings-hint'), !!head?.hint);
    $('activity-warnings-hint').textContent = head?.hint || '';
    const external = $('activity-warnings-external');
    show(external, !!head?.fix?.url);
    external.dataset.url = head?.fix?.url || '';
    external.replaceChildren(...(head?.fix?.url ? [`${head.fix.label} `, icon('external')] : []));
    show($('activity-warnings-fix'), !!head?.fix && !head.fix.url);
    $('activity-warnings-fix').textContent = head?.fix ? head.fix.label : '';
    $('activity-warnings-fix').dataset.view = head?.fix?.view || '';
    // Run again: the task's own Run button on the Actions page, so it queues, joins and reports like any other run.
    const again = head?.fix?.rerun ? runButton(kindOf(run)) : null;
    $('activity-warnings-fix').dataset.rerun = again ? kindOf(run) : '';
    $('activity-warnings-fix').dataset.sites = again && kindOf(run) === 'visits' ? JSON.stringify(rerunSites(run.log || [])) : '';
    if (head?.fix?.rerun && !again) show($('activity-warnings-fix'), false);
    show($('activity-warnings-log'), !!head?.viewLog || (!head && warnings.length > 0));   // warnings: the exact lines are in the log
    show($('activity-warnings-limit'), limited > 0);
    const grouped = newDetails(groupWarnings(head?.delivery ? warnings.filter(line => !head.lines.includes(line)) : warnings), head?.delivery ? head.hint : summary);
    // One line needs no toggle: it is shown. Two or more fold behind "View N details".
    const single = grouped.length === 1;
    const listShown = single || (grouped.length > 0 && !$('activity-warnings-list').hidden && $('activity-warnings-list').dataset.for === String(run?.id));
    $('activity-warnings-list').dataset.for = String(run?.id);
    show($('activity-warnings-list'), listShown);
    show($('activity-warnings-more'), grouped.length > 1);
    $('activity-warnings-more').textContent = listShown ? 'Hide details' : `View ${grouped.length} detail${grouped.length === 1 ? '' : 's'}`;
    $('activity-warnings-list').replaceChildren(...grouped.map(text => el('li', '', text)));
    // Folded away: the headline stays, the rest hides (the chevron turns).
    const folded = foldedWarnings === String(run?.id);
    $('activity-warnings').classList.toggle('is-folded', folded);
    $('activity-warnings-fold').setAttribute('aria-expanded', String(!folded));
    $('activity-warnings-fold').title = folded ? 'Show' : 'Hide';
  }
  // The technical log, in the same place on every run (owner, 6 Oct 2026): open while a run streams here; folded for every finished
  // run (its box or card says what happened, "View technical log" opens it); a run that finishes while you watch keeps what you chose.
  const streamLocal = !!run?.live && run?.where !== 'github';
  const noLog = !!run && !run.live && !lines.length;
  if (run && $('activity-log').dataset.for !== String(run.id)) {
    $('activity-log').dataset.for = String(run.id);
    $('activity-log').open = streamLocal;
  }
  if (noLog) $('activity-log').open = false;
  $('activity-log').classList.toggle('is-empty', noLog);   // the same row, "No log available", nothing to open
  $('log-title').textContent = noLog ? 'No log available' : 'Technical log';
  // In plain words (renderer/human-log.js): the raw lines stay in logs/engine.log; the progress bar and warnings above read the raw ones
  const readable = readableLog(lines);
  $('log-count').textContent = readable.length ? `· ${plural(readable.length, 'line')}` : '';
  show($('log-live'), !!run?.live);
  show($('log-copy'), !noLog);   // nothing to copy on "No log available"
  const log = $('log');
  const text = readable.join('\n') || (githubLive
    ? (run.url ? 'This run is on GitHub. Its log is copied here when it finishes.' : 'Starting on GitHub…')
    : (run?.live ? 'Nothing to show yet.' : 'No log for this run.'));
  if (log.textContent !== text) {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.replaceChildren(...linked(text));
    if (atBottom) log.scrollTop = log.scrollHeight;  // follow new lines unless the user scrolled up to read
  }
  showJumpToLatest();
}
// A Logged activity run's job, created or updated: a green box linking to it (its Notion page, the Jobs list).
// While a run streams and you scrolled up to read, "Jump to latest" brings the log back to its newest line (and following resumes).
