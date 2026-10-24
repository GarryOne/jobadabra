// Reports (owner's choice, 9 Oct 2026: one page, tabs Weekly · Insights · Funnel · Form fills · Searches): what Notion's 💡 Insights and 🎯 Pipeline
// pages showed, for every store. Weekly: a report in full (priorities, what worked, numbers, daily insights), ‹ › through the weeks.
// Insights: the history with its feedback (Useful / Not useful / Acting on it). Funnel: the Pipeline table and "Where to improve".
// Searches: every search run with the details it saved (pages/reports-searches.js, 25 Oct 2026). Form fills: lane F's view (pages/form-fills.js renderFormFills(container), mac-cd), mounted here. Data: IPC reportsInsights /
// insightFeedback (lib/reports-handlers.js) and Focus's funnel. Parts: .tabs, .data-table, the interview review's groups, .segmented.
// Pure parts: renderer/reports-view.js. Guards: test/reports-view.test.js, test/reports-handlers.test.js.
import {el, pill} from '../components.js';
import {dayLabel, funnelRows, improveLines, insightItems, weeklyCardOf, weeklyReports} from '../reports-view.js';
import {weeklyCard} from './activity-cards.js';
import {$} from './core.js';
import {gatedOut} from './notion-connect.js';

export const REPORT_TABS = [['weekly', 'Weekly report', 'weekly report search analysis priorities numbers week'],
  ['insights', 'Insights', 'insights history daily feedback useful'], ['funnel', 'Funnel', 'funnel pipeline conversion from previous where to improve'],
  ['fills', 'Form fills', 'form fills history runs fields timings extension'],
  ['searches', 'Searches', 'searches find jobs runs details numbers employers boards how the search ran full report']];
const state = {tab: 'weekly', insights: null, week: 0, error: '', openSearch: null};

function group(title, lines) {
  const box = el('div', 'iv-moments-group');
  if (title) box.append(el('h3', '', title));
  box.append(...lines.map(line => (line instanceof Node ? line : el('div', `iv-moment${line.quote ? ' muted' : ''}`, line.strong ? el('b', '', line.text) : (line.text ?? line.fold ?? String(line))))));
  return box;
}
const empty = text => [el('p', 'muted', text)];

function weeklyTab() {
  const weeks = weeklyReports(state.insights);
  if (!weeks.length) return empty('No weekly report yet: one comes each Monday after your first week of applications.');
  state.week = Math.min(state.week, weeks.length - 1);
  const week = weeks[state.week];
  const nav = el('div', 'inline');
  const older = Object.assign(el('button', 'secondary', '‹ Previous week'), {type: 'button', disabled: state.week >= weeks.length - 1});
  const newer = Object.assign(el('button', 'secondary', 'Next week ›'), {type: 'button', disabled: state.week === 0});
  older.addEventListener('click', () => { state.week++; draw(); });
  newer.addEventListener('click', () => { state.week--; draw(); });
  nav.append(older, newer);
  const head = el('div', 'job-panel-head');
  head.append(el('p', 'muted small', [dayLabel(week.day), week.confidence && `${week.confidence} confidence`].filter(Boolean).join(' · ')), nav);
  // The card Recent activity draws for this report, then the report's other sections in the same shape.
  const {weekly, extra} = weeklyCardOf(week);
  const card = weeklyCard(weekly);
  card.classList.add('is-flat');   // inside #reports-body, already a card: no box in a box (as Form fills' cards)
  for (const part of extra) {
    const section = el('section', 'insight-section');
    section.append(el('h4', '', part.title));
    const list = el('ul', 'insight-evidence');
    for (const line of part.lines) {
      const item = el('li', '', line.text);
      if (line.url) {
        const link = Object.assign(el('a', 'link', new URL(line.url).hostname + new URL(line.url).pathname), {href: line.url});
        link.addEventListener('click', event => { event.preventDefault(); window.pilot.openExternal(line.url); });
        item.append(line.text ? ' · ' : '', link);
      }
      list.append(item);
    }
    section.append(list);
    card.append(section);
  }
  return [head, card];
}

function feedbackChoice(item) {
  const box = el('div', 'segmented');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Was it useful?');
  for (const value of ['Useful', 'Not useful', 'Acting on it']) {
    const button = Object.assign(el('button', item.feedback === value ? 'is-active' : '', value), {type: 'button'});
    button.setAttribute('aria-pressed', String(item.feedback === value));
    button.addEventListener('click', async () => {
      const done = await window.pilot.insightFeedback(item.id, value).catch(error => ({ok: false, error: error.message}));
      if (!done.ok) { $('reports-state').textContent = `Feedback not saved: ${done.error || 'try again'}`; return; }
      const row = state.insights.find(each => each.id === item.id);
      if (row) row.fields = {...row.fields, feedback: value};
      $('reports-state').textContent = 'Feedback saved ✓';
      draw();
    });
    box.append(button);
  }
  return box;
}

function insightsTab() {
  const items = insightItems(state.insights);
  if (!items.length) return empty('No insights yet: the first comes after a few days of searching and applying.');
  return items.map(item => {
    const box = el('section', 'card iv-moments-group reports-insight');   // one card per insight (#reports-body is then plain, see draw)
    const head = el('h3', '', item.title);
    head.prepend(pill(item.category || 'Insight', item.category === 'Process' ? 'warn' : 'info'), ' ');
    box.append(el('p', 'muted small', [dayLabel(item.day), item.confidence && `${item.confidence} confidence`].filter(Boolean).join(' · ')), head);
    // A process issue's own page (its action, "Supported hypothesis", the quotes); a daily insight's evidence and next step.
    if (item.groups.length) box.append(...item.groups.map(part => group(part.title, part.lines)));
    else box.append(...item.evidence.map(line => el('div', 'iv-moment', line)), ...(item.action ? [el('div', 'iv-moment', el('b', '', `👉 ${item.action}`))] : []));
    box.append(feedbackChoice(item));
    return box;
  });
}

async function funnelTab() {
  const read = await window.pilot.focus().catch(error => ({ok: false, error: error.message}));   // Focus's own read (shared with its page)
  const focus = read?.focus || {}, funnel = focus.funnel;
  if (!funnel?.steps?.length) return empty(read?.error ? `Could not read your funnel: ${read.error}` : 'No applications yet: the funnel fills as you apply.');
  const table = el('table', 'data-table');
  const head = el('tr');
  for (const name of ['Step', 'Reached', 'From previous', 'Of applied', 'Still open here']) head.append(el('th', '', name));
  table.append(head);
  for (const row of funnelRows(funnel)) {
    const line = el('tr');
    line.append(el('td', '', row.step), Object.assign(el('td', 'is-num', String(row.reached))), el('td', '', row.fromPrevious), el('td', '', row.ofApplied),
      Object.assign(el('td', 'is-num', String(row.open))));
    table.append(line);
  }
  const improve = improveLines(funnel);
  const steps = el('section', 'card');
  steps.append(table, el('p', 'muted small', 'From previous = share of the previous step that got this far.'));
  const better = el('section', 'card');
  if (improve.length) better.append(group('💡 Where to improve', improve.map(text => ({text}))));
  return improve.length ? [steps, better] : [steps];
}

async function fillsTab(box) {
  // Lane F's view (mac-cd): it owns its list, detail and states. Until it lands, this tab says so.
  const view = await import('./form-fills.js').catch(() => null);
  if (!view?.renderFormFills) return empty('Your past form fills will show here soon.');
  view.renderFormFills(box);
  return null;
}

async function searchesTab(box) {
  const view = await import('./reports-searches.js');
  view.renderSearches(box, state.openSearch);
  state.openSearch = null;
}

async function draw() {
  document.querySelectorAll('[data-reports-tab]').forEach(tab => tab.classList.toggle('is-active', tab.dataset.reportsTab === state.tab));
  const box = $('reports-body');
  box.classList.toggle('is-plain', ['insights', 'funnel', 'searches'].includes(state.tab));   // their items are cards of their own: no box in a box
  if (state.tab === 'searches') { await searchesTab(box); return; }
  if (state.tab === 'fills') { const parts = await fillsTab(box); if (parts) box.replaceChildren(...parts); return; }
  if (state.tab === 'funnel') { box.replaceChildren(el('span', 'skeleton w-80'), el('span', 'skeleton w-60')); box.replaceChildren(...await funnelTab()); return; }
  if (state.error) { box.replaceChildren(...empty(`Could not read your insights: ${state.error}. Open Reports again to retry.`)); return; }
  if (!state.insights) { box.replaceChildren(el('span', 'skeleton w-80'), el('span', 'skeleton w-60'), el('span', 'skeleton w-40')); return; }
  box.replaceChildren(...(state.tab === 'insights' ? insightsTab() : weeklyTab()));
}

// Opens a tab (or the last one) and reads the insights again.
export async function loadReports(tab = state.tab) {
  if (gatedOut('reports')) return;   // behind the Notion gate: nothing reads it (#410)
  state.tab = tab;
  state.error = '';
  $('reports-state').textContent = 'Refreshing…';
  draw();
  const result = await window.pilot.reportsInsights().catch(error => ({ok: false, error: error.message}));
  state.insights = result.ok ? result.insights : state.insights;
  state.error = result.ok ? '' : result.error || 'try again';
  $('reports-state').textContent = result.ok ? 'Updated just now' : '';
  if (!['fills', 'funnel', 'searches'].includes(state.tab)) draw();
}

// Opens Reports on Searches with one run's full report (the "Full report →" link on a search's card and in Recent activity).
export function openSearchReport(runId) {
  state.openSearch = runId;
  return loadReports('searches');
}

export function init() {
  document.querySelectorAll('[data-reports-tab]').forEach(tab => tab.addEventListener('click', () => { state.tab = tab.dataset.reportsTab; draw(); }));
}
