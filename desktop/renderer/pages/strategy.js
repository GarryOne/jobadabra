// Strategy page: the search strategy and its coverage. Entry: loadStrategy and init; the cards are main-goals.js, strategy-targets.js and strategy-suggestions.js, their drafts and one save bar strategy-cards.js, shared state strategy-state.js. Guarded by: advice-events, save-progress, activity-selection-kept, strategy-cards tests.
import {openInNotion} from './notion-connect.js';
import {el, openMenu, tile} from '../components.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {$, message, savedAgo, show} from './core.js';
import {bone} from './focus.js';
import {guardLeave, openView} from './nav.js';
import {toastMessage} from './startup.js';
import {inDraft, reloadDraft} from '../strategy-sink.js';
import {strategyState, showTab} from './strategy-state.js';
import {ADVANCED, CARD_TONE, TARGET_CARDS, entriesOf, inColumns, renderCards, renderStrategy, shownLists} from './strategy-targets.js';
import {strategyBar} from './strategy-cards.js';
import {loadCoverage} from './strategy-suggestions.js';
import {loadPreferences} from './job-preferences.js';
import {loadLocationsWhich} from './locations-which.js';
export {TARGET_CARDS, TARGET_LISTS, editedList} from './strategy-targets.js';
export {reviewSuggestion, loadCoverage} from './strategy-suggestions.js';

export async function loadStrategy() {
  if (inDraft()) { reloadDraft(); return; }   // setup step 3 draws these cards from the draft (pages/setup-strategy.js)
  shared.state = await window.pilot.state();
  message('strategy-message', '');
  loadCoverage({first: true});   // beside the strategy read, so the cards are there when the page first shows
  loadPreferences();   // Job preferences: the Profile's must-haves and ranking preferences
  loadLocationsWhich();   // Which locations are right?: shown only while the old lists and the Profile disagree
  // The last good read at once (lib/view-cache.js), then the fresh one.
  const saved = await window.pilot.cached('strategy');
  if (saved?.result?.ok && !strategyState.strategyShown) {
    // The saved copy draws the page at once, but not its alerts about what changes: "Your Profile is empty" and "N scores kept" came back
    // for a few seconds after every refresh, from a copy older than the rebuild that cleared them (7 Oct 2026). The fresh read shows them.
    renderStrategy({...saved.result, profile_empty: false, previous: 0, outdated: null});
    $('strategy-synced').textContent = `Saved ${savedAgo(saved.at)} · updating…`;
  } else if (!strategyState.strategyShown) strategySkeleton();
  const data = await window.pilot.strategyData().catch(error => ({ok: false, error: error.message}));
  if (!data.ok) { $('strategy-view-loading')?.remove(); message('strategy-load', data.error, 'error'); return; }
  message('strategy-load', '');
  $('strategy-view-loading')?.remove();
  renderStrategy(data);
  $('strategy-synced').textContent = `Synced ${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
}
// First load: every card in its final shape, greyed (the same rows, icons and chips), and a pill in the header.
function strategySkeleton() {
  const chipBones = n => { const box = el('div', 'chip-list'); for (let i = 0; i < n; i++) box.append(bone('chip')); return box; };
  // The target cards themselves (TARGET_CARDS: head, then each list's label and chips), greyed. 7 Oct 2026: the old Roles/Locations rows,
  // left from before the cards, fell into the cards' grid as loose lines.
  const bones = TARGET_CARDS.map(([key, glyph, title, lists]) => {
    const card = el('section', 'card is-loading'), head = el('div', 'card-head'), heading = el('h3');
    card.dataset.list = key;
    heading.append(tile(glyph, CARD_TONE[key] || 'neutral'), title);
    head.append(heading);
    card.append(head);
    for (const [name, label] of shownLists(lists)) {
      if (name === 'places') { const priority = el('div', 'priority'); priority.append(el('b', '', label), chipBones(2)); card.append(priority); continue; }
      if (label) card.append(el('p', 'sub', label));
      card.append(chipBones(lists.length > 1 ? 2 : 3));
    }
    return card;
  });
  $('strategy-locations').replaceChildren(...bones.filter(card => card.dataset.list === 'places'));
  $('strategy-targets').replaceChildren(...inColumns(bones.filter(card => ADVANCED.includes(card.dataset.list))));
  const goals = el('section', 'card main-goals is-loading'), strip = el('div', 'goal-strip main-goal-tiles');
  for (let i = 0; i < 4; i++) strip.append(bone('w-label'), bone('w-name tall'));
  goals.append(el('div', 'card-head'), strip);
  goals.firstChild.append(Object.assign(el('h3'), {textContent: 'Main goals'}));
  $('strategy-main-goals').replaceChildren(goals);
  $('strategy-scores').replaceChildren(...['settings', 'layers', 'pin', 'chart'].map(glyph => {
    const line = el('div', 'score-bar is-loading');
    line.append(icon(glyph), bone('w-name tall'), bone('w-track'), bone('w-level'));
    return line;
  }));
  $('strategy-glance').replaceChildren(...['file', 'layers', 'send'].map(glyph => {
    const line = el('div', 'glance-row is-loading');
    line.append(tile(glyph, 'neutral'), bone('w-count tall'), bone('w-label'), el('span', 'glance-arrow', '›'));
    return line;
  }));
  const insight = $('strategy-insight');
  insight.hidden = false;
  insight.classList.add('is-loading');
  $('strategy-insight-text').replaceChildren(bone('w-80'), bone('w-60'));
  const pill = el('span', 'loading-pill', 'Loading strategy…');
  pill.id = 'strategy-view-loading';
  $('strategy-synced').replaceChildren(pill);
}

// Run at start-up, in the order the window has always done it (app.js calls each page's init in turn).
export async function init() {
  // A page read through the extension (Sites only you can open): said wherever the window is, once per page.
  // Few new jobs twice in a row (lib/few-jobs.js): a dot on Strategy until it is opened.
  window.pilot.onFewJobs?.(() => show($('strategy-dot'), true));
  document.querySelector('.nav[data-view=strategy]')?.addEventListener('click', () => show($('strategy-dot'), false));
  window.pilot.onVisitRead?.(answer => toastMessage(answer.fits === undefined ? `Read ${answer.jobs} jobs from ${answer.name}` : `Read ${answer.jobs} jobs from ${answer.name}, ${answer.fits} matching your search`,
    answer.fits ? 'Your next jobs check scores the matching ones: those that fit your profile join your Jobs list.' : 'The reading works; none of these match your role words and places, so your Jobs list stays the same.'));
  for (const tab of document.querySelectorAll('.strategy-tabs [data-tab]')) tab.addEventListener('click', () => showTab(tab.dataset.tab));
  // One bar for every Strategy draft, "Save strategy changes" (owner, 18 Oct 2026, decision 4); leaving with a draft asks (Keep editing / Discard all / Save).
  const bar = strategyBar({redraw: renderCards, reload: loadStrategy, entriesOf: name => entriesOf(strategyState.lastStrategy, name)});
  guardLeave('strategy', bar.leave);
  $('profile-empty-rebuild').addEventListener('click', () => $('strategy-redo').click());   // the same Rebuild from CV as the Profile page
  // ⋯ → the one Notion link (owner, 18 Oct 2026, review fix 10): the search settings page, else the Profile (Job preferences live there).
  const sourceKey = () => (shared.state.notion?.NOTION_SEARCH_SETTINGS_PAGE ? 'NOTION_SEARCH_SETTINGS_PAGE' : 'NOTION_PROFILE_PAGE_ID');
  $('strategy-more').addEventListener('click', () => openMenu($('strategy-more'), [{label: 'View source in Notion', icon: 'link', run: event => openInNotion(sourceKey(), event)}]));   // about Notion
  $('strategy-jobs').addEventListener('click', () => openView('jobs'));
}

