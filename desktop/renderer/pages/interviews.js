// Interviews page: record a call, then list, relink and review its transcript, notes and recording (saved in Notion).
import {ai} from '../ai-name.js';
import * as pendingReviews from '../review-pending.js';
import * as reviewAgain from '../review-again.js';
import {el, holdMenu, moreButton, pill} from '../components.js';
import {searchSelect} from '../search-select.js';
import {avatar, interviewJob, placeAndMode} from '../jobs-view.js';
import {insightCard, insightSkeleton, insightView} from '../interview-insight.js';
import {afterLoad} from '../interview-library.js';
import {humanError} from '../run-warnings.js';
import {byStore, inNotion, storeName} from '../store-words.js';
import {showReview} from '../interview-review-view.js';
import {showJobsIn} from './jobs.js';
import {openView} from './nav.js';
import {shared} from './shared.js';
import {$, aiReady, message, osText, show} from './core.js';
import {showPermission, startRecording, isRecording, stopRecording, onLevel, openPrivacySettings} from './interview-recorder.js';
import {agoText, endPractice, showMoments, skeletonRows, startPractice} from './interview-practice.js';
import {PASTE, jobForPage, jobList, jobOptions, jobUrlOf, renderDrafts as renderDraftList, renderSpeakers as renderSpeakerFields} from './interview-lists.js';
import {gatedOut} from './notion-connect.js';
import {showSetupProgress} from './interviews-setup.js';

// ---------- interviews: drafts on this Mac, saved ones in Notion 🎤 Interviews ----------
const iv = window.pilot.interviews;
let ivOpen = null;          // the draft in the editor
let ivSavedRows = [];
let ivInsight = null;       // the Insights card's row (💡 Insights, Interview patterns), read with the library
let insightBusy = false, insightNote = '';
let insightCollapsed = true;  // folded until you open it; the choice is remembered on this Mac
try { insightCollapsed = localStorage.getItem('ivInsightOpen') !== '1'; } catch {}

// Each part on its own, none waiting for another (owner, 30 Sep 2026: this awaited a fresh job list, a Python run of
// 10–60 s at start-up, before drawing anything, so the page showed only its table header).
let prefetched = false;
export function loadInterviews() {
  if (gatedOut('interviews')) return;   // behind the Notion gate: nothing reads it (#410)
  // Once per app session: installs what transcribing needs now, so the first Transcribe does not wait for it.
  if (!prefetched) { prefetched = true; iv.prefetch().catch(() => {}).finally(() => show($('iv-setup'), false)); }
  showPermission().catch(error => failed('permission', error));
  loadSaved();
  loadDrafts();
  loadJobList();
}
async function loadDrafts() {
  try { renderDrafts(await iv.drafts()); } catch (error) { failed('local recordings', error); }
}
// The job names in the library and the pickers: the list the Jobs page already has, else its last good copy; a fresh
// read (slow) only without either. The rows are drawn first and get their job names when it's there.
let jobListLoading = null;
function loadJobList() {
  if (jobList().length || jobListLoading) return jobListLoading;
  jobListLoading = (async () => {
    const saved = await window.pilot.cached('jobs').catch(() => null);
    const jobs = !jobList().length && (saved?.result?.jobs?.length ? saved.result.jobs : (await window.pilot.jobs().catch(() => null))?.jobs);
    if (Array.isArray(jobs) && jobs.length && !jobList().length) { shared.allJobs = jobs; if (ivSavedRows.length) renderAll(); }
  })().catch(error => failed('job list', error)).finally(() => { jobListLoading = null; });
  return jobListLoading;
}
// A part that failed: said on the page by the caller, and written to app.log (type and message, never values).
function failed(part, error) {
  console.error(`Interviews · ${part}:`, error);
  window.pilot.telemetryRecord('crash', {where: 'window', page: 'interviews', type: error?.name || 'Error',
    message: `${part}: ${error?.message || String(error)}`, stack: error?.stack}).catch(() => {});
}

const renderDrafts = drafts => renderDraftList(drafts, {openId: () => ivOpen, openDraft, openReview: id => openReview(id), closeEditor: () => { ivOpen = null; show($('iv-editor'), false); }});
const renderSpeakers = () => renderSpeakerFields(saveOpenDraft);
async function openDraft(id) {
  const draft = (await iv.drafts()).find(d => d.id === id);
  if (!draft) return;
  ivOpen = id;
  show($('iv-editor'));
  $('iv-title').value = draft.title || '';
  const busy = draft.status === 'transcribing';
  show($('iv-transcribe'), draft.kind === 'audio' && ['new', 'stopped', 'failed'].includes(draft.status));
  show($('iv-progress'), busy);
  show($('iv-ready'), draft.status === 'ready');
  if (draft.status === 'failed') message('iv-message', draft.error || 'Transcription failed', 'error');
  if (draft.status === 'ready') {
    $('iv-text').value = await iv.transcript(id);
    jobOptions($('iv-job'), draft.jobUrl || draft.suggestedJobUrl, ai('Let {AI} find the job when reviewing'));
    // A job matched by time to a calendar interview: shown as a suggestion; saving confirms it, changing the job replaces it.
    const suggested = !draft.jobUrl && draft.suggestedJobUrl;
    show($('iv-suggest'), !!suggested);
    if (suggested) $('iv-suggest').textContent = `Suggested from your calendar: ${draft.suggestedJob}. Change it below if this was a different interview.`;
    show($('iv-job-url'), false);
    $('iv-job-url').value = '';
    renderSpeakers();
  }
  renderDrafts(await iv.drafts());
  $('iv-editor').scrollIntoView({behavior: 'smooth', block: 'start'});
}


let draftTimer;
function saveOpenDraft() {
  if (!ivOpen) return Promise.resolve();
  clearTimeout(draftTimer);
  return iv.saveDraft(ivOpen, {title: $('iv-title').value, jobUrl: jobUrlOf($('iv-job'), $('iv-job-url')),
    ...($('iv-ready').hidden ? {} : {text: $('iv-text').value})});
}

// No page to open (the data on this Mac): the review in the app (renderer/interview-review-view.js).
async function openReview(id) {
  const record = await window.pilot.ivRecord(id);
  if (!record || record.error) { message('iv-message', `Review not read: ${record?.error || 'not found'}`, 'error'); return; }
  showReview(record, {$, el, pill});
}
async function saveToNotion(andReview) {
  await saveOpenDraft();
  const id = ivOpen;
  for (const button of ['iv-save', 'iv-save-review']) $(button).disabled = true;
  message('iv-message', `Saving to ${storeName()}…`);
  try {
    const result = await iv.save(id);
    if (!result.ok) { message('iv-message', result.error, 'error'); return; }
    ivOpen = null;
    show($('iv-editor'), false);
    renderDrafts(await iv.drafts());
    message('iv-message', `${savedTo()}.`, 'ok');
    await readAgain();
    if (andReview) reviewRow(result.id, 'Save & review');
  } finally {
    for (const button of ['iv-save', 'iv-save-review']) $(button).disabled = false;
  }
}

// Saved interviews, from Notion. Changing the job updates the row's Application there.
let reviewing = new Set();  // being reviewed: here (awaiting the call) or on GitHub (review-pending.js)
let reviewPoll = null;
const OUTCOME = {positive: 'Positive', neutral: 'Neutral', negative: 'Negative'};
const OUTCOME_TONE = {positive: 'good', neutral: 'warn', negative: 'bad'};
// While the library loads from Notion (like the Jobs list): a spinner in the empty table the first time;
// afterwards the rows stay and the subtitle says it's refreshing.
const savedTo = () => byStore('Saved to Notion 🎤 Interviews', 'Saved in Jobadabra');
// Loading: the last good list at once (lib/view-cache.js, "saved 3 min ago · updating…"); with nothing saved yet,
// skeleton rows in the table (the boxes are there, shimmering) until Notion answers.
async function showSavedLoading() {
  show($('iv-empty'), false);
  if (ivSavedRows.length) { $('iv-lib-stats').textContent = `Refreshing from ${storeName()}…`; return shownAt; }
  const saved = await window.pilot.cached('interviews').catch(() => null);
  if (saved?.result?.interviews?.length && !ivSavedRows.length) {
    ivSavedRows = saved.result.interviews;
    ivInsight = saved.result.insight || null;
    insightFresh = false;  // from this Mac's cache: the card says it's the saved copy
    renderAll();
    $('iv-lib-stats').textContent = `${savedTo()} · saved ${agoText(saved.at)}, updating…`;
    return saved.at;
  }
  $('iv-saved').replaceChildren(...skeletonRows());
  $('iv-insight').replaceChildren(...insightSkeleton());
  show($('iv-insight'));
  $('iv-lib-stats').textContent = `Loading from ${storeName()}…`;
  return null;
}
// One read at a time: coming back to the page while one runs waits for it (they piled up: each a Python run and a
// share of Notion's rate limit). A change made here (save, link, review, ↻) reads again once that one is done.
let savedLoad = null, loadAgain = false, shownAt = null;
function loadSaved(again = false) {
  if (savedLoad) { if (again) loadAgain = true; return savedLoad; }
  savedLoad = (async () => { do { loadAgain = false; await loadSavedOnce(); } while (loadAgain); })()
    .catch(error => failed('library', error)).finally(() => { savedLoad = null; });
  return savedLoad;
}
const readAgain = () => loadSaved(true);
// Each step of the library's load goes to logs/app.log (area "ui"): 7 Oct 2026 the page stayed on its skeleton while the
// engine's read had answered in 3 s, and nothing said which step the window was stuck on. Counts and flags only.
const libraryLog = (step, fields = {}) => window.pilot.uiLog(`interviews library: ${step}`, fields).catch(() => {});
async function loadSavedOnce() {
  const started = Date.now();
  libraryLog('load', {rows: ivSavedRows.length});
  try { shownAt = await showSavedLoading(); } catch (error) { failed('library (saved copy)', error); }
  libraryLog('asking the store', {cached: !!shownAt, ms: Date.now() - started});
  const result = await iv.saved().catch(error => ({ok: false, error: String(error?.message || error)}));
  libraryLog('answer', {ok: !!result?.ok, rows: Array.isArray(result?.interviews) ? result.interviews.length : -1,
    needsNotion: !!result?.needsNotion, ms: Date.now() - started});
  const next = afterLoad(result, {rows: ivSavedRows, at: shownAt});
  $('iv-lib-stats').textContent = next.ok ? savedTo() : next.stats || savedTo();
  if (!next.ok) {
    // The rows on screen (the last good copy) stay; without any, the table says why instead of staying empty.
    if (next.rows.length) { message('iv-message', next.error, 'error'); renderAll(); return; }
    ivSavedRows = [];
    $('iv-saved').replaceChildren();
    renderInsight();
    show($('iv-empty'));
    $('iv-empty').textContent = next.error;
    return;
  }
  shownAt = null;
  ivSavedRows = next.rows;
  ivInsight = next.insight;
  insightFresh = true;
  insightNote = next.insightError ? "Couldn't read the saved insights (see the app log)" : '';
  // Reviews running on GitHub stay "Reviewing…" until their outcome is in Notion; look again every 30 s meanwhile.
  const before = new Set(reviewing);
  reviewing = new Set([...reviewing, ...pendingReviews.settle(ivSavedRows)]);
  for (const id of reviewing) if (ivSavedRows.find(row => row.id === id)?.overall) reviewing.delete(id);
  // A review that just finished on GitHub writes its insight a little after the review row: while the insight is out of
  // date, look again a few times (30 s apart) so the card catches up by itself.
  const settled = [...before].some(id => !reviewing.has(id));
  if (settled) insightWaits = 4;
  clearTimeout(reviewPoll);
  if (reviewing.size) reviewPoll = setTimeout(readAgain, 30 * 1000);
  else if (next.insight?.outdated && insightWaits > 0) { insightWaits -= 1; reviewPoll = setTimeout(readAgain, 30 * 1000); }
  renderAll();
  libraryLog('drawn', {rows: ivSavedRows.length, ms: Date.now() - started});
}
// The library, then the Insights card, each on its own: a throw in one never blanks the other, and says so.
function renderAll() {
  try { renderSaved(); } catch (error) {
    failed('library', error);
    show($('iv-empty'));
    $('iv-empty').textContent = `Couldn't show your interviews (${error?.message || error}). The details are in the app log.`;
  }
  try { renderInsight(); } catch (error) { failed('insights', error); show($('iv-insight'), false); }
}

// Insights: what the reviewed interviews say together. Hidden until one interview is reviewed.
function renderInsight() {
  const view = insightView(ivInsight, ivSavedRows);
  show($('iv-insight'), !!view);
  insightShown = view;
  if (view) $('iv-insight').replaceChildren(...insightCard(view, {open: showRow, onMoments: title => showMoments(insightShown, showRow, title), onPractice: () => startPractice(insightShown?.steps || [], tickStep), refresh: refreshInsights,
    onTick: tickStep, onToggle: toggleInsight, collapsed: insightCollapsed, busy: insightBusy, note: insightNote, updating: !insightFresh && !!ivInsight}));
}
let insightShown = null, insightFresh = false, insightWaits = 0;
// "Updated 3 min ago" keeps up while the page is open.
setInterval(() => { if (insightShown && !$('iv-insight')?.hidden) renderInsight(); }, 60 * 1000);



// Fold the card to its header (remembered on this Mac: a view preference, not data).
function toggleInsight() {
  insightCollapsed = !insightCollapsed;
  try { localStorage.setItem('ivInsightOpen', insightCollapsed ? '' : '1'); } catch {}
  renderInsight();
}
// A "Practice next" tick: shown at once, saved in the insight row in Notion; if Notion refuses, it goes back and says so.
async function tickStep(step, done) {
  const steps = ivInsight?.next_steps || [];
  const mark = value => { const item = steps.find(s => s.text === step.text); if (item) item.done = value; };
  mark(done);
  const result = await iv.insightStep(step.text, done).catch(error => ({ok: false, error: String(error?.message || error)}));
  if (!result.ok) { mark(!done); message('iv-message', `Not saved: ${result.error || `${storeName()} refused it`}`, 'error'); }
  renderInsight();
}
// An interview named in the insights: its row in the library, scrolled to and lit up briefly.
function showRow(id) {
  const find = () => [...$('iv-saved').querySelectorAll('tr')].find(tr => tr.dataset.id === id);
  if (!find() && ($('iv-filter').value || $('iv-outcome').value)) { $('iv-filter').value = ''; $('iv-outcome').value = ''; renderSaved(); }
  const tr = find();
  if (!tr) { const row = ivInsight?.interviews?.find(item => item.id === id); if (row?.url) window.pilot.openNotion(row.url); return; }
  tr.scrollIntoView({behavior: 'smooth', block: 'center'});
  tr.classList.add('is-flash');
  setTimeout(() => tr.classList.remove('is-flash'), 1600);
}
async function refreshInsights() {
  if (!aiReady()) { message('iv-message', 'Choose your AI in Settings (Claude Code, Codex or an API key) to get insights.', 'error'); return; }
  insightBusy = true; insightNote = '';
  renderInsight();
  const result = await iv.insights().catch(error => ({ok: false, error: String(error?.message || error)}));
  insightBusy = false;
  if (result.ok) {
    if (result.insight !== undefined) ivInsight = result.insight;
    insightNote = result.status === 'unchanged' ? 'Up to date' : '';
    message('iv-message', result.status === 'unchanged' ? 'Insights are up to date: no review changed since the last update (no AI cost).' : result.text, 'ok');
  } else {
    message('iv-message', humanError(result.error || 'Could not refresh the insights'), 'error');
  }
  renderInsight();
}
function renderSaved() {
  const restoreMenu = holdMenu(document.querySelector('.view[data-view="interviews"]'), 'id');   // Why (31 Oct 2026, owner): an open ⋯ menu survives the redraw a finished read causes; only a menu on this page
  const text = $('iv-filter').value.trim().toLowerCase(), outcome = $('iv-outcome').value;
  const rows = ivSavedRows.filter(row => {
    const job = row.application?.[0] ? jobForPage(row.application[0]) : null;
    const words = `${row.title} ${row.round || ''} ${row.next_step || ''} ${job?.title || ''} ${job?.company || ''}`.toLowerCase();
    return (!text || words.includes(text)) && (!outcome || (outcome === 'none' ? !row.overall : row.overall === outcome));
  });
  show($('iv-empty'), rows.length === 0);
  $('iv-empty').textContent = ivSavedRows.length ? 'No interview matches this filter.' : byStore('No interviews in Notion yet.', 'No saved interviews yet.');
  $('iv-saved').replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;
    const cell = (...children) => { const td = document.createElement('td'); td.append(...children); tr.append(td); return td; };
    const job = row.application?.[0] ? jobForPage(row.application[0]) : null;
    cell(row.date ? new Date(`${row.date}T12:00:00`).toLocaleDateString([], {day: 'numeric', month: 'short', year: 'numeric'}) : '').className = 'iv-date';

    // Job: company badge, the company and the role it's linked to (or why none is).
    const jobCell = el('div', 'lib-who');
    const logo = avatar(job?.company || job?.title || row.title);
    const badge = el('span', 'logo', logo.initials);
    badge.style.setProperty('--hue', logo.hue);
    const jobLines = el('div', '');
    const cellJob = interviewJob(row, job, {links: inNotion()});
    let openPicker = () => {};
    if (cellJob.kind === 'job') {
      // The job's name opens it in the Jobs view (only that job listed).
      const open = Object.assign(el('button', 'link', cellJob.name), {type: 'button', title: 'Open this job in the Jobs list'});
      open.addEventListener('click', () => { openView('jobs'); showJobsIn(cellJob.name, [job.url]); });
      jobLines.append(el('b', '', ''));
      jobLines.firstChild.append(open);
      if (cellJob.role) jobLines.append(el('div', 'muted small', cellJob.role));
    } else if (cellJob.kind === 'notion') {
      const open = Object.assign(el('button', 'link', cellJob.name), {type: 'button', title: 'This job is not in the app list: open it in Notion'});
      open.addEventListener('click', event => window.pilot.openNotion(cellJob.notion, event.metaKey));
      jobLines.append(open);
    } else {
      const link = Object.assign(el('button', 'link small', 'Link a job'), {type: 'button', title: `Choose the job this interview belongs to (updates ${storeName()})`});
      jobLines.append(el('span', 'muted', cellJob.name), el('div', '', ''));
      jobLines.lastChild.append(link);
      link.addEventListener('click', () => openPicker());
    }
    jobCell.append(badge, jobLines);
    // Interview: the round (or the interview's own title), and the next step.
    const who = el('div', '');
    who.append(el('b', '', row.round || row.title));
    who.append(el('div', 'muted small', row.next_step ? `Next: ${row.next_step}` : 'Next step not stated'));
    // Change job…: the job picker, shown on the row when asked for from the menu.
    const picker = el('div', 'iv-picker');
    picker.hidden = true;
    const select = document.createElement('select');
    jobOptions(select, job?.url || '', row.application?.[0] && !job ? byStore('Linked in Notion (job not in this list)', 'Linked (job not in this list)') : 'No job linked');
    if (row.application?.[0] && !job) select.value = '';
    const pasted = Object.assign(document.createElement('input'), {type: 'url', placeholder: 'https://… then Enter', hidden: true});
    const relink = async url => {
      select.disabled = pasted.disabled = true;
      message('iv-message', `Linking in ${storeName()}…`);
      const done = await iv.link(row.id, url);
      select.disabled = pasted.disabled = false;
      message('iv-message', done.ok ? `"${row.title}" is now ${url ? 'linked to that job' : 'not linked to a job'} in ${storeName()}.` : done.error, done.ok ? 'ok' : 'error');
      if (done.ok) {
        if (url && !jobList().some(j => j.url === url && j.notion_url)) {  // just added to Applications
          try { const fresh = (await window.pilot.jobs()).jobs; if (Array.isArray(fresh)) shared.allJobs = fresh; } catch {}
        }
        readAgain();
      }
    };
    select.addEventListener('change', () => {
      show(pasted, select.value === PASTE);
      if (select.value === PASTE) pasted.focus(); else relink(select.value);
    });
    pasted.addEventListener('change', () => { if (/^https?:\/\//.test(pasted.value.trim())) relink(pasted.value.trim()); });
    picker.append(select, pasted);
    openPicker = () => { picker.hidden = false; select.focus(); };
    cell(jobCell, picker).className = 'iv-job';
    cell(who);

    // Where: the job in this list, else the linked Applications row (a job applied to outside Jobadabra).
    const place = job || row.place || {};
    cell(placeAndMode(place.location, place.work_mode) || '–').className = 'iv-where';
    cell(row.overall ? pill(OUTCOME[row.overall] || row.overall, OUTCOME_TONE[row.overall] || 'neutral', {dot: true})
      : pill(reviewing.has(row.id) ? 'Reviewing…' : 'Not reviewed', reviewing.has(row.id) ? 'signal' : 'neutral', {dot: true}));

    // Actions: open the review (or get one), then the rest in ⋯.
    const actions = el('div', 'row-actions');
    let main;
    if (row.overall) {
      main = el('button', 'secondary iv-main', 'Open review');
      main.title = byStore('The review and transcript, in Notion', 'The review and transcript');
      main.addEventListener('click', event => (row.url ? window.pilot.openNotion(row.url, event.metaKey) : openReview(row.id)));
    } else {
      main = Object.assign(el('button', 'secondary iv-main', reviewing.has(row.id) ? 'Reviewing…' : 'Review'), {disabled: reviewing.has(row.id),
        title: ai(byStore('{AI:big} reviews it question by question; the review is added to the Notion page', '{AI:big} reviews it question by question; the review is saved with it'))});
      main.addEventListener('click', () => reviewRow(row.id));
    }
    const menu = [
      ...(row.url ? [{label: '↗ Open interview in Notion', run: event => window.pilot.openNotion(row.url, event.metaKey)}] : []),
      ...(cellJob.notion ? [{label: '↗ Open job in Notion', run: event => window.pilot.openNotion(cellJob.notion, event.metaKey)}] : []),
      {label: cellJob.kind === 'none' ? 'Link a job…' : 'Change job…', run: () => openPicker(), title: `Link this interview to another job (updates ${storeName()})`},
      ...(row.overall ? [{again: true, run: () => reviewAgainRow(row.id)}] : []),  // built when the menu opens (busy or not)
      '-',
      {label: 'Delete', danger: true, title: osText(byStore("Moves the row to Notion's trash (restorable for 30 days) and deletes its recording on this Mac", 'Deletes the interview and its recording on this Mac')), run: async () => {
        if (!confirm(osText(byStore(`Delete "${row.title}"? It goes to Notion's trash (30 days) and its recording is removed from this Mac.`,
          `Delete "${row.title}" and its recording on this Mac?`)))) return;
        const done = await iv.remove(row.id);
        message('iv-message', done.ok ? osText(byStore(`Deleted "${row.title}": in Notion's trash for 30 days${done.removed ? ', its recording removed from this Mac' : ''}.`,
          `Deleted "${row.title}"${done.removed ? ' and its recording' : ''}.`))
          : done.error, done.ok ? 'ok' : 'error');
        readAgain();
      }},
    ];
    actions.append(main, moreButton(() => menu.map(item => (item.again ? reviewAgain.againItem(row, reviewingAgain.has(row.id), item.run) : item)),
      byStore('More: open in Notion, change job, review again, delete', 'More: change job, review again, delete')));
    cell(actions);
    return tr;
  }));
  restoreMenu();
}

async function reviewRow(pageId, why = 'Review') {
  if (!aiReady()) { message('iv-message', 'Choose your AI in Settings (Claude Code, Codex or an API key) to get reviews.', 'error'); return; }
  if (reviewing.has(pageId)) return;  // already asked for: a second press must not spend a second review (1 Oct 2026)
  reviewing.add(pageId);
  message('iv-message', ai('{AI} is reviewing the interview (about a minute)…'));
  readAgain();
  const result = await iv.review(pageId, why);
  if (result.ok && result.cloud) pendingReviews.add(pageId);  // GitHub reviews it: keep "Reviewing…" until it lands
  else reviewing.delete(pageId);
  message('iv-message', result.ok ? (result.already ? result.summary : `${result.summary}. ${byStore('The review is on the Notion page.', 'The review is saved with it.')}`) : humanError(result.error), result.ok ? 'ok' : 'error');
  readAgain();
}

// ⋯ Review again (renderer/review-again.js): a reviewed row, re-run on its saved transcript; the press is the ask.
const reviewingAgain = new Set();
async function reviewAgainRow(pageId) {
  if (reviewingAgain.has(pageId)) return;
  if (!aiReady()) { message('iv-message', 'Choose your AI in Settings (Claude Code, Codex or an API key) to get reviews.', 'error'); return; }
  reviewingAgain.add(pageId);
  message('iv-message', ai(reviewAgain.START));
  const result = await iv.review(pageId, 'Review again').catch(error => ({ok: false, error: String(error?.message || error)}));
  reviewingAgain.delete(pageId);
  message('iv-message', ...reviewAgain.doneMessage(result));
  if (result.ok) loadSaved();
}


// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  searchSelect($('iv-job'));
  const remind = await iv.remindGet().catch(() => ({on: true}));
  $('iv-remind').checked = remind.on;
  $('iv-remind').addEventListener('change', event => iv.remindSet(event.target.checked));
  window.pilot.onOpenInterviews(() => document.querySelector('.nav[data-view="interviews"]').click());
  $('iv-permission-open').addEventListener('click', () => openPrivacySettings());
  $('iv-permission-restart').addEventListener('click', () => { if (!isRecording()) iv.relaunch(); });
  $('iv-title').addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveOpenDraft, 600); });
  $('iv-text').addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(() => { saveOpenDraft(); renderSpeakers(); }, 800); });
  $('iv-job').addEventListener('change', () => {
    show($('iv-job-url'), $('iv-job').value === PASTE);
    if ($('iv-job').value === PASTE) $('iv-job-url').focus(); else saveOpenDraft();
  });
  $('iv-job-url').addEventListener('change', saveOpenDraft);
  $('iv-close').addEventListener('click', async () => { await saveOpenDraft(); ivOpen = null; show($('iv-editor'), false); renderDrafts(await iv.drafts()); });

  $('iv-transcribe-go').addEventListener('click', async () => {
    const id = ivOpen;
    await saveOpenDraft();
    message('iv-message', '');
    show($('iv-transcribe'), false);
    show($('iv-progress'));
    $('iv-progress-text').textContent = 'Starting';
    $('iv-progress-bar').style.width = '2%';
    const meta = await iv.transcribe(id, {speakers: Number($('iv-count').value)});
    show($('iv-setup'), false);
    if (ivOpen === id) openDraft(id);
    if (meta.status !== 'ready') message('iv-message', meta.error || 'Transcription failed', 'error');
  });
  window.pilot.onInterviewProgress(({id, percent, text, setup}) => {
    showSetupProgress({percent, text, setup});   // the one-time downloads show at the top of the page whichever draft is open, or none
    if (id !== ivOpen) return;
    show($('iv-progress'));
    $('iv-progress-text').textContent = text;
    $('iv-progress-percent').textContent = percent == null ? '' : `${percent}%`;
    if (percent != null) $('iv-progress-bar').style.width = `${Math.max(2, percent)}%`;
  });

  $('iv-add').addEventListener('click', async () => {
    const draft = await iv.add();
    if (!draft) return;
    if (draft.error) { message('iv-message', draft.error, 'error'); return; }
    message('iv-message', '');
    openDraft(draft.id);
  });
  $('iv-save').addEventListener('click', () => saveToNotion(false));
  $('iv-save-review').addEventListener('click', () => saveToNotion(true));
  $('iv-discard').addEventListener('click', async () => {
    if (!ivOpen) return;
    await iv.discard(ivOpen);
    ivOpen = null;
    show($('iv-editor'), false);
    renderDrafts(await iv.drafts());
  });
  $('iv-filter').addEventListener('input', renderSaved);
  $('iv-outcome').addEventListener('change', renderSaved);
  $('iv-refresh').addEventListener('click', readAgain);
  $('iv-recordings').addEventListener('click', () => iv.recordings());
  $('practice-dialog').addEventListener('close', endPractice);
  // Consent first: Record stays off until the box is ticked, and the tick is asked again for every call.
  $('iv-consent').addEventListener('change', () => { $('iv-record').disabled = !$('iv-consent').checked || isRecording(); });

  $('iv-record').addEventListener('click', () => startRecording(false, openDraft));
  $('iv-mic-only').addEventListener('click', () => startRecording(true, openDraft));
  window.pilot.onCallLevel(level => onLevel(level));
  $('iv-stop').addEventListener('click', () => stopRecording());
}
