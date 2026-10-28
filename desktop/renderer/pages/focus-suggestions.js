// Focus → Suggestions and the Jobs bar: the calls to action that can wait, drawn as Up next's rows. The engine's entries (src/suggestions.py:
// today's insight, a rejection lesson, Your week, Analyze now, Tune) come first, then the Focus items that moved here, with their own buttons.
// Each entry's buttons run in one press (RUN); ⋯ holds Not now (14 days) and Not true, kept in the active store (lib/suggestion-answers.js).
// Spec: docs/superpowers/specs/2026-10-28-insights-with-actions-design.md (PR 1a). Guarded by test/suggestions.test.js.
import {el, moreButton, pill} from '../components.js';
import {icon} from '../icons.js';
import {SHOWN, countWords, entryParts, focusRows, homeEntries, jobsBarWords, jobsEntries} from '../suggestions.js';
import {NO_PLACE} from '../targets.js';
import {keepBlock, keptBlock} from '../late-blocks.js';
import {$, show} from './core.js';
import {focusItems, loadFocus, openLink, prepAction} from './focus.js';
import {openJobPanel} from './job-panel.js';
import {startSearch} from './jobs.js';
import {openView} from './nav.js';
import {loadReports} from './reports.js';
import {runCommand, startTailor} from './actions.js';
import {openActivity} from './activity.js';
import {openTune} from './tune.js';
import {toastMessage} from './startup.js';
import {wand} from '../magic.js';
import {setAside} from '../ideas-aside.js';

let pool = [];              // the engine's entries as last read (Focus's `suggestions`)
const ALL = 'jp.focus.suggestions.all';   // Show all stays as you left it (this Mac), like Actions' More
let showAll = (() => { try { return localStorage.getItem(ALL) === '1'; } catch { return false; } })();
const held = new Set();     // keys answered here: gone at once, before Focus is read again
let hiddenKeys = new Set(); // Strategy's rows answered anywhere (Focus's `suggestions_hidden`)

// A task that did not start says why where you pressed (a refusal, no AI credit), as Find jobs does.
const started = (what, result) => { if (result?.started) openActivity(true); else if (result?.text) toastMessage(`${what} did not start`, result.text.replace(/^⚠️\s*/, ''), NO_PLACE.itself, 'warn'); };

// One handler per actions[].do (suggestions.js DOES): what the button names, done in one press.
export const RUN = {
  // Its page when the store has one (as Focus's Insight card did), else the same thing here: Reports, or the job's Review tab.
  open_insight: (action, event) => (action.link ? openLink(action.link, event) : (openView('reports'), loadReports('insights'))),
  read_week: (action, event) => (action.link ? openLink(action.link, event) : (openView('reports'), loadReports('weekly'))),
  open_rejection: (action, event) => (action.link ? openLink(action.link, event)
    : (openView('jobs'), openJobPanel({url: action.url, title: action.title, company: action.company}, 'review'))),
  analyze: async () => started('Analyze my job search', await runCommand('weekly')),
  tune: () => openTune(),
  find_jobs: () => { openView('jobs'); return startSearch(); },
  tailor: async () => started('Tailor CVs', await startTailor()),
  // The next interview's prep kit, as its Up next row builds or opens it (pages/focus.js prepAction).
  prep: (_action, event) => {
    const next = focusItems().find(item => item.kind === 'prepare' && item.page_id);
    const kit = next && prepAction(next.company);
    if (kit) kit.run(event); else openView('interviews');
  },
  // Strategy's search rows (src/suggestions_search.py): their top option in one press, as Strategy's own button does it; See all opens the row
  // there with every option. Loaded when pressed: Strategy's page imports this one.
  change_search: (action, event) => {
    const button = event.currentTarget;
    return import('./strategy-suggestions.js').then(page => page.changeSearch(action, button, 'focus'));
  },
  see_all: action => import('./strategy-suggestions.js').then(page => page.reviewSuggestion(action.row)),
};

/** Keeps a person's Not now / Not true for one entry; it leaves every place at once, and comes back if the store refuses it. */
export async function answerEntry(entry, state) {
  held.add(entry.key);
  if (state === 'Not true' && entry.aside?.length) setAside(entry.aside);   // role ideas: the AI is told not to propose them again
  redraw();
  const done = await window.pilot.suggestionAnswer({key: entry.key, title: entry.title}, state).catch(error => ({ok: false, error: error.message}));
  if (!done?.ok) {
    held.delete(entry.key);
    redraw();
    toastMessage('Not saved', done?.error || 'Your answer was not saved. Try again.', NO_PLACE.itself, 'bad');
    return;
  }
  loadFocus();
}

const AI = new Set(['analyze', 'find_jobs', 'tailor', 'prep']);   // buttons that start AI work carry the wand (test/wand-cursor.test.js)
const button = (label, className, run) => {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', run);
  return node;
};
/** One engine entry as an Up next row: icon, headline and badge, where it comes from, its buttons, and ⋯ (Not now, Not true, its evidence). */
export function entryRow(entry) {
  const parts = entryParts(entry);
  const li = el('li', `focus-item tone-${parts.tone}`);
  li.dataset.suggestion = entry.kind;
  const round = el('span', 'focus-round');
  round.append(icon(parts.icon));
  const top = el('div', 'focus-top');
  top.append(el('span', 'focus-headline', parts.headline), pill(parts.badge, parts.tone, {dot: true}));
  const meta = el('div', 'focus-meta muted small');
  parts.meta.forEach((part, i) => { if (i) meta.append(el('span', 'sep', '·')); meta.append(el('span', '', part)); });
  const body = el('div', 'focus-body');
  body.append(top, meta);
  body.title = parts.evidence;
  const actions = el('div', 'focus-actions');
  for (const [i, action] of entry.actions.entries()) {
    const node = button(action.label, i ? 'secondary' : 'primary', event => RUN[action.do]?.(action, event));
    actions.append(AI.has(action.do) ? wand(node) : node);
  }
  const more = [];
  if (entry.answers.includes('Not now')) more.push({icon: 'clock', label: 'Not now', title: 'Hidden for 14 days, then shown again if it still holds', run: () => answerEntry(entry, 'Not now')});
  if (entry.answers.includes('Not true')) more.push({icon: 'close', label: 'Not true', title: 'Never shown again for this evidence', run: () => answerEntry(entry, 'Not true')});
  if (parts.evidence) more.push({icon: 'info', label: 'Evidence', run: () => toastMessage(entry.title, parts.evidence, NO_PLACE.itself, 'info')});
  if (more.length) actions.append(moreButton(more, 'More'));
  li.append(round, body, actions);
  return li;
}

const shownPool = () => pool.filter(entry => !held.has(entry.key));
let lastArgs = null;
/** The engine's entries for a home screen (Strategy's Tune row), answered ones left out. */
export const homeSuggestions = home => homeEntries(shownPool(), home);
/** Whether a Strategy row's key was answered (Not now, Not true), here or as Focus last read it. */
export const answered = key => held.has(key) || hiddenKeys.has(key);

/** Focus's Suggestions section: entries, then the moved items drawn by Focus's own `card`; 3 shown, "Show all N" opens the rest in place. */
export function renderFocusSuggestions({entries, items, card, hidden}) {
  pool = entries || [];
  hiddenKeys = new Set(hidden || []);
  lastArgs = {items, card};
  const rows = focusRows(shownPool(), items);
  show($('focus-suggestions'), rows.length > 0);
  const shown = showAll ? rows : rows.slice(0, SHOWN);
  $('focus-suggestions-list').replaceChildren(...shown.map(row => (row.entry ? entryRow(row.entry) : card(row.item))));
  $('focus-suggestions-count').textContent = countWords(shown.length, rows.length);
  const all = $('focus-suggestions-all');
  all.textContent = showAll ? 'Show fewer' : `Show all ${rows.length}`;
  show(all, rows.length > SHOWN);
  renderJobsSuggestions();
  window.dispatchEvent(new Event('suggestions-updated'));   // Strategy's Tune row, and its rows answered here
}
function redraw() { if (lastArgs) renderFocusSuggestions({entries: pool, hidden: [...hiddenKeys], ...lastArgs}); }

/** The Jobs bar above the list: folded to one line, open in place to the search- and applying-related entries; hidden at zero. */
export function renderJobsSuggestions() {
  const bar = $('jobs-suggestions');
  if (!bar) return;
  const entries = jobsEntries(shownPool());
  show(bar, entries.length > 0);
  const words = jobsBarWords(entries.length, bar.open);
  $('jobs-suggestions-title').textContent = words.title;
  $('jobs-suggestions-count').textContent = words.detail;
  $('jobs-suggestions-list').replaceChildren(...entries.map(entryRow));
  keepBlock('jobs-suggestions', {shown: entries.length > 0, count: entries.length});
}

/** The Jobs bar's first paint (pages/jobs.js init): folded, as last drawn, so the list below does not move when Focus is read (renderer/late-blocks.js). */
export function paintJobsSuggestionsFirst() {
  const kept = keptBlock('jobs-suggestions');
  if (!kept?.shown) return;
  const words = jobsBarWords(Number(kept.count) || 0, false);
  $('jobs-suggestions-title').textContent = words.title;
  $('jobs-suggestions-count').textContent = words.detail;
  show($('jobs-suggestions'), true);
}

/** Binds Show all and the Jobs bar's fold (once, at start-up). */
export function initSuggestions() {
  $('focus-suggestions-all').addEventListener('click', () => {
    showAll = !showAll;
    try { localStorage.setItem(ALL, showAll ? '1' : '0'); } catch { /* folded again next time */ }
    redraw();
  });
  $('jobs-suggestions').addEventListener('toggle', renderJobsSuggestions);
}
