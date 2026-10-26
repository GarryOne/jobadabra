// Recent activity: renderActivity, the Recent activity panel redraw, its panel height and its list state.
// Split out of activity.js as a pure move. Guarded by the tests that read the activity-*.js sources (desktop/test/activity-source.js) and the e2e activity suites.
import {billingLabel} from '../ai-engine-view.js';
import {costText, dollars} from '../ai-cost.js';
import {runWarningLines, stepNote} from '../run-warnings.js';
import {barState, failureHead, phaseStatus, runPill, runWarned, stoppedHead, notChecked, waitedHead} from '../run-status.js';
import {el, moreButton, pill, tag} from '../components.js';
import {icon} from '../icons.js';
import {hasFullReport} from '../searches-view.js';
import {cardText, emptyResult, markFallback, newJobsShown, parseRunMessage, plainMessage} from '../run-cards.js';
import {parseSiteRows, parseVisits} from '../visits-card.js';
import {employersAdvice} from '../onboarding.js';
import {drawBrowserOffer} from './browser-offer.js';
import {settleQuestion} from '../mail-report.js';
import {parseInsight} from '../insight-card.js';
import {parseWeekly} from '../weekly-card.js';
import {parseKitsReady} from '../kits-ready.js';
import {groupRuns, runTime} from '../run-list.js';
import {shared} from './shared.js';
import {seeded} from '../live-log.js';
import {showScheduleState} from './connections.js';
import {$, show} from './core.js';
import {lastQuestions} from './focus.js';
import {remembered} from './nav.js';
import {readableLog} from '../human-log.js';
import {renderActionsPage} from './runs-page.js';
import {toastMessage} from './startup.js';
import {showStop} from '../stop-task.js';
import {clockTime, duration, PHASES, stepWords, searchPhase, KIND, KITS_CARD, kindOf, WHO, WHERE, runResults, runDetails, siteRow, phaseLabel, phaseIndex, hhmm, plural, capital, outcome, GOOGLE_SIGNIN, gmailConnected, mailReportOf} from './activity-basics.js';
import {showAwaitedResult, showQueuedBanner, keepStatusBar, withKept, byYou} from './activity-results.js';
import {showJumpToLatest, showRunJob, linked, refreshActivity} from './activity-run-card.js';
import {barLabel, PANEL_KEY, panelMemory} from './activity-panel.js';
import {anyFilter, filterBy, listFilter} from '../run-filters.js';
import {idOf, pickRun, queueWords} from '../run-pick.js';
import {actionsShown, drawFilters, drawQueueNote, rowPicked} from './runs-tab.js';
import {byStore} from '../store-words.js';
import {startSearch} from './jobs.js';
import {splitPartial} from './activity-partial.js';
import {drawResultTop} from './activity-result-top.js';
import {resultWords} from '../run-result-card.js';
import {drawResultBottom} from './activity-result-bottom.js';
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
  showQueuedBanner(lastActivity);
  showAwaitedResult(lastActivity.runs, {opening: true});
  actionsShown();   // Actions → Runs takes its run panel back from the drawer
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
  showQueuedBanner(data);
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
    $('activity-meta').textContent = [mailNote, nextSearchAt && `Next refresh ${hhmm(nextSearchAt)}`].filter(Boolean).join(' · ');
  } else {
    $('activity-title').textContent = 'No search yet';
    $('activity-step').textContent = 'Click "Find jobs" on Jobs to start one.';
    $('activity-meta').textContent = mailNote;
  }
  if (!running) keepStatusBar();

  // The one run the panel shows: the picked one wherever it is now (queued, running, done), else the default (renderer/run-pick.js).
  const {run: picked, keep} = pickRun(data, shared.selectedRun);
  if (shared.selectedRun != null && keep !== shared.selectedRun) shared.selectedRun = keep;   // a queued ticket that started: its run's own id
  const shown = picked && !picked.live && !picked.waiting ? picked : null;
  // Newest on top: the queued ones (the latest queued first), then the running one, then the finished ones.
  // Each queued one says what it waits for: the one queued before it, or the running task.
  const queue = data.queued || [];
  const waiting = queue.map((run, i) => ({...run, waiting: true,
    after: i ? KIND[kindOf(queue[i - 1])].name : running ? KIND[kindOf(running)].name : 'the current task'})).reverse();
  // Task, Status and Date keep what the list shows (renderer/run-filters.js); a page of them, queued and running first, then Load more.
  const by = {kindOf, toneOf: run => runPill(run)[1]};
  const liveRows = filterBy(waiting.concat(running ? [{...running, live: true}] : []), listFilter, by);
  const kept = filterBy(runs, listFilter, by);
  const recent = liveRows.concat(kept.slice(0, shownRuns));
  $('activity-count').textContent = String(liveRows.length + kept.length);
  drawFilters();
  drawQueueNote(queue);
  // One row: the task and what it found, where it ran, its AI cost, its time and its status pill. The time is its
  // own column (not part of the sentence), and the rows are grouped Today / Earlier (renderer/run-list.js).
  const recentRow = run => {
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'recent-row'});
    button.classList.toggle('current', run.live ? !!picked?.live : run.waiting ? !!picked?.waiting && idOf(run) === idOf(picked) : run === shown);   // by identity: two records can share an id
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
    button.addEventListener('click', () => { shared.selectedRun = run.id; rowPicked(); renderActivity(lastActivity);
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
    textContent: runs.length && anyFilter(listFilter) ? 'No runs match these filters.' : 'Nothing has run yet.'}));
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
  const lines = githubLive ? (run?.log || []) : (shown || run?.waiting ? run?.log || [] : (liveLines?.length ? liveLines : run?.log) || []);
  const kind = run ? KIND[kindOf(run)] : null;
  const detailWarnings = runWarningLines(run);
  // A result with only a few sources that did not answer keeps its card first: one small line under it, no box (pages/activity-partial.js); the step list does not say it again.
  const split = splitPartial(detailWarnings);
  // A search's sources that did not answer are in its full report (Reports → Searches), however it ended: never a line in the drawer's problem box (owner, 25 Oct 2026).
  const onStep = kindOf(run) === 'search' && !run?.live && split.partial ? split.partial : null;
  const partial = !onStep && run?.ok && !run.live && split.partial ? split : null;
  const stepWarnings = partial || onStep ? split.rest : detailWarnings;
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
    || (KITS_CARD.has(kindOf(run)) && parseKitsReady(shownText)) || parseVisits(shownText))) || !!(run && !run.live && mailReportOf(run));
  // A stopped run's box says why in full: the header doesn't repeat it.
  // A box that names what happened in full (stopped, couldn't start, stopped unexpectedly): the header doesn't repeat it.
  // Any failure the top names says its reason there: the header never repeats it (owner, 25 Oct 2026: one fact, said once).
  const boxSaysIt = run && (stoppedHead({...run, kind: kindOf(run)}) || waitedHead({...run, kind: kindOf(run)}) || !!failureHead({...run, kind: kindOf(run)})?.problem);
  const said = run && !run.live && !hasCard && !boxSaysIt ? capital(String(outcome(run)).replace(new RegExp(`^${kind?.name || ''}:\\s*`, 'i'), '')) : '';
  const seconds = run?.endedAt && run.startedAt ? Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000) : null;
  // A run that used no AI shows no cost: "$0" on every row was noise.
  const cost = run && !run.live && (billingLabel(run) || costText(run.usd, usd => `AI ${dollars(usd)}`));
  const queued = queueWords(run, data, kindName => KIND[kindName]?.name || 'the current task');
  show($('activity-unqueue'), !!run?.waiting && !!run.id);
  $('activity-unqueue').dataset.id = run?.waiting ? idOf(run) : '';
  // The run's result in one line goes in its card's top when that top is drawn (subLine(false)): the header says it only when no top does.
  const subLine = withSaid => (!run ? '' : run.waiting ? [run.note, queued.waiting, queued.place].filter(Boolean).join(' · ') : [
    run.note,
    run.live ? (run.startedAt ? `Started ${hhmm(Date.parse(run.startedAt))}` : '') : withSaid && said,   // the step is the card's top (one fact, once)
    !run.live && `Finished ${hhmm(Date.parse(run.endedAt || run.startedAt))}`,
    !run.live && seconds > 0 && (seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`),
    cost,
    run.where === 'github' ? 'In the cloud' : '',   // owner, 24 Oct 2026: basics only here; who started it, the machine and counts live in Reports
    !run.live && run.telegram && 'Sent to Telegram',
  ].filter(Boolean).join(' · '));
  $('activity-sub').textContent = subLine(true);
  // A search that found new jobs: straight to them (newest first).
  const found = !run?.live && kindOf(run) === 'search' ? newJobsShown(run, shownText) : 0;   // the card's own count (run-cards.js)
  show($('activity-report'), hasFullReport({...run, kind: kindOf(run)}));   // the search's full report in Reports → Searches
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
  const jobLinks = showRunJob(!run?.live && kindOf(run) === 'add' ? run.job : null);
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
  // How far it is (the step's count, or the sites read) is the card's top's bar, the same for every kind (pages/activity-result-top.js); the rows here are the kind's own.
  if (tabs) $('activity-phases').replaceChildren(...tabs.sites.map(site => siteRow(site, !!run.live, run.startedAt)));
  // A search's step rows only while it runs (its live progress): once it ended, the drawer is its result card and the steps are in its full report
  // (owner, 25 Oct 2026: "this one I don't want to display it in the drawer"; "We'll have the Reports -> Searches which will be more details").
  show($('activity-phases'), updates.length > 0 || (at >= 0 && !!run?.live) || !!tabs);
  // What a one-off job produced (the insight, the list, the report) when it wasn't sent to Telegram. Today's list and
  // Find new employers read better as a small card; anything else stays text. While its Notion page is still being
  // read, the card's own shape shows as skeleton bars, so the pane never looks half-built and then jumps.
  // A search lists only the jobs this run added (its "New job:" lines), never the digest's "since your last digest" (owner, 25 Oct 2026).
  const {card, mail, insight, weekly, review, kits, sites, reading, title, headline, asks, summary} = drawResultBottom({run, lines, shownText, tabs,
    readingNow: !!run?.pageId && readingPages.has(run.pageId), redraw: () => renderActivity(lastActivity)});
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
  drawBrowserOffer($('activity-next'), run && {...run, kind: kindOf(run)}, {runs: lastActivity?.runs, settings: shared.state?.settings});   // the sites that refused it: read in the browser on a press
  const plain = !run?.live && !card && !mail && !insight && !weekly && !review && !kits && !sites && run?.message;
  $('activity-message').textContent = plain ? plainMessage(plain) : '';
  show($('activity-message'), !!plain && !reading);
  markFallback($('activity-message'), kindOf(run), plain && !reading ? plain : '');
  const drew = !!card || !!mail || !!insight || !!weekly || !!review || !!kits || !!sites || reading || !!plain || !$('activity-result').hidden;
  if (emptyResult(kindOf(run), run, drew)) $('activity-panel').dataset.emptyResult = kindOf(run); else delete $('activity-panel').dataset.emptyResult;
  markFallback($('activity-result'), kindOf(run), $('activity-result').hidden ? '' : $('activity-result').textContent);
  // Warnings (Notion busy, a step skipped…) and a failed run's reason: the top of the run's result (pages/activity-result-top.js).
  const warnings = partial || onStep ? split.rest : detailWarnings;
  const added = kindOf(run) === 'visits' ? Number(run?.new) || 0 : found;
  const top = drawResultTop({run, warnings, partial, folded: foldedWarnings === String(run?.id), added, asks, summary, links: jobLinks, hasLog: lines.length > 0,
    step: kindOf(run) === 'search' ? searchPhase(run?.step) : run?.step, count: tabs ? {done: shownTabs.done, total: shownTabs.total, percent: shownTabs.percent} : null,
    title: title || resultWords(outcome(run || {}), kind?.name)});
  // The top says the result: the header does not repeat it, nor the finding's card its headline (owner, 25 Oct 2026: one fact, said once).
  if (top.clean) $('activity-sub').textContent = subLine(false);
  if (headline) headline.hidden = top.clean;
  // The top's Run again is the one way to run it again: the header's Check Gmail now would be a second button for the same thing.
  if (!$('activity-warnings-again').hidden || (!$('activity-warnings-fix').hidden && $('activity-warnings-fix').dataset.rerun)) show($('check-mail'), false);
  if (top.next) show($('activity-go'), false);   // the card's top offers it: the header does not repeat it
  // The technical log, in the same place on every run (owner, 6 Oct 2026): open while a run streams here; folded for every finished
  // run (its box or card says what happened, "View technical log" opens it); a run that finishes while you watch keeps what you chose.
  const streamLocal = !!run?.live && run?.where !== 'github';
  const noLog = !!run && !run.live && !lines.length;
  show($('activity-log'), !run?.waiting);   // a queued run: no empty log before it starts
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
// While a run streams and you scrolled up to read, "Jump to latest" brings the log back to its newest line (and following resumes).
