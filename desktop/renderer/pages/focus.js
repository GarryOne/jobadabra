// Focus page: what can't wait (Up next: offers, calls to book, replies, interview prep, follow-ups), what can (Suggestions:
// pages/focus-suggestions.js), history, and the daily target.
import {withSaveProgress} from '../save-progress.js';
import {el, moreButton, pill} from '../components.js';
import {icon} from '../icons.js';
import {EMPTY_FUNNEL_HINT, funnelIsEmpty, funnelSteps, inboundSteps} from '../funnel-view.js';
import {shared} from './shared.js';
import {OUTDATED_LINE, isOutdated, relaunch, restartButton} from '../errors.js';
import {$, savedAgo, show} from './core.js';
import {jobsChanged, openLogFor, showJobsIn} from './jobs.js';
import {openView} from './nav.js';
import {openJobPanel} from './job-panel.js';
import {loadReports} from './reports.js';
import {openSetting} from './settings.js';
import {toastMessage} from './startup.js';
import {initSuggestions, renderFocusSuggestions} from './focus-suggestions.js';
import {upNext} from '../suggestions.js';
import {openFeedback, saveFeedbackAction} from './feedback.js';
import {dismissInterview, openHappened} from './happened.js';
import {moveEmail, whichJob} from './reassign.js';
import {openPrep} from './prep.js';
import {prepCard} from '../prep-card.js';
import {renderOnboarding} from './focus-onboarding.js';
import {paintChartFirst, progressChart} from './focus-chart.js';
import {byStore, storeName} from '../store-words.js';
import {gatedOut} from './notion-connect.js';
import {NO_PLACE} from '../targets.js';

// Focus page state, declared before the start-up code opens Focus (a later `let` isn't usable yet then).
let focusLoading = null, focusShown = false;

// ---------- Focus: what to do next (src/focus.py, from Notion, no AI) ----------
export function focusButton(label, className, run) {
  const button = Object.assign(document.createElement('button'), {className, textContent: label});
  button.addEventListener('click', run);
  return button;
}
/** Opens a store page: a Notion one in the Notion app (⌘-click: a new tab), any other link in the browser. Used by Focus and its Suggestions. */
export function openLink(url, event) {
  if (/notion\.(so|com)\//.test(url)) window.pilot.openNotion(url, event?.metaKey); else window.pilot.openExternal(url);
}
export const bone = (className = '') => el('span', `skeleton ${className}`);  // a grey placeholder bar while loading
// First load: skeleton cards (the page's shape, greyed); later the content stays while it refreshes.
function focusSkeleton() {
  $('focus-count-note').textContent = 'Checking replies, interviews and applications';
  $('focus-list').replaceChildren(...[0, 1, 2].map(() => {
    const li = el('li', 'focus-item is-loading');
    const body = el('div', 'focus-body');
    body.append(bone('w-20'), bone('w-60 tall'), bone('w-40'));
    const actions = el('div', 'focus-actions');
    actions.append(bone('button'), bone('button small'));
    li.append(el('span', 'focus-round skeleton-round'), body, actions);
    return li;
  }));
  $('focus-count').replaceChildren(bone('w-number tall'));
  $('focus-pct').textContent = '';
  $('focus-summary').replaceChildren(bone('w-80'), bone('w-60'));
  const suggestion = el('li', 'focus-item is-loading');
  suggestion.append(el('span', 'focus-round skeleton-round'), (() => { const d = el('div', 'focus-body'); d.append(bone('w-60 tall'), bone('w-80')); return d; })());
  $('focus-suggestions-list').replaceChildren(suggestion);
  show($('focus-suggestions'));
  $('funnel-steps').replaceChildren(...[0, 1, 2, 3, 4].map(() => {
    const li = el('li', 'funnel-step is-loading');
    li.append(bone('w-40'), bone('w-30 tall'), bone('w-80'));
    return li;
  }));
  show($('focus-funnel'));
  show($('focus-empty'), false);
}
function focusStatus(text, busy = false) {
  $('focus-status').replaceChildren(...(busy ? [el('span', 'spinner small')] : []), document.createTextNode(text));
}
let focusUpdatedAt = 0;
// A row you just finished (Skip, Done) leaves the list at once. Notion is slow: its next read, and the saved Focus painted first on every
// reload or start (lib/view-cache.js), can still contain it. So the hold lives on this Mac (localStorage, survives a reload) for ten minutes,
// longer than Notion takes to list a new write, and is dropped as soon as a read no longer has the row (5 Oct 2026: a dismissed card came back
// after a refresh or a reload, then left again; the hold was in memory only and ended after a minute).
const HOLD_MS = 10 * 60000, HOLD_KEY = 'focusHolds';
const savedHolds = () => {
  try { return Object.entries(JSON.parse(localStorage.getItem(HOLD_KEY) || '{}')).filter(([, until]) => until > Date.now()); } catch { return []; }
};
const settled = new Map(savedHolds());
const keepHolds = () => { try { localStorage.setItem(HOLD_KEY, JSON.stringify(Object.fromEntries(settled))); } catch { /* private window: the hold lasts until reload */ } };
const itemKey = item => `${item.kind}:${item.page_id || ''}${item.event_id ? `:${item.event_id}` : ''}`;
function hideSettled(items, now = Date.now()) {
  const before = settled.size;
  for (const [key, until] of [...settled]) {
    if (now > until || !items.some(item => itemKey(item) === key)) settled.delete(key);
  }
  if (settled.size !== before) keepHolds();
  return items.filter(item => !settled.has(itemKey(item)));
}
function dismiss(item) {
  settled.set(itemKey(item), Date.now() + HOLD_MS);
  keepHolds();
  if (lastFocus) renderFocus(lastFocus);
  focusStatus('Saving…', true);
}
// A question answered in a dialog (Which job?) leaves the list at once too; undone if Notion refuses it.
export const holdItem = item => dismiss(item);
export function releaseItem(item) { settled.delete(itemKey(item)); keepHolds(); if (lastFocus) renderFocus(lastFocus); }
async function finishItem(item, save) {
  dismiss(item);
  let done;
  try { done = await save(); }
  catch (error) { done = {ok: false, error: error.message}; }
  if (!done?.ok) {
    settled.delete(itemKey(item));
    keepHolds();
    if (lastFocus) renderFocus(lastFocus);
    toastMessage('Not saved', done?.error || `${storeName()} could not save it. Try again.`, {view: 'focus'}, 'bad');
    return;
  }
  if (focusLoading) await focusLoading.catch(() => {});
  loadFocus();
}
// The Focus items as last read (the job drawer's Messages tab asks which emails wait on a job): [] before Focus has loaded.
export const focusItems = () => lastFocus?.items || [];
export function loadFocus() {
  if (gatedOut('focus')) return Promise.resolve();   // behind the Notion gate: nothing reads it (#410)
  focusLoading ||= loadFocusOnce().catch(error => {
    // Never a blank page: say what went wrong where the list goes.
    focusStatus('Could not load');
    const li = el('li', 'focus-item muted');
    li.textContent = isOutdated(error) ? OUTDATED_LINE : `Focus could not load: ${error?.message || error}. Try Refresh.`;
    if (isOutdated(error)) li.append(' ', restartButton());
    $('focus-list').replaceChildren(li);
  }).finally(() => { focusLoading = null; $('focus-refresh').disabled = false; });
  return focusLoading;
}
async function loadFocusOnce() {
  $('focus-refresh').disabled = true;
  focusStatus('Syncing your jobs…', true);
  const setting = await window.pilot.dailyTarget();
  showTarget(setting.target);
  $('focus-remind').checked = setting.reminders;
  $('focus-of').textContent = `/ ${setting.target} applications today`;
  if (!focusShown) {  // the last good Focus at once (lib/view-cache.js), else the skeleton; the fresh one follows
    const saved = await window.pilot.cached('focus');
    if (saved?.result?.focus) { renderFocus(saved.result.focus); focusStatus(`Saved ${savedAgo(saved.at)} · updating…`, true); }
    else focusSkeleton();
  }
  const result = await window.pilot.focus();
  if (!result.ok) {
    focusStatus(result.error || byStore('Could not read your Notion.', 'Could not read your data.'));
    if (!focusShown) $('focus-list').replaceChildren();
    return;
  }
  renderFocus(result.focus);
  focusUpdatedAt = Date.now();
  focusStatus('Updated just now');
}
function focusCard(item) {
  const li = el('li', `focus-item tone-${item.tone || 'neutral'}`);
  const round = el('span', 'focus-round');
  round.append(icon(item.icon || 'check'));
  const body = el('div', 'focus-body');
  const meta = el('div', 'focus-meta muted small');
  // A prep row says where its kit is: being built, ready (when), from an earlier call (why), or what it will cover.
  const prep = item.kind === 'prepare' ? prepCard(item) : null;
  const parts = (prep ? prep.meta : item.meta || []).filter(Boolean);
  parts.forEach((part, i) => { if (i) meta.append(el('span', 'sep', '·')); meta.append(el('span', part.startsWith('✓') ? 'is-done' : '', part)); });
  const top = el('div', 'focus-top');  // the headline and its badge on one line: a compact row
  top.append(el('span', 'focus-headline', item.headline || item.title), pill(item.badge || '', item.tone || 'neutral', {dot: true}));
  body.append(top, meta);
  body.title = item.detail || '';
  const actions = el('div', 'focus-actions');
  if (item.kind === 'feedback') actions.append(focusButton('Ask for feedback', 'primary', () => openFeedback(item, 'request')));
  if (item.kind === 'feedback_wait') actions.append(focusButton('Add feedback', 'primary', () => openFeedback(item, 'receive')));
  if (item.kind === 'feedback_review') actions.append(focusButton('Read feedback', 'primary', () => openFeedback(item, 'review')));
  if (item.link && !item.kind.startsWith('feedback')) actions.append(focusButton(item.link_label || 'Open', 'primary', event => openLink(item.link, event)));
  if (item.kind === 'details') {
    actions.append(focusButton('Add details', 'primary',
      () => openLogFor(item.job_url, `${item.company || item.via || '—'} · ${item.job}`)));
    const skip = focusButton('Skip', 'secondary', () => finishItem(item, () => window.pilot.focusDone(item.page_id, 'details_skipped')));
    skip.title = "I don't know the employer yet";
    actions.append(skip);
  }
  if (item.kind === 'which_job') {  // an email the Gmail check wasn't sure about: your answer places it
    if (item.suggested_url) actions.append(focusButton('Yes, that job', 'primary', async event => {
      event.currentTarget.disabled = true;
      await moveEmail(item.event_id, item.suggested_url, item);
    }));
    actions.append(focusButton(item.suggested_url ? 'Other job…' : 'Pick the job', item.suggested_url ? 'secondary' : 'primary', () => whichJob(item)));
  }
  if (item.kind === 'apply') actions.append(focusButton('Browse jobs', 'primary', () => openView('jobs')));
  if (item.kind === 'review') actions.append(focusButton('Interviews', 'primary', () => openView('interviews')));
  if (item.kind === 'happened' && item.page_id) {  // its time passed, nothing recorded: yes (notes) or no (moved/cancelled)
    const no = focusButton('No', 'secondary', () => openHappened(item, 'no'));
    no.title = 'It was cancelled or moved';  // a short label: the row keeps room for the company's name
    actions.append(focusButton('Yes, it happened', 'primary', () => openHappened(item, 'yes')), no);
  }
  // The prep kit: built on the job's page (a button press: it costs about $0.04), then opened there. A kit from an
  // earlier call offers the new one first; the earlier kit stays on the page, in the ⋯ menu.
  // A ready kit: its Notion page, else the job's page here on its Prep tab (the 'open' state had no target on a store without pages).
  const jobOf = () => ({url: item.job_url, title: item.job, company: item.company});
  const prepRun = run => (run === 'open' ? event => (item.notion_url ? openLink(item.notion_url, event) : (openView('jobs'), openJobPanel(jobOf(), 'prep'))) : () => {
    markPrep(item.page_id, 'building');  // the row says "Building…" before the dialog, not after Notion
    openPrep(item);
  });
  if (prep && item.page_id) {
    const main = focusButton(prep.primary.label, prep.primary.tone, prepRun(prep.primary.run));
    if (prep.primary.title) main.title = prep.primary.title;
    if (prep.primary.run === 'join') main.prepend(el('span', 'spinner small'));
    actions.append(main);
  }
  if (!item.link && ['reply', 'book', 'offer', 'nudge', 'waiting', 'follow_up'].includes(item.kind) && (item.notion_url || item.job_url)) {
    actions.append(focusButton('Open', 'primary', event => (item.notion_url ? openLink(item.notion_url, event) : (openView('jobs'), openJobPanel(jobOf())))));
  }
  if (item.done && item.page_id) actions.append(focusButton('Done', 'secondary', () => finishItem(item,
    () => window.pilot.focusDone(item.page_id, item.kind === 'follow_up' ? 'followed_up' : 'replied'))));
  const more = [];
  if (item.kind.startsWith('feedback') && item.kind !== 'feedback_wait') more.push({label: 'Add employer feedback', run: () => openFeedback(item, 'receive')});
  if (item.kind === 'feedback') more.push({label: 'Skip this request', run: async () => {
    dismiss(item);   // it leaves at once, like Done and Skip; undone if Notion refuses it
    const result = await saveFeedbackAction(item, 'skip');
    if (!result.ok) { releaseItem(item); toastMessage('Not saved', result.error, {view: 'focus'}, 'bad'); }
  }});
  if (item.notion_url) more.push({icon: 'layers', label: 'Open in Notion', run: event => openLink(item.notion_url, event)});
  if (item.job_url && item.job_url !== item.link && !/jobpilotto|mail\.google/.test(item.job_url)) more.push({icon: 'external', label: 'Open posting', run: () => window.pilot.openExternal(item.job_url)});
  if (['follow_up', 'nudge', 'waiting'].includes(item.kind) && item.job_url && item.page_id) more.push({icon: 'close', label: "I'm out: withdraw",
    title: `You no longer want this job: it is marked Withdrawn in ${storeName()} and leaves Focus`,
    run: () => finishItem(item, () => window.pilot.markOutcome({url: item.job_url, outcome: 'withdrawn'}).then(result => { if (result?.ok) jobsChanged(); return result; }))});
  if (item.kind === 'which_job') more.push({icon: 'close', label: 'Dismiss', run: () => moveEmail(item.event_id, 'none', item)});
  if (item.kind === 'prepare' && item.page_id) more.push({icon: 'close', label: 'Dismiss interview',
    run: () => dismissInterview(item, {onConfirmed: () => holdItem(item), onFail: () => releaseItem(item)})});
  if (prep && item.page_id) prep.more.forEach(entry => more.push({icon: entry.icon, label: entry.label, run: prepRun(entry.run)}));
  if (item.kind === 'apply') more.push({icon: 'target', label: 'Change the daily target', run: () => editTarget()});
  if (item.detail) more.push({icon: 'info', label: 'Details', run: () => toastMessage(item.headline || item.title, item.detail, NO_PLACE.itself, 'info')});
  if (more.length) actions.append(moreButton(more, 'More'));
  li.append(round, body, actions);
  return li;
}
// History: what you resolved from Focus (replied, asked for feedback, skipped, rated insights), from Notion.
let historyShown = false;
function showHistory(on) {
  historyShown = on;
  $('focus-up-title').textContent = on ? 'History' : 'Up next';
  $('focus-history-toggle').textContent = on ? '← Up next' : 'History';
  show($('focus-count-note'), !on);
  show($('focus-list'), !on);
  show($('focus-empty'), !on && !$('focus-list').children.length);
  show($('focus-history'), on);
  if (on) loadHistory();
}
const dayOf = iso => {
  const day = new Date(iso), today = new Date();
  const diff = Math.round((new Date(today.toDateString()) - new Date(day.toDateString())) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : day.toLocaleDateString([], {weekday: 'short', day: 'numeric', month: 'short'});
};
async function loadHistory() {
  const list = $('focus-history');
  list.replaceChildren(el('li', 'muted small', byStore('Loading from Notion…', 'Loading…')));
  const {ok, items = [], error} = await window.pilot.focusHistory().catch(failure => ({ok: false, error: failure.message}));
  if (!historyShown) return;
  if (!ok) { list.replaceChildren(el('li', 'message error', `Couldn't read your history from Notion: ${error || 'try again'}`)); return; }
  if (!items.length) { list.replaceChildren(el('li', 'muted', 'Nothing resolved yet. What you mark done here shows up in this list.')); return; }
  const rows = [];
  let day = '';
  for (const item of items) {
    const label = dayOf(item.at);
    if (label !== day) { day = label; rows.push(el('li', 'focus-history-day', label)); }
    const row = el('li', 'focus-history-row');
    const words = el('div', 'focus-history-words');
    words.append(el('b', '', item.title));
    if (item.note) words.append(el('span', 'muted small', item.note));
    const side = el('div', 'focus-history-side');
    if (/T\d/.test(item.at)) side.append(el('span', 'muted small', new Date(item.at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})));
    if (item.url) {
      const open = el('button', 'link small', 'Notion ↗');
      open.addEventListener('click', event => window.pilot.openNotion(item.url, event.metaKey));
      side.append(open);
    }
    // Done: a green tick (what kind of to-do it was is in its title).
    const done = el('span', 'focus-history-done');
    done.append(icon('tick'));
    row.append(done, words, side);
    rows.push(row);
  }
  list.replaceChildren(...rows);
}
// The prep dialog tells the row at once (not after Focus is read again from Notion): building, ready, or back to idle.
let lastFocus = null;
// Emails the last Gmail check could not place (Needs you). Recent activity asks about them on that check.
// The prep-kit button for an interview, as Focus draws it (prep-card.js): "Build prep kit", "Open prep kit" or "Build new
// prep kit", for the company's interview in Focus; null when Focus holds none (not loaded, or not an upcoming interview).
export function prepAction(company) {
  const key = String(company || '').toLowerCase().trim();
  const item = key && (lastFocus?.items || []).find(one => one.kind === 'prepare' && one.page_id && String(one.company || '').toLowerCase().trim() === key);
  if (!item) return null;
  const {primary} = prepCard(item);
  const run = primary.run === 'open' ? event => (item.notion_url ? window.pilot.openNotion(item.notion_url, event?.metaKey)
      : (openView('jobs'), openJobPanel({url: item.job_url, title: item.job, company: item.company}, 'prep')))
    : primary.run === 'join' ? () => openView('focus') : () => { markPrep(item.page_id, 'building'); openPrep(item); };
  return {label: primary.label, title: primary.title || '', busy: primary.run === 'join', run};
}
export const pendingMailQuestions = () => (lastFocus?.items || []).filter(item => item.kind === 'which_job');
// null until Focus has loaded: nothing can be called answered before then.
export const lastQuestions = () => (lastFocus ? pendingMailQuestions() : null);
// The questions you have answered (subject + the job it went to), or null until Focus has loaded.
export const lastAnswered = () => (lastFocus ? lastFocus.answered_questions || [] : null);
export function markPrep(pageId, state) {
  const item = lastFocus?.items?.find(one => one.kind === 'prepare' && one.page_id === pageId);
  if (!item) return;
  item.building = state === 'building';
  if (state === 'ready') Object.assign(item, {prep_at: new Date().toLocaleDateString('en-CA'), prep_stale: false});
  renderFocus(lastFocus);
}
function renderFocus(data) {
  const {today, funnel, summary} = data;
  // A kit still building keeps its state when Focus is read again meanwhile.
  for (const item of data.items) {
    const before = lastFocus?.items?.find(one => one.kind === 'prepare' && one.page_id === item.page_id && one.building);
    if (item.kind === 'prepare' && before) item.building = true;
  }
  lastFocus = data;
  document.dispatchEvent(new Event('focus-rendered'));   // Recent activity's Gmail card shows the questions' state
  const all = hideSettled(data.items), items = upNext(all);
  window.dispatchEvent(new Event('focus-updated'));
  focusShown = true;
  $('focus-count-note').replaceChildren(pill(`${items.length} action${items.length === 1 ? '' : 's'}`, 'neutral'));
  $('focus-list').replaceChildren(...items.map(focusCard));
  show($('focus-empty'), !items.length && !historyShown);
  renderFocusSuggestions({entries: data.suggestions, hidden: data.suggestions_hidden, items: all, card: focusCard});
  const pct = Math.min(100, Math.round(100 * today.applied / Math.max(today.target, 1)));
  $('focus-count').textContent = String(today.applied);
  $('focus-of').textContent = `/ ${today.target} applications today`;
  showTarget(today.target);
  $('focus-bar').style.width = `${pct}%`;
  progressChart(today.history || [], today.target);
  $('focus-pct').textContent = `${pct}%`;
  $('focus-summary').textContent = summary || '';
  renderFunnel(funnel);
  renderOnboarding({funnel});
}
function showInJobs(label, urls) {  // a funnel step's click: those opportunities in the Jobs list
  openView('jobs');
  showJobsIn(label, urls, 'focus');
}
// The application funnel (outbound): each step's count and its share of the first step; the full view is in Notion.
// Under it, the inbound funnel (opportunities that found you), only once one did.
function renderFunnel(funnel) {
  const steps = (funnel?.steps || []).slice(0, 5);
  show($('focus-funnel'), steps.length > 0);
  const inbound = inboundSteps(funnel?.inbound);
  show($('focus-inbound'), inbound.length > 0);
  $('inbound-steps').replaceChildren(...funnelSteps(inbound, showInJobs));
  if (!steps.length) return;
  const empty = funnelIsEmpty(steps);  // nothing prepared yet: the steps stay (the shape of the pipeline), greyed, with a line saying so
  $('focus-funnel').classList.toggle('is-empty', empty);
  $('funnel-empty').textContent = EMPTY_FUNNEL_HINT;
  show($('funnel-empty'), empty);
  const first = Math.max(steps[0].reached, 1);
  $('funnel-steps').replaceChildren(...funnelSteps(steps.map(step => {
    const share = Math.round(100 * step.reached / first);
    const name = step.step.replace(/^\S+\s/, '');
    // How many ever reached this step (it only grows: a later rejection doesn't take one back) and their share.
    return {name, reached: step.reached, share, urls: step.urls, label: `Ever reached ${name}`, weak: funnel.improve?.step === step.step,
      title: `${step.reached} ever reached this step (${share}% of all prepared), whatever happened after`};
  }), showInJobs));
  $('funnel-improve').textContent = funnel.improve ? `To improve: ${funnel.improve.step.replace(/^\S+\s/, '')}. ${funnel.improve.advice}` : '';
  show($('funnel-improve'), !!funnel.improve);
  // The full funnel: its Notion page when there is one (index.html's label), else Reports → Funnel here.
  const full = $('focus-funnel-notion');
  full.dataset.url = funnel.notion_url || '';
  full.dataset.notionLabel ||= full.textContent;
  full.textContent = funnel.notion_url ? full.dataset.notionLabel : 'Open in Reports';
  show(full, true);
}
// The target box shows the saved target, except while it is being typed in: Focus drawn again then (a Gmail check ending, a late load)
// put the old number back and Tab saved nothing (issue #2338, 28 Oct 2026).
function showTarget(value) {
  if (document.activeElement !== $('focus-target')) $('focus-target').value = value;
}
function editTarget() {
  show($('focus-target-row'));
  $('focus-target').focus();
  $('focus-target').select();
}
// The target is a line of ⚙️ Search settings in Notion; changing it here (or in Settings) writes it there.
export async function saveDailyTarget(input) {
  input.disabled = true;
  const result = await withSaveProgress(words => { input.title = words; input.closest('label')?.setAttribute('data-saving', words); }, () => window.pilot.setDailyTarget(input.value))
    .catch(error => ({ok: false, error: error.message}));
  input.disabled = false;
  input.title = ''; input.closest('label')?.removeAttribute('data-saving');
  if (!result.ok) { toastMessage('Target not changed', result.error, {view: 'focus'}, 'bad'); return false; }
  for (const id of ['focus-target', 'set-target']) $(id).value = result.target;
  return true;
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  paintChartFirst();   // as last drawn: nothing below it moves when Focus is read
  initSuggestions();
  $('focus-history-toggle').addEventListener('click', () => showHistory(!historyShown));
  window.addEventListener('activity-updated', () => renderOnboarding());
  $('onboarding-hide').addEventListener('click', () => {
    const next = {...(shared.state?.settings?.onboarding || {}), hidden: true};
    if (shared.state?.settings) shared.state.settings.onboarding = next;
    window.pilot.saveSettings({onboarding: next}).catch(error => console.error('onboarding not saved', error));
    show($('focus-onboarding'), false);
    // Hidden while it was all Focus showed (no Notion): the page falls back to the Notion gate, never an empty page.
    if (document.querySelector('.view[data-view="focus"]')?.classList.contains('focus-started')) openView('focus', {fromHistory: true});
  });
  setInterval(() => {  // "Updated 3 min ago" stays true while the page is open
    if (focusUpdatedAt && !focusLoading) focusStatus(`Updated ${savedAgo(new Date(focusUpdatedAt).toISOString())}`);
  }, 60000);
  $('focus-funnel-notion').addEventListener('click', event => {
    event.preventDefault();
    if (event.currentTarget.dataset.url) window.pilot.openNotion(event.currentTarget.dataset.url, event.metaKey);
    else { openView('reports'); loadReports('funnel'); }
  });
  $('focus-edit-target').addEventListener('click', event => { event.preventDefault(); editTarget(); });
  $('focus-edit-reminders').addEventListener('click', event => {
    event.preventDefault();
    openView('settings');
    openSetting('schedule');
  });
  $('focus-refresh').addEventListener('click', loadFocus);
  $('focus-target').addEventListener('change', async () => {
    if (await saveDailyTarget($('focus-target'))) { show($('focus-target-row'), false); loadFocus(); }
  });
  $('focus-remind').addEventListener('change', async () => {  // the Focus page and Settings both save at once
    const on = $('focus-remind').checked;
    await window.pilot.saveSettings({focusReminders: on});
    $('set-remind').checked = on;
    shared.state = await window.pilot.state();
  });

  // The running app is older than this window (updated while open): offer a restart, once.
  window.addEventListener('pilot-outdated', () => {
    if (shared.outdatedShown) return;
    shared.outdatedShown = true;
    toastMessage({title: 'Jobadabra was updated', body: 'Restart it to finish the update: some buttons won\'t work until then.', action: {label: 'Restart', run: relaunch}, target: NO_PLACE.app, tone: 'warn'});
  });
}
