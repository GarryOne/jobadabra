// Reports → Searches (mounted by pages/reports.js: renderSearches(container)): every search run with the details it saved (lib/searches-handlers.js).
// A row of totals, then a card per run (icon tile, name, result pill, where and how long, jobs added); a card opens its full report in place:
// the main figures as summary tiles, then widget cards: the steps as bars sized by time, jobs from postings down to your list, employers, job boards,
// AI, problems, scoring and the technical log (folded). Built from page-parts summaryTiles, components (tile, pill, chip, numberStrip, liveDot) and the
// insight card; only the layout of the report's card grid and its bars is new (reports-searches.css). Logic: renderer/searches-view.js.
// Guarded by test/searches-view.test.js.
import {chip, el, liveDot, numberStrip, pill, tile} from '../components.js';
import {summaryTiles} from '../page-parts.js';
import {byStore, storeName} from '../store-words.js';
import {runWhen} from './core.js';
import {listLine, listRow, metaOf, report} from '../searches-view.js';

const state = {runs: null, open: null, full: null};
let host = null;
const label = text => (text === 'OK' ? 'Done' : text);
const kicker = (category, title, tone) => { const head = el('div', 'rs-card-head'); head.append(el('span', 'insight-category', category), ...(tone ? [pill(title, tone, {dot: true})] : [el('h3', 'rs-card-title', title)])); return head; };
// A status chip is a pill in its tone (the chip component colours only 'bad'); a plain value stays a chip.
const badge = item => (item.tone ? pill(item.detail ? `${item.label} · ${item.detail}` : item.label, item.tone, {dot: true}) : chip(item.label, {detail: item.detail || ''}));

function widget(card) {
  const box = el('section', `card rs-card rs-${card.kind}`);
  box.dataset.card = card.id;
  if (card.kind === 'fold') {
    const fold = el('details', 'rs-fold'), summary = el('summary', '');
    summary.append(el('b', '', card.title), el('span', 'muted small', `${card.lines.length} line${card.lines.length === 1 ? '' : 's'}`));
    const list = el('ul', 'insight-evidence');
    list.append(...card.lines.map(text => el('li', card.mono ? 'mono' : '', text)));
    fold.append(summary, list);
    box.append(fold);
    return box;
  }
  box.append(kicker(card.category, card.title, card.kind === 'list' ? card.tone : ''));
  if (card.kind === 'steps') {
    const rows = el('div', 'rs-steps');
    for (const step of card.steps) {
      const row = el('div', 'rs-step'), bar = el('span', 'bar'), fill = el('span', '');
      fill.style.width = `${step.share}%`;
      bar.append(fill);
      row.append(liveDot('done'), el('b', '', step.label), el('span', 'muted small', `at ${step.at}`), bar, el('span', 'rs-took', step.took));
      rows.append(row);
    }
    box.append(rows);
  }
  if (card.kind === 'funnel') {
    const rows = el('div', 'rs-bars');
    for (const bar of card.bars) {
      const row = el('div', `rs-bar-row tone-${bar.tone}`), track = el('span', 'bar'), fill = el('span', '');
      fill.style.width = `${bar.share}%`;
      track.append(fill);
      row.append(el('span', 'rs-bar-label', bar.label), track, el('b', 'rs-bar-value', bar.value));
      rows.append(row);
    }
    box.append(rows);
  }
  if (card.kind === 'boards' && card.rows.length) {
    const rows = el('div', 'rs-board-rows');
    for (const row of card.rows) {
      const line = el('div', 'rs-board');
      line.append(tile('globe', 'info'), el('b', '', row.name), chip(`${row.jobs} jobs`), chip(`${row.relevant} relevant`, {tone: row.relevant === '0' ? '' : 'good'}));
      rows.append(line);
    }
    box.append(rows);
  }
  if (card.cells?.length) box.append(numberStrip(card.cells));
  if (card.chips?.length) { const chips = el('div', 'rs-values'); chips.append(...card.chips.map(badge)); box.append(chips); }
  if (card.kind === 'list' && card.lines.length) { const list = el('ul', 'insight-evidence'); list.append(...card.lines.map(text => el('li', '', text))); box.append(list); }
  return box;
}

function listView() {
  const box = el('div', 'rs-list');
  const rows = state.runs.map(listRow);
  box.append(el('p', 'muted small', listLine(rows)));
  if (!rows.length) {
    const empty = el('section', 'card');
    empty.append(el('p', 'empty', 'No searches yet. Run Find jobs and every number of the search lands here: how it ran, how many jobs and employers, what was left out.'));
    box.append(empty);
    return box;
  }
  const added = state.runs.reduce((sum, run) => sum + (Number(run.stats?.new_jobs) || 0), 0);
  const employers = state.runs.reduce((sum, run) => sum + (Number(run.details?.employers?.employers_checked) || 0), 0);
  const problems = state.runs.filter(run => run.details?.problems?.length || run.status === 'Failed' || run.status === 'Warnings').length;
  box.append(summaryTiles([{icon: 'search', tone: 'signal', label: 'Searches', value: String(rows.length)}, {icon: 'plus', tone: 'good', label: 'Jobs added', value: String(added)},
    {icon: 'building', tone: 'violet', label: 'Employers checked', value: String(employers)}, {icon: problems ? 'alert' : 'check-circle', tone: problems ? 'warn' : 'good', label: 'With problems', value: String(problems)}]));
  const items = el('div', 'rs-runs');
  for (const run of rows) {
    const card = el('section', `card rs-run is-${run.tone}`), words = el('div', 'rs-run-words'), head = el('div', 'rs-run-head');
    head.append(el('b', '', run.name), pill(label(run.outcome), run.tone, {dot: true}));
    words.append(head, el('span', 'muted small', `${runWhen(run.at)} · ${metaOf(run)}`));
    const open = Object.assign(el('button', 'secondary', 'Full report ›'), {type: 'button', title: 'Open the full report of this search'});
    const number = el('div', 'rs-run-number'); number.append(el('b', '', run.added === null ? '–' : String(run.added)), el('span', 'muted small', 'added'));
    card.append(tile(run.outcome === 'Failed' ? 'alert' : 'search', run.tone === 'neutral' ? 'neutral' : run.tone), words, number, open);
    card.dataset.id = run.id;
    card.addEventListener('click', () => openRun(run.id));
    items.append(card);
  }
  box.append(items);
  return box;
}

function detailView(row) {
  const view = listRow(row), {tiles, cards} = report(row), box = el('div', 'rs-detail');
  box.dataset.id = row.id;
  const back = Object.assign(el('button', 'link', '‹ All searches'), {type: 'button'});
  back.addEventListener('click', () => { state.open = state.full = null; draw(); });
  const head = el('section', 'card rs-head'), words = el('div', 'rs-run-words'), title = el('div', 'rs-run-head');
  title.append(el('h3', 'insight-title', view.name), pill(label(view.outcome), view.tone, {dot: true}));
  words.append(el('span', 'insight-category', runWhen(view.at)), title, el('span', 'muted small', metaOf(view)));
  head.append(tile(view.outcome === 'Failed' ? 'alert' : 'search', view.tone === 'neutral' ? 'neutral' : view.tone), words);
  const backLine = el('div', ''); backLine.append(back);
  box.append(backLine, head);
  if (tiles.length) box.append(summaryTiles(tiles));
  const grid = el('div', 'rs-grid');
  grid.append(...cards.map(widget));
  box.append(grid);
  return box;
}

function draw() {
  if (!host) return;
  if (!state.runs) { host.replaceChildren(el('p', 'muted', `Loading your searches from ${storeName()}…`)); return; }
  const row = state.open && (state.full || state.runs.find(run => run.id === state.open));
  host.replaceChildren(row ? detailView(row) : listView());
}

async function openRun(id) {
  state.open = id;
  state.full = null;
  draw();
  const answer = await window.pilot.reportsSearch(id).catch(() => null);
  if (state.open === id && answer?.run) { state.full = answer.run; draw(); }
}

// Opens the list, or one run's report (the "Full report →" link on a search's card, pages/reports.js openSearchReport).
export async function renderSearches(container, openId = null) {
  host = container;
  if (openId) state.open = openId;
  draw();
  const answer = await window.pilot.reportsSearches().catch(error => ({error: error.message}));
  if (host !== container) return;
  if (answer?.error) {
    const retry = Object.assign(el('button', 'link', 'Retry'), {type: 'button'});
    retry.addEventListener('click', () => renderSearches(container));
    host.replaceChildren(el('p', 'message error', `Could not read your searches from ${storeName()}: ${answer.error}`),
      el('p', 'muted small', byStore('Searches are kept in Notion ⏱️ Search runs.', 'Searches are kept by Jobadabra on this Mac.')), retry);
    return;
  }
  state.runs = answer?.runs || [];
  if (state.open && !state.runs.some(run => run.id === state.open)) state.open = null;
  else if (state.open) { openRun(state.open); return; }
  draw();
}
