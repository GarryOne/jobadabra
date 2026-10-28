// Focus → Suggestions and the Jobs bar: the calls to action that can wait, drawn as Up next's rows. The engine's entries (src/suggestions.py:
// today's insight, a rejection lesson, Your week, Analyze now, Tune) come first, then the Focus items that moved here, with their own buttons.
// Each entry's buttons run in one press (RUN); ⋯ holds Not now (14 days) and Not true, kept in the active store (lib/suggestion-answers.js).
// Spec: docs/superpowers/specs/2026-10-28-insights-with-actions-design.md (PR 1a). Guarded by test/suggestions.test.js.
import {el, moreButton, pill} from '../components.js';
import {icon} from '../icons.js';
import {SHOWN, barView, countWords, entryParts, focusRows, homeEntries, jobsEntries} from '../suggestions.js';
import {drawerRows, foldedLine, questionEntries, withQuestions} from '../question-entries.js';
import {NO_PLACE} from '../targets.js';
import {keepBlock, keptBlock} from '../late-blocks.js';
import {$, show} from './core.js';
import {focusItems, loadFocus, openLink, prepAction} from './focus.js';
import {openJobPanel} from './job-panel.js';
import {startSearch} from './jobs.js';
import {loadQuestions, questionsNow} from './jobs-questions.js';
import {openView} from './nav.js';
import {loadReports} from './reports.js';
import {runCommand, startTailor} from './actions.js';
import {openActivity} from './activity.js';
import {openTune} from './tune.js';
import {toastMessage} from './startup.js';
import {wand} from '../magic.js';

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
  // A site only you can open: read in your Chrome, the same press as Strategy's Open (changeSearch's visit).
  read_site: (action, event) => RUN.change_search(action, event),
  see_all: action => import('./strategy-suggestions.js').then(page => page.reviewSuggestion(action.row)),
  // The Jobs drawers' rows (renderer/question-entries.js, PR 1c): each opens what its card opened.
  open_letter: () => import('./settings.js').then(({openSetting}) => openSetting('letter')),   // the cover letter is a setting, as the card's button did
  open_details: () => import('./question-review.js').then(review => review.openQuestionReview({queue: 'details'})),
  open_learned: () => import('./question-review.js').then(review => review.openQuestionReview({queue: 'learned'})),
  retry_questions: () => loadQuestions({force: true}).catch(() => {}),
};

/** Keeps a person's Not now / Not true for one entry; it leaves every place at once, and comes back if the store refuses it. */
export async function answerEntry(entry, state) {
  held.add(entry.key);
  redraw();
  const done = await window.pilot.suggestionAnswer({key: entry.key, title: entry.title, aside: entry.aside}, state).catch(error => ({ok: false, error: error.message}));
  if (!done?.ok) {
    held.delete(entry.key);
    redraw();
    toastMessage('Not saved', done?.error || 'Your answer was not saved. Try again.', NO_PLACE.itself, 'bad');
    return;
  }
  loadFocus();
}

const AI = new Set(['analyze', 'find_jobs', 'tailor', 'prep', 'read_site']);   // buttons that start AI work carry the wand (test/wand-cursor.test.js)
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
// Focus and the Jobs bar: the drawers' rows first (the blocking one at the top), then the engine's. A Not now leaves them at once (held) and stays gone (Focus's `suggestions_hidden`).
const rowsNow = () => drawerRows(questionEntries(questionsNow()), {held, hidden: hiddenKeys, known: Boolean(lastArgs)});
const withRows = () => withQuestions(shownPool(), rowsNow());
let lastArgs = null;
let questionsAsked = false;
/** The engine's entries for a home screen (Strategy's Tune row), answered ones left out. */
export const homeSuggestions = home => homeEntries(shownPool(), home);
/** Whether a Strategy row's key was answered (Not now, Not true), here or as Focus last read it. */
export const answered = key => held.has(key) || hiddenKeys.has(key);

/** Focus's Suggestions section: entries, then the moved items drawn by Focus's own `card`; 3 shown, "Show all N" opens the rest in place. */
export function renderFocusSuggestions({entries, items, card, hidden}) {
  pool = entries || [];
  hiddenKeys = new Set(hidden || []);
  lastArgs = {items, card};
  if (!questionsAsked) { questionsAsked = true; loadQuestions().catch(() => {}); }   // Jobs' count: cached on this Mac, read again after 10 minutes (jobs-questions.js)
  const rows = focusRows(withRows(), items);
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

// The folded line: the drawers' rows by name, the blocking one first, then how many search suggestions (question-entries.js foldedLine).
const barLine = entries => foldedLine(entries.filter(entry => 'blocking' in entry), entries.filter(entry => !('blocking' in entry)).length);

/** The Jobs bar above the list: folded to one line, open in place to the search- and applying-related entries; the rule is suggestions.js barView. */
let focusAsked = false, focusUnavailable = false;
export function renderJobsSuggestions() {
  const bar = $('jobs-suggestions');
  if (!bar) return;
  const entries = jobsEntries(withRows());
  const view = barView({focusRead: Boolean(lastArgs), unavailable: focusUnavailable, kept: keptBlock('jobs-suggestions'), entries, open: bar.open, line: barLine(entries)});
  show(bar, view.shown);
  $('jobs-suggestions-title').textContent = view.title;
  $('jobs-suggestions-count').textContent = view.detail;
  if (view.rows) {
    $('jobs-suggestions-list').replaceChildren(...entries.map(entryRow));
    keepBlock('jobs-suggestions', {shown: entries.length > 0, count: entries.length, line: barLine(entries)});
  }
  // Why (#2382): Focus is read only when its view opens (nav.js), so the bar asks once; if it cannot be read (gated store, failure) the kept bar goes.
  if (!lastArgs && !focusAsked) { focusAsked = true; loadFocus().finally(() => { if (!lastArgs) { focusUnavailable = true; renderJobsSuggestions(); } }); }
}

/** The Jobs bar's first paint (pages/jobs.js init): folded, as last drawn, so the list below does not move when Focus is read (renderer/late-blocks.js). */
export const paintJobsSuggestionsFirst = renderJobsSuggestions;

/** Binds Show all and the Jobs bar's fold (once, at start-up). */
export function initSuggestions() {
  $('focus-suggestions-all').addEventListener('click', () => {
    showAll = !showAll;
    try { localStorage.setItem(ALL, showAll ? '1' : '0'); } catch { /* folded again next time */ }
    redraw();
  });
  $('jobs-suggestions').addEventListener('toggle', renderJobsSuggestions);
  document.addEventListener('questions-read', () => { if (lastArgs) redraw(); else renderJobsSuggestions(); });   // the count arrived, or changed
}
