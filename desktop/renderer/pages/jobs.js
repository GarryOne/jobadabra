// Jobs: loading and reloading the list, adding jobs, init(); the pieces are jobs-state/-render/-fit/-lead/-questions.js. Guarded by: search-changed, live-status-line, live-count, activity-selection-kept tests.
import {badgeLabel} from '../badge-label.js';
import {setCount} from '../components.js';
import {applicationStats, inboundCount, inProcess, jobCounts, statClick, takenDown, talkingStartsOpen, toReview} from '../jobs-view.js';
import {shared} from './shared.js';
import {keepRunLine} from '../run-lines.js';
import {refreshBusy, showSearchChanged, wireSearchChanged} from '../search-changed.js';
import {openActivity, refreshActivity, showSearchStatus} from './activity.js';
import {paintFindCardFirst, renderFindCard, showFindRefused, wireFindCard} from './jobs-find.js';
import {$, message, savedAgo} from './core.js';
import {refreshSessions, sessionJob, sessionList} from './sessions.js';
import {sayRefused, toastMessage} from './startup.js';
import {refusal} from '../refusal.js';
import {hostStats, snapshot} from '../intel.js';
import {searchSelect} from '../search-select.js';
import {jobsState, MORE, fullKey} from './jobs-state.js';
import {openJobPanel} from './job-panel.js';
import {renderJobs, renderStuck, showLoading} from './jobs-render.js';
import {TALKING_OPEN, paintTalkingFirst, renderTalkingBar} from './jobs-talking.js';
export {renderJobs} from './jobs-render.js';
window.addEventListener('claude-help', () => renderJobs());   // Settings' Claude switch: the job menus follow it (claude-help.js)
export {pageKey, fullKey} from './jobs-state.js';
export {openLogFor} from './jobs-lead.js';
import {wireLead} from './jobs-lead.js';
import {wireAdd} from './jobs-add.js';
import {loadQuestions} from './jobs-questions.js';
import {wireViews} from './jobs-views.js';
import {setFilters, wireFilterMenu} from './jobs-filter-menu.js';
import {wireExport} from './jobs-export.js';
import {soleFilter} from '../jobs-filters.js';
import {markReady, refreshReady} from './jobs-ready.js';
import {storeName} from '../store-words.js';
import {jobWrites} from '../job-writes.js';
import {jobPlace} from '../targets.js';
import {applyDialogCopy, applyDialogSelectMode, applyDialogStart, createApplyStartGate} from '../apply-dialog-model.js';
import {modeCards, save as saveApplySettings} from './apply-settings.js';

// Every write that changes a job's stage or status ends in jobsChanged(row, patch): that row at once, then the list read again from the store
// (renderer/job-writes.js: a read older than the write is never painted). The other reads of the list go through writes.read for the same reason.
const writes = jobWrites({read: options => window.pilot.jobs(options), paint: fresh => { showJobsData(fresh); renderJobs(); }});
export const jobsChanged = (job = null, patch = {}) => writes.changed(job, patch);
// An application started (Apply, a night's form, Start again, a batch): main marked its job Applying before answering, so the row says so at once
// and the list is read again (#1737: eight forms open, the chips said "Applying 0"). Guarded by test/apply-starts-reread.test.js.
const BEFORE_APPLYING = new Set(['', 'Saved', 'Kit ready']);
export const startedApplying = (job = null) => jobsChanged(job, job && BEFORE_APPLYING.has(job.stage || '') ? {stage: 'Applying'} : {});

// Sites that often show a sign-in page instead of the posting (src/notion/ledger.py WALLED): read like any page, with fields for the text in case.
// After "Add a job" / "Applied elsewhere" worked: the result line gets an "Open job" link that closes the dialog and opens that job's drawer.
// The list is read again first, so the drawer gets the row the list shows; a job past the list's limit opens from the result alone.
async function linkToJob(dialogId, messageId, result) {
  const added = result.job;
  await loadJobs();
  if (!added?.jobUrl) return;
  const job = (shared.allJobs || []).find(row => row.url === added.jobUrl || (added.url && row.notion_url === added.url))
    || {url: added.jobUrl, title: added.title, notion_url: added.url};
  const open = document.createElement('button');
  open.type = 'button'; open.className = 'link'; open.textContent = 'Open job →';
  open.addEventListener('click', () => { $(dialogId).close(); openJobPanel(job); });
  $(messageId).append(' ', open);
}

const WALLED = /(^|\.)(linkedin\.com|glassdoor\.[a-z.]+|indeed\.[a-z.]+|levels\.fyi|reddit\.com)$/i;
let applyDialogSettings = null;
const applyStartGate = createApplyStartGate();
let applyModeSaving = false;

function drawApplyDialogMode(settings) {
  applyDialogSettings = settings || null;
  const go = $('apply-go'), count = $('apply-n').value || '3';
  if (!applyDialogSettings) {   // Why (27 Oct 2026, owner): do not offer a fallback action when the persisted mode could not be read.
    $('apply-mode-description').textContent = 'Could not read your saved Apply mode. Close this dialog and try again.';
    $('apply-mode-cards').replaceChildren();
    go.disabled = true;
    go.textContent = 'Unavailable';
    return;
  }
  const mode = applyDialogCopy(applyDialogSettings);
  $('apply-mode-description').textContent = mode.description;
  // Why (27 Oct 2026, owner): these are the same saved Settings → Apply choices, so Jobs cannot keep a second mode value.
  $('apply-mode-cards').replaceChildren(modeCards(mode.mode, selected => saveApplyDialogMode(selected), {
    disabled: applyStartGate.isStarting() || applyModeSaving,
  }));
  if (applyStartGate.isStarting()) {
    go.disabled = true;
    go.textContent = 'Starting…';
    return;
  }
  go.disabled = !mode.canStart;   // Why (27 Oct 2026, owner): a confirmed unsupported mode cannot start; an unconfirmed choice still reaches the first-choice gate.
  go.textContent = mode.available ? `Start ${count} for review` : mode.chosen ? 'Unavailable' : 'Confirm Apply mode';
}

// Why (27 Oct 2026, owner): persist each card choice through Settings → Apply and verify it before changing the displayed selection.
async function saveApplyDialogMode(selected) {
  if (applyStartGate.isStarting() || applyModeSaving) return;
  applyModeSaving = true;
  drawApplyDialogMode(applyDialogSettings);
  try {
    const selection = await applyDialogSelectMode({mode: selected, save: saveApplySettings});
    const current = await window.pilot.state().catch(() => null);
    if (!selection.ok || !current?.settings || applyDialogCopy(current.settings).mode !== selected) {
      message('apply-message', selection.error || 'Could not verify the selected Apply mode. No jobs were started.', 'error');
      return;
    }
    applyDialogSettings = current.settings;
    message('apply-message', `${applyDialogCopy(current.settings).title} saved to Settings → Apply.`, 'ok');
  } catch (error) {
    message('apply-message', `Could not save the selected Apply mode: ${error.message}`, 'error');
  } finally {
    applyModeSaving = false;
    const latest = await window.pilot.state().catch(() => null);
    drawApplyDialogMode(latest?.settings || null);
  }
}

// List density: Comfortable (columns) or Compact (one block per job); remembered on this computer.
function setDensity(value) {
  const compact = value === 'compact';
  $('jobs-body').classList.toggle('compact', compact);
  $('jobs-head').hidden = compact;
  document.querySelectorAll('[data-density]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.density === value)));
  try { localStorage.setItem('jobsDensity', value); } catch {}
}

let freshJobs = false;
let leftOpenAsked = false;  // the start-up question about sessions left open was asked (once per launch)
export async function loadJobs() {
  loadQuestions();
  freshJobs = false;
  showLoading();
  jobsState.jobsLoading = true;
  jobsState.claudeReady = (await window.pilot.claudeReady().catch(() => ({ok: false}))).ok;
  try {
    // The last good list at once (lib/view-cache.js), then the fresh one from Notion replaces it.
    if (!shared.allJobs.length) {
      const saved = await window.pilot.cached('jobs');
      if (saved?.result?.jobs) { showJobsData(saved.result); jobsState.jobsLoading = false; renderJobs(); $('jobs-stats').textContent += ` · saved ${savedAgo(saved.at)}, updating…`; jobsState.jobsLoading = true; }
    }
    const fresh = await writes.read();
    if (fresh) { showJobsData(fresh); freshJobs = !fresh.stale; }  // from Notion now, not the cache: safe to ask about what's still Applying. null: a job was written meanwhile, its own read paints
  } catch (error) {
    $('jobs-stats').textContent = `Couldn't read your jobs: ${error.message}`;
  }
  jobsState.jobsLoading = false;
  jobsState.jobsRead = true;   // read or failed: the Find jobs card stops waiting for the count
  renderFindCard();
  renderJobs();
  if (freshJobs) {
    askAboutLeftOpen();
    // How the fit score relates to what became of each job, as counts per band and state (once a day; the app drops it if reports are off).
    if (shared.allJobs.length) window.pilot.intelSnapshot(snapshot(shared.allJobs), hostStats(shared.allJobs)).catch(() => {});
    if (shared.allJobs.length) window.pilot.benchmarkLines(shared.allJobs.map(job => job.url).filter(Boolean)).then(result => { jobsState.benchmarkText = result?.lines || {}; }).catch(() => {});
  }
}
// Once per launch, on fresh data: sessions left open by the last run whose jobs are still Applying. Keep them, go
// through them one by one (the "Did you submit?" question), or reset them all to Kit ready. A session whose job is
// already Applied never reaches here: main.js ends it as the job list is read (server.reconcileAppliedSessions).
async function askAboutLeftOpen() {
  if (leftOpenAsked || jobsState.jobsLoading || !shared.allJobs.length) return;
  await refreshSessions();
  const open = sessionList.filter(item => item.askAtStart && sessionJob(item).stage === 'Applying');
  leftOpenAsked = true;
  if (!open.length) return;
  const answer = await window.pilot.sessionsLeftOpen(open.map(item => item.id));
  if (answer?.kept) toastMessage(`${answer.kept} application${answer.kept === 1 ? '' : 's'} restored`,
    `${answer.kept === 1 ? 'Its form is' : 'Their forms are'} still open in Chrome: review and submit them there.`, {view: 'sessions'}, 'good');
}
let jobsLimit = 200;
async function showMore() {
  const button = $('jobs-more');
  button.disabled = true;
  button.textContent = 'Loading…';
  try {
    jobsLimit = shared.allJobs.length + MORE;
    const fresh = await writes.read({limit: jobsLimit});
    if (fresh) showJobsData(fresh);
  } catch (error) {
    toastMessage('Could not load more jobs', error.message, {view: 'jobs'}, 'bad');
  }
  button.disabled = false;
  renderJobs();
}
// A refresh's lines that change the list while it runs: jobs closed outside your search, scores written to Notion so far. The list is read again
// then, without the loading state, so the counts move as it works (owner, 7 Oct 2026: "I want to see the 2971 decrease live").
// Each scored job counts too (owner, 7 Oct 2026: the total stayed at 51 while a refresh scored), at most one read every RELOAD_MS, the last one
// always made, so the number climbs as the refresh works.
export const LIST_CHANGED = /^First jobs: [1-9]\d* (?:found|scored)|^Jobs so far: [1-9]\d* new|^Closed [1-9]\d* job\(s\)|^Job Matches: \d+ created, \d+ updated \(so far\)|^Scored [1-9]\d* of \d+ job\(s\)$/;
export const RELOAD_MS = 10000;
let quietReload = null, lastReload = 0, reloadLater = null;
function reloadQuietly() {
  if (quietReload || reloadLater) return;
  const wait = Math.max(0, lastReload + RELOAD_MS - Date.now());
  reloadLater = setTimeout(() => {
    reloadLater = null;
    lastReload = Date.now();
    quietReload = writes.read().then(fresh => { if (fresh?.jobs) { showJobsData(fresh); renderJobs(); } })
      .catch(() => {}).finally(() => { quietReload = null; });
  }, wait);
}
export function showJobsData(data) {
  jobsState.lastJobsData = data;
  renderFindCard();   // its count decides "empty" (no jobs yet)
  // "Your search changed" until a refresh has finished: the settings as they are now (a refresh that just ended set lastSearchAt).
  wireSearchChanged();
  window.pilot.state().then(state => { shared.state = state; showSearchChanged(state.settings); }).catch(() => {});
  {
    for (const job of takenDown(shared.allJobs, data.jobs)) {
      toastMessage('Posting taken down', `${job.company ? `${job.company} · ` : ''}${job.title || job.url}: its job board no longer lists it, so it moved to Closed. Your kit is kept.`, jobPlace(job), 'warn');
    }
    shared.allJobs = data.jobs;
    markReady(data.jobs);   // the jobs the night filled, from the codes known so far
    refreshReady(data.jobs, () => renderJobs());   // then the app's answer; the list is drawn again when it differs
    document.dispatchEvent(new Event('menu:refresh'));   // pages/nav.js: Interviews appears with the first application
        // Total / high fit / new / companies count job matches; opportunities that found you are "In conversation".
    const count = jobCounts(data);   // one definition for every count (jobs-view.js), the Find jobs card's too
    $('jobs-stats').textContent = `${count.total} matches` +
      (count.week ? ` · ${count.week} new this week` : '') + (data.filtered ? ` · ${data.filtered} hidden` : '') +
      // Found but not checked yet (the engine: not scored): the next refreshes take them, a batch at a time, best places first (src/daily.py).
      (data.waiting ? ` · ${data.waiting} waiting, run Find jobs again` : '') +
      (data.stale ? ' · ⚠️ Notion unreachable: statuses may be out of date' : '');   // about Notion
    $('jobs-stats').title = `${count.scored} scored by the AI` + (data.filtered ? `; ${data.filtered} hidden by your language or company filters` : '');
    const totalBefore = $('stat-total').textContent, flash = setCount($('stat-total'), count.total);
    // Whether a person could see it (7 Oct 2026: "the flashing is not consistently working"): logs/app.log, area ui
    if (flash !== 'same') window.pilot.uiLog?.('Total matches changed', {from: totalBefore, to: count.total, flash,
      page: document.querySelector('.view[data-view="jobs"]')?.offsetParent ? 'jobs' : 'another page',
      window: document.visibilityState, focused: document.hasFocus(), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches}).catch?.(() => {});
    setCount($('stat-high'), count.high);
    setCount($('stat-inbound'), inboundCount(shared.allJobs));
    // The menu item counts the list as it opens ("New matches"), the number the list bar shows too. "New this week" is
    // a delta, not how many jobs there are: it goes in the tooltip and the line above the cards instead of the badge.
    const toReviewCount = toReview(shared.allJobs) + (data.review_beyond || 0);   // with the rows not loaded (a cut list)
    setCount($('nav-jobs-badge'), toReviewCount);
    Object.assign($('nav-jobs-badge'), {hidden: !toReviewCount, textContent: badgeLabel(toReviewCount),
      title: `${toReviewCount} job${toReviewCount === 1 ? '' : 's'} to review · ${count.week} new this week`});
    setCount($('stat-companies'), count.companies);
    const applications = applicationStats(shared.allJobs);
    for (const kind of Object.keys(applications)) setCount($(`stat-${kind}`), applications[kind]);
    const talking = inProcess(shared.allJobs);
    document.querySelector('[data-stat="interviews"]').title = `Now: ${talking.screening} screening · ${talking.interviews} interviewing or offer.`;
    document.querySelector('[data-stat="applied"]').title = 'Applications sent = waiting for a reply + in process + closed. Forms still being filled are sessions, not counted here.';
    document.querySelector('[data-stat="waiting"]').title = 'Sent, no answer yet (Applied, Confirmation received).';
    document.querySelector('[data-stat="closed"]').title = 'Rejected, withdrawn, or no answer after the waiting time.';
    renderStuck();
  }
}

// A kit's provenance, for its tag: "Current", "Drafted with earlier inputs" (which ones changed), or "Inputs unknown".

// A list of applications from elsewhere (a Focus funnel step): only those, whatever their status.
export function showJobsIn(label, urls, from = '') {
  jobsState.statFilter = {label, from, urls: new Set((urls || []).map(fullKey))};
  setFilters(['all']);
  $('filter-text').value = '';
  renderJobs();
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
// Refresh jobs, from any button that starts one (Refresh, "score the unscored", Strategy's Re-score them now): the header status
// shows "Refreshing jobs →", the run joins Recent activity, the list reloads after. Resolves when the search ends.
// why: what this refresh is for beyond finding jobs ({reason: 'rescore', count}), said on its row in Recent activity (main.js refresh).
// Every Find jobs press (the card, Refresh, Strategy, Re-score, Find employers, search changed) comes here. A refusal (no AI credit, trial over,
// Always on could not start it) is said on the Find jobs card, or in a pop-up when the card is not on screen (26 Oct 2026: the press was silent).
// -> the main process's answer.
export async function startSearch(why = undefined) {
  refreshBusy(true);   // "Your search changed": this refresh applies it
  $('refresh').disabled = true;
  showFindRefused(null);
  renderJobs();   // the empty list stops offering "Refresh jobs" while one runs
  shared.selectedRun = null;
  setTimeout(() => { showSearchStatus(); refreshActivity(); window.pilot.runs().then(renderFindCard).catch(() => {}); }, 300);
  let result = null;
  try {
    result = await window.pilot.refresh(why).catch(error => ({ok: false, error: error.message}));
    const refused = refusal(result);
    // On the card when it is in view; elsewhere a pop-up. No AI credit or a Free AI line also opens the top-up dialog, which can press it again.
    if (refused && (!showFindRefused(refused) || refused.credit)) sayRefused(why?.reason === 'rescore' ? 'Re-score did not start' : why?.employers ? 'Find employers did not start' : 'Find jobs did not start', result, {place: {view: 'jobs'}, retry: () => startSearch(why)});
    return result;
  } finally {
    $('refresh').disabled = false;
    loadJobs();
    refreshActivity();
    showSearchStatus();
  }
}

export async function init() {
  searchSelect($('lead-target'));
  try { $('jobs-talking').open = talkingStartsOpen(localStorage.getItem(TALKING_OPEN)); } catch {}
  $('jobs-talking').addEventListener('toggle', event => { try { localStorage.setItem(TALKING_OPEN, event.target.open ? '1' : '0'); } catch {} renderTalkingBar(); });
  paintTalkingFirst();
  $('jobs-stuck-show').addEventListener('click', () => {
    jobsState.statFilter = 'stuck';
    setFilters(['all']);
    renderJobs();
  });
  $('sort-by').addEventListener('change', renderJobs);
  wireFilterMenu();   // the one Show menu (pages/jobs-filter-menu.js): every filter, ticked together
  wireViews();   // saved views + List | Board (pages/jobs-views.js): they ask for a render through this event
  document.addEventListener('jobs-rerender', () => renderJobs());
  $('jobs-filter-clear').addEventListener('click', () => { jobsState.statFilter = null; renderJobs(); });
  $('jobs-filter-back').addEventListener('click', () => document.querySelector('.nav[data-view="focus"]').click());
  // The counters filter the list to the jobs they count, whatever their status (so the list matches the number);
  // clicking the active one again, or Total matches, shows every match.
  document.querySelectorAll('[data-stat]').forEach(card => card.addEventListener('click', () => {
    const kind = card.dataset.stat;
    const next = statClick(kind, typeof jobsState.statFilter === 'string' ? jobsState.statFilter : null, soleFilter(jobsState.filters));
    jobsState.statFilter = next.stat;
    setFilters([next.filter]);   // a counter is a selection of the menu: its own list

    if (kind === 'companies' && jobsState.statFilter) $('sort-by').value = 'company';
    renderJobs();
  }));
  // Add a job: one link, then the find path (read, score, Job Matches). It shows under New matches.
  $('jobs-more').addEventListener('click', showMore);
  wireExport();
  $('import-open').addEventListener('click', () => {
    message('import-message', '');
    $('import-go').disabled = false;
    $('import-dialog').showModal();
    $('import-url').focus();
  });
  $('import-go').addEventListener('click', async event => {
    event.preventDefault();
    const url = $('import-url').value.trim();
    if (!/^https?:\/\//.test(url)) { message('import-message', 'Paste the job link (it starts with https://).', 'error'); return; }
    $('import-go').disabled = true;
    message('import-message', 'Reading the posting and scoring it…', 'waiting');
    const result = await window.pilot.importJob(url);
    $('import-go').disabled = false;
    message('import-message', result.text, result.ok ? 'ok' : 'error');
    if (!result.ok) return;
    $('import-url').value = '';
    setFilters(['open']);
    await linkToJob('import-dialog', 'import-message', result);
  });
  // Applied elsewhere: tracked in Notion like /add, then shown in the list as Applied.
  const setAppliedOrigin = value => $('applied-origin').querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.origin === value));
  const appliedOrigin = () => $('applied-origin').querySelector('.is-active')?.dataset.origin || 'outbound';
  $('applied-origin').addEventListener('click', event => { const b = event.target.closest('[data-origin]'); if (b) setAppliedOrigin(b.dataset.origin); });
  $('applied-open').addEventListener('click', () => {
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);  // local day
    $('applied-when').value = today;
    $('applied-when').max = today;  // no future dates
    message('applied-message', '');
    $('applied-go').disabled = false;
    $('applied-dialog').showModal();
    $('applied-url').focus();
  });
  $('applied-url').addEventListener('input', () => {
    let host = '';
    try { host = new URL($('applied-url').value.trim()).hostname; } catch {}
    $('applied-manual').hidden = !WALLED.test(host);
  });
  $('applied-go').addEventListener('click', async event => {
    event.preventDefault();
    const url = $('applied-url').value.trim();
    if (!/^https?:\/\//.test(url)) { message('applied-message', 'Paste the job link (it starts with https://).', 'error'); return; }
    $('applied-go').disabled = true;
    message('applied-message', `Reading the posting and adding it to ${storeName()}…`, 'waiting');
    const day = $('applied-when').value;  // YYYY-MM-DD from the date picker
    if (!day) { message('applied-message', 'Pick the day you applied.', 'error'); return; }
    const manual = !$('applied-manual').hidden;
    if (manual && !$('applied-title').value.trim()) { message('applied-message', 'Add the job title (the page itself isn\'t read).', 'error'); return; }
    const details = {...(manual ? {title: $('applied-title').value.trim(), company: $('applied-company').value.trim(), text: $('applied-text').value.trim()} : {}),
      ...(appliedOrigin() === 'inbound' ? {origin: 'inbound'} : {})};
    const result = await window.pilot.addApplied(url, $('applied-approx').checked ? `on or before ${day}` : day, details);
    $('applied-go').disabled = false;
    message('applied-message', result.text, result.ok ? 'ok' : 'error');
    if (!result.ok) return;
    if (/not scored yet/.test(result.text)) {   // the page's text was not read: ask for it here, the same Track it adds the fit score
      $('applied-manual').hidden = false;
      message('applied-message', result.text, 'ok');
      await linkToJob('applied-dialog', 'applied-message', result);
      return;
    }
    $('applied-url').value = ''; $('applied-approx').checked = false; setAppliedOrigin('outbound');
    ['applied-title', 'applied-company', 'applied-text'].forEach(id => { $(id).value = ''; });
    $('applied-manual').hidden = true;
    setFilters(['applied']);  // show it where it now is
    await linkToJob('applied-dialog', 'applied-message', result);
  });
  wireLead();
  wireAdd();
  document.querySelectorAll('[data-density]').forEach(button => button.addEventListener('click', () => setDensity(button.dataset.density)));
  try { setDensity(localStorage.getItem('jobsDensity') || 'comfortable'); } catch { setDensity('comfortable'); }
  $('filter-text').addEventListener('input', renderJobs);

  // ---------- questions to answer once ----------
  // The start-up move to Notion can finish after the first read: read them again then.
  window.pilot.onMoved(steps => { if (steps.includes('open questions')) loadQuestions({force: true}); });

  window.pilot.onLog(line => {
    // A new run's first line starts a fresh live log. It does NOT clear the run you are looking at in Recent activity (6 Oct 2026: the Gmail check the app
    // starts by itself after launch switched the panel away from the run being read). Starting a run yourself clears it (Refresh, Check Gmail, View activity).
    if (shared.idleSeen || /^Searching job boards/.test(line)) { shared.logLines = []; shared.idleSeen = false; }
    keepRunLine(shared.logLines, line);   // as the app keeps it: the newest "Still running" of a row, the newest tick of each kind, every result
    refreshActivity();
    if (LIST_CHANGED.test(line)) reloadQuietly();
  });
  // Running: its progress; done: the last Refresh jobs run itself, not whichever task happens to be running now.
  $('search-status').addEventListener('click', async () => {
    const {running, runs} = await window.pilot.runs();
    const searching = running && (running.kind || 'search') === 'search';
    shared.selectedRun = searching ? null : (runs || []).find(run => (run.kind || 'search') === 'search')?.id ?? null;
    openActivity(true);
    refreshActivity();   // draws the selected run's detail
  });
  $('refresh').addEventListener('click', () => startSearch());
  wireFindCard(() => startSearch());
  paintFindCardFirst();

  $('jobs-unscored-go').addEventListener('click', () => $('refresh').click());
  $('apply-open').addEventListener('click', async () => {
    message('apply-message', '');
    const state = await window.pilot.state().catch(() => null);
    drawApplyDialogMode(state?.settings);
    $('apply-dialog').showModal();
  });
  $('apply-n').addEventListener('input', () => drawApplyDialogMode(applyDialogSettings));
  window.pilot.onApplyProgress(text => message('apply-message', text, 'waiting'));   // "Drafting kit 2 of 3…" while the batch drafts what is missing
  $('apply-go').addEventListener('click', async event => {
    event.preventDefault();
    const n = Number($('apply-n').value);
    if (!Number.isInteger(n) || n < 1 || n > 10) {   // Why (27 Oct 2026, owner): keep the batch's 1–10 integer bounds before the first-choice gate or runner.
      $('apply-n').reportValidity();
      message('apply-message', 'Choose between 1 and 10 jobs.', 'error');
      return;
    }
    const started = await applyStartGate.run(async () => {
      // Feedback at once: picking the jobs reads Notion and checks each posting is still open (a few seconds).
      $('apply-go').disabled = true;
      $('apply-go').classList.add('busy');
      $('apply-go').textContent = 'Starting…';
      try {
        const state = await window.pilot.state().catch(() => null);
        if (!state?.settings) {   // Why (27 Oct 2026, owner): fail closed if saved Apply mode is unavailable.
          message('apply-message', 'Could not read your saved Apply mode. No jobs were started.', 'error');
          return;
        }
        drawApplyDialogMode(state.settings);
        const applyMode = applyDialogCopy(state.settings);
        message('apply-message', applyMode.chosen
          ? `Finding your best ${n} job${n === 1 ? '' : 's'}, drafting any missing kit first (about 20 s each), and checking the postings are still open…`
          : 'Confirming how Jobadabra applies before starting…', 'waiting');
        const result = await applyDialogStart({settings: state.settings, count: n, start: options => window.pilot.apply(options)});
        if (result.ok) startedApplying();   // the batch marked the jobs it started: read the list again
        if (result.needsExtension || result.cancelled) { $('apply-dialog').close(); return; }   // the install dialog opens (extension-needed.js), or Not now in the first-Apply dialog
        if (result.ok && result.inApp) {  // the sessions show in the dock: close the dialog and let them be watched
          $('apply-dialog').close();
          toastMessage('Applying with Claude', result.message, {view: 'sessions'}, 'info');
          await refreshSessions();
          return;
        }
        message('apply-message', result.ok ? result.message : result.error, result.ok ? 'ok' : 'error');
      } finally {
        $('apply-go').classList.remove('busy');
      }
    });
    if (started.ignored) return;
    const latest = await window.pilot.state().catch(() => null);
    drawApplyDialogMode(latest?.settings || null);
  });
}

