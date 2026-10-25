// Employers & Sources page (nav → Employers): every employer and job board the person tracks, from the active store
// (lib/employers-handlers.js), as a library table like Interviews: search, kind / feed status / active filters, an Active switch per row
// (the next search reads or skips its feed), and the row's detail (notes, integration, research links) under it on click.
// Logic without a window: renderer/employers-view.js. Guarded by test/employers-view.test.js, test/employers-handlers.test.js.
import {el, pill} from '../components.js';
import {avatar} from '../jobs-view.js';
import {byStore, storeName} from '../store-words.js';
import {SORT_COLUMNS, day, detailLines, feedHelp, feedName, feedStatuses, feedTone, filterEmployers, metaLine, qualityHelp, researchLinks, statsLine} from '../employers-view.js';
import {drawHeader, loadSort, nextSort, saveSort, sortRows} from '../table-sort.js';
import {$, message as say, show} from './core.js';
import {skeletonRows} from './interview-practice.js';
import {gatedOut} from './notion-connect.js';
import {addPasteButton} from './employers-paste.js';

// A line above the table only while there is something to say (an empty .message keeps its height).
const message = (id, text, tone) => { say(id, text, tone); show($(id), !!text); };
let rows = null;          // the store's employers, null until read
const opened = new Set(); // rows whose detail is shown, by id
const SORT_KEY = 'employers-sort';
let sort = loadSort(SORT_KEY, SORT_COLUMNS, {key: 'name', dir: 'asc'});

const filters = () => ({text: $('emp-filter').value, kind: $('emp-kind').value, feed: $('emp-feed').value, active: $('emp-active').value});

function nameCell(row) {
  const who = el('div', 'lib-who');
  const logo = avatar(row.name || '?');
  const badge = el('span', 'logo', logo.initials);
  badge.style.setProperty('--hue', logo.hue);
  const lines = el('div', '');
  const name = Object.assign(el('button', 'link', row.name || 'Unnamed'), {type: 'button', title: 'Show notes and research links'});
  name.setAttribute('aria-expanded', String(opened.has(row.id)));
  name.addEventListener('click', () => { opened.has(row.id) ? opened.delete(row.id) : opened.add(row.id); render(); });
  lines.append(el('b', '', ''));
  lines.firstChild.append(name);
  const meta = metaLine(row);
  if (meta) lines.append(el('div', 'muted small', meta));
  who.append(badge, lines);
  return who;
}

function activeSwitch(row) {
  const label = Object.assign(el('label', 'switch'), {title: row.active ? 'Active: searches read its jobs. Turn off to skip it.' : 'Paused: searches skip it. Turn on to read its jobs.'});
  const input = Object.assign(document.createElement('input'), {type: 'checkbox', checked: !!row.active});
  input.setAttribute('aria-label', `${row.name}: active`);
  input.addEventListener('change', async () => {
    input.disabled = true;
    const done = await window.pilot.employerActive(row.name, input.checked);
    input.disabled = false;
    if (!done?.ok) { input.checked = !!row.active; message('emp-message', done?.error || `Could not save it in ${storeName()}.`, 'error'); return; }
    row.active = input.checked;
    message('emp-message', `${row.name} is ${row.active ? 'active: the next search reads its jobs' : 'paused: searches skip it'}.`, 'ok');
    render();
  });
  label.append(input, el('span', '', ''));
  return label;
}

function detailRow(row) {
  const tr = el('tr', 'emp-detail');
  const td = el('td', '');
  td.colSpan = 7;
  const lines = el('div', 'muted small');
  lines.append(...detailLines(row).map(([label, value]) => { const line = el('div', ''); line.append(el('b', '', `${label}: `), String(value)); return line; }));
  const links = researchLinks(row);
  if (links.length) {
    const bar = el('div', 'chips');
    bar.append(...links.map(([label, url]) => {
      const link = Object.assign(el('button', 'link small', label), {type: 'button', title: url});
      link.addEventListener('click', () => window.pilot.openExternal(url));
      return link;
    }));
    lines.append(bar);
  }
  td.append(lines);
  tr.append(td);
  return tr;
}

function rowOf(row) {
  const tr = el('tr', '');
  tr.dataset.id = row.id;
  const cell = (...children) => { const td = el('td', ''); td.append(...children); tr.append(td); return td; };
  cell(nameCell(row));
  const kind = el('div', '');
  kind.append(pill(row.kind || 'Employer', row.kind === 'Job board' ? 'violet' : 'neutral'));
  if (row.tier === 'Tier 1') kind.append(' ', pill('Tier 1', 'signal'));
  cell(kind);
  const feed = el('div', '');
  if (row.feed_status) {
    const chip = Object.assign(el('span', 'tip'), {tabIndex: 0});
    chip.dataset.tip = feedHelp(row.feed_status);
    chip.append(pill(row.feed_status, feedTone(row.feed_status), {dot: true}));
    feed.append(chip);
  }
  const name = feedName(row);
  if (name) feed.append(el('div', 'muted small', name));
  cell(feed);
  const none = row.quality === null || row.quality === undefined || row.quality === '';
  const quality = el('span', none ? '' : 'tip', none ? '–' : String(row.quality));
  if (!none) { quality.tabIndex = 0; quality.dataset.tip = qualityHelp(row); }
  cell(quality);
  cell(el('span', 'muted is-nowrap', row.origin || '–'));   // "Find employers" on one line
  cell(el('span', 'muted', day(row.checked) || '–'));
  cell(activeSwitch(row));
  return opened.has(row.id) ? [tr, detailRow(row)] : [tr];
}

export function render() {
  if (!rows) return;
  drawHeader($('emp-head'), SORT_COLUMNS, sort, key => { sort = nextSort(sort, key, SORT_COLUMNS); saveSort(SORT_KEY, sort); render(); });
  const shown = sortRows(filterEmployers(rows, filters()), sort, SORT_COLUMNS);
  $('emp-stats').textContent = rows.length ? statsLine(rows, shown) : byStore('Your 🏢 Employers & Sources in Notion', 'Your employers and job boards');
  $('emp-rows').replaceChildren(...shown.flatMap(rowOf));
  // The table box clips: a tip in the last two rows (of 3 or more) opens upward, where there is room.
  const trs = [...$('emp-rows').querySelectorAll('tr[data-id]')];
  if (trs.length >= 3) for (const tr of trs.slice(-2)) for (const tip of tr.querySelectorAll('.tip')) tip.dataset.up = '';
  show($('emp-empty'), !shown.length);
  $('emp-empty').textContent = rows.length ? 'No employer matches these filters.'
    : 'No employers yet. Find jobs adds some, and every search adds the ones it reads.';
}

export async function loadEmployers() {
  if (gatedOut('employers')) return;   // behind the Notion gate: nothing reads it (#410)
  if (!rows) $('emp-rows').replaceChildren(...skeletonRows(4));
  $('emp-stats').textContent = rows ? 'Refreshing…' : `Loading from ${storeName()}…`;
  const answer = await window.pilot.employers();
  if (answer?.error) {
    rows = rows || [];
    $('emp-stats').textContent = '';
    message('emp-message', `Could not read your employers from ${storeName()}: ${answer.error}`, 'error');
    $('emp-rows').replaceChildren();
    show($('emp-empty'), false);
    return;
  }
  rows = answer?.employers || [];
  message('emp-message', '');
  const select = $('emp-feed'), keep = select.value;
  select.replaceChildren(el('option', '', 'Any feed status'), ...feedStatuses(rows).map(status => el('option', '', status)));
  select.firstChild.value = '';
  select.value = feedStatuses(rows).includes(keep) ? keep : '';
  render();
}

// Run at start-up (app.js calls each page's init in turn).
export function init() {
  for (const id of ['emp-filter', 'emp-kind', 'emp-feed', 'emp-active']) $(id).addEventListener('input', render);
  $('emp-refresh').addEventListener('click', loadEmployers);
  addPasteButton();
}
