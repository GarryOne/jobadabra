// Strategy page, suggestions: the Improve-your-search rows, coverage verdict, ideas, rescore confirm, and Tune my strategy's row from Focus's pool
// (pages/focus-suggestions.js). Guarded by: test/advice-events.test.js, test/coverage-card.test.js, test/filters-card.test.js, test/suggestions.test.js.
import {withSaveProgress} from '../save-progress.js';
import {el, moreButton, pill, tile} from '../components.js';
import {icon} from '../icons.js';
import {$, show} from './core.js';
import {openView} from './nav.js';
import {toastMessage} from './startup.js';
import {coverageCard, employersCard, filtersCard, ideasCard, placesCard, sourcesCard, visitCard} from '../coverage-card.js';
import {adviceEvent, readSiteInChrome, runAction} from '../coverage-actions.js';
import {byOpenings, hostOf, improveWords, sitesByName} from '../strategy-parts.js';
import {openSetting} from './settings.js';
import {startSearch} from './jobs.js';
import {strategyState, showTab} from './strategy-state.js';
import {loadStrategy} from './strategy.js';
import {entriesOf, renderTargets} from './strategy-targets.js';
import {dirty, strategyBarNow} from './strategy-cards.js';
import {byStore} from '../store-words.js';
import {countOf, defineCount, paintCount} from '../shared-counts.js';
import {NO_PLACE} from '../targets.js';
import {RUN, answerEntry, answered, homeSuggestions} from './focus-suggestions.js';
import {bone, loadFocus} from './focus.js';
import {aside} from '../ideas-aside.js';
// Where else the change shows: Notion's ⚙️ Search settings page, only while Notion holds the data (on this Mac they are the app's own).
const alsoInSettings = () => byStore(' (also in your Search settings in Notion)', '');

// ---------- Suggestions: one row per kind (owner mockup, 7 Oct 2026: five banners pushed your own settings below the fold) ----------
// The engine's coverage verdict (src/coverage.py, read after the strategy: a Python start) and the roles from your Profile (src/ai/role_ideas.py)
// give the rows; each row says what it is in a line, Review opens what would change (one button per option), ⋯ answers it (Not now, Not true).
// The last verdict, kept so the rows are in place at the FIRST paint: the engine's answer takes seconds, and a card that arrived after the page had
// stood still pushed everything down while it was being read (5 Oct 2026). With nothing kept yet, a "Checking…" row holds the place.
const LAST = 'jp.coverage.last';
const lastVerdict = () => { try { const saved = JSON.parse(localStorage.getItem(LAST) || 'null'); return saved && 'verdict' in saved ? saved : null; } catch { return null; } };
let checking = false;
const rows = {};   // kind → the row's element, or null when it has nothing to say
const ORDER = ['tune', 'places', 'ideas', 'coverage', 'filters', 'sources', 'visits', 'foryou'];   // tune first: it rests on your own results
// One count of the suggestions, painted wherever it shows (shared-counts.js): the Suggestions tab's badge and the line under the tabs.
const SUGGESTIONS = 'strategy-suggestions';
defineCount(SUGGESTIONS, () => ORDER.filter(kind => rows[kind]).length);
const plain = label => label.replace(/^[+−] /, '');
const number = value => Number(value || 0).toLocaleString('en-US');

// Review from elsewhere (Recent activity's "Review location"): Strategy opens with that row's options showing. Kept until the row is drawn.
let pendingReview = '';
const openRows = new Set();   // rows whose options are showing: the rows are drawn again when the fresh verdict lands, and stay open
export function reviewSuggestion(id) {
  pendingReview = id;
  if (document.querySelector('.view[data-view=strategy]')?.hidden) openView('strategy');
  showTab('strategy-suggestions');
  openPending();
}
function openPending() {
  const row = pendingReview && rows[pendingReview];
  if (!row?.isConnected) return;
  const toggle = row.querySelector('[data-review]');
  if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
  row.scrollIntoView({block: 'center'});
  pendingReview = '';
}
function drawSuggestions() {
  answeredShown = answeredKeys();
  const list = ORDER.map(kind => rows[kind]).filter(Boolean);
  const box = $('suggestion-rows');
  if (checking) {
    const row = el('section', 'suggestion-card is-loading'), head = el('div', 'suggestion-head'), words = el('div', 'suggestion-words');
    row.id = 'strategy-coverage-checking';
    row.setAttribute('aria-busy', 'true');
    words.append(el('h3', '', 'Checking whether your search is too narrow…'), el('span', 'muted', 'Reading the postings your searches saw.'));
    head.append(tile('target', 'neutral'), words);
    row.append(head);
    list.push(row);
  }
  box.replaceChildren(...(list.length ? list : [el('p', 'card muted empty-row', 'No suggestions right now: your search already catches what the last check saw.')]));
  paintCount(SUGGESTIONS);   // the tab's badge; the line under the tabs paints the same count (drawImprove)
  drawImprove();
  openPending();
}
// ---------- Improve your search: ONE compact line under the tabs, on Your strategy and Scoring (owner, 18 Oct 2026, review fix 3: "7 suggestions to
// improve your search · Review", optionally the top one; the full list only in Suggestions; it was a row per kind above the tabs since 7 Oct 2026).
// briefs: what each kind says, set as its row is built; the line names the first kind in ORDER. While the checks are on their way, a placeholder line
// stands where the line was last time (or on a first visit), so the content under it does not jump when it lands (owner, 7 Oct 2026).
const briefs = {};
export const pendingImprove = new Set();
const SEEN = 'jp.improve.seen';   // whether the line was there last time it was complete
const seenLine = () => { try { return localStorage.getItem(SEEN); } catch { return null; } };
export function drawImprove() {
  const box = $('strategy-improve');
  const kinds = ORDER.filter(id => rows[id] && briefs[id]);
  const waiting = pendingImprove.has('ideas') || checking;
  if (!kinds.length && waiting && seenLine() !== '0') {
    const line = el('div', 'improve-placeholder');
    line.setAttribute('aria-busy', 'true');
    line.append(bone('tile'), bone('w-60'), bone('button small'));
    box.replaceChildren(line);
    show(box, true);
    return;
  }
  if (!waiting) { try { localStorage.setItem(SEEN, kinds.length ? '1' : '0'); } catch { /* a placeholder next time */ } }
  if (!countOf(SUGGESTIONS)) { box.replaceChildren(); show(box, false); return; }
  const {top} = improveWords(briefs[kinds[0]]);
  const words = el('div', 'notice-words'), title = el('b'), count = el('span');
  Object.assign(count.dataset, {countOf: SUGGESTIONS, countOne: 'suggestion'});
  title.append(count, ' to improve your search');
  words.append(title);
  if (top) box.title = `Top: ${top}`;   // the line stays one count and one action (mockup 03); the top one on hover, in full on Suggestions
  const go = el('button', 'secondary item-action', 'Review suggestions');
  go.type = 'button';
  go.addEventListener('click', () => showTab('strategy-suggestions'));
  box.replaceChildren(tile('bulb', 'signal'), words, go);
  paintCount(SUGGESTIONS, box);
  show(box, true);
}
// One row: icon, title, a line on what it is, Review (opens the options) and ⋯ (hide). options: [{label, preview, button, run(button)}].
// Ids kept from the banners (#strategy-foryou, #foryou-chips…): the e2e suites and the late-shift watch find them by these.
// Each row's id and its options' list, written out: the e2e suites (foryou) and the push check look for these words.
const ROW_IDS = {coverage: ['strategy-coverage', 'coverage-chips'], places: ['strategy-places', 'places-chips'], filters: ['strategy-filters', 'filters-chips'],
  sources: ['strategy-sources', 'sources-chips'], visits: ['strategy-visits', 'visits-chips'], foryou: ['strategy-foryou', 'foryou-chips'], ideas: ['strategy-ideas', 'ideas-chips']};
// Each kind's colour (owner, 7 Oct 2026: "bring this page to life"): blue for sources, teal for locations, violet for roles, amber for manual
// browsing; orange stays the action colour. Used by its tile here and in Improve your search.
const TONE = {tune: 'violet', places: 'teal', ideas: 'violet', coverage: 'violet', filters: 'neutral', sources: 'info', visits: 'warn', foryou: 'good'};
// Numbers carry the meaning ("30 matching roles", "8 suggestions"): bold, the words around them muted.
function emphasize(text) {
  const box = el('span', 'muted');
  for (const [i, part] of String(text).split(/(\d[\d,.']*)/).entries()) box.append(i % 2 ? el('b', 'figure', part) : part);
  return box;
}
// One card per kind: tile, bold title (and how many options), a line with its numbers, its action; Review opens the options under a tinted head.
// option: {label, why, meta?, tech?, button, accent?, run(button)}; body: drawn instead of the option cards (the sites, by company).
function suggestionRow({kind, id, glyph, title, summary, text, options = [], hidden = [], hiddenLabel = '', review = 'Review', menu, brief, note = '', body = null, count = null}) {
  briefs[id] = {glyph, ...brief};
  const tone = TONE[id] || 'neutral';
  const row = el('section', `suggestion-card tone-${tone}`);
  row.id = ROW_IDS[id][0];
  const detail = el('div', 'suggestion-detail');
  detail.id = `${ROW_IDS[id][0]}-detail`;
  detail.hidden = true;
  const closedLabel = brief?.cta || review;
  const toggle = el('button', 'secondary', closedLabel);
  toggle.type = 'button';
  toggle.dataset.review = kind;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', detail.id);
  const setOpen = open => {
    detail.hidden = !open;
    row.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Collapse' : closedLabel;
    if (open) openRows.add(id); else openRows.delete(id);
  };
  toggle.addEventListener('click', () => setOpen(detail.hidden));
  const optionCard = option => {
    const card = el('div', 'option-row option-card'), words = el('div', 'option-words');
    words.append(el('b', '', option.label), el('span', 'muted', option.why || option.preview || ''));
    if (option.meta) { const meta = el('span', 'option-meta', icon('info')); meta.append(option.meta); words.append(meta); }
    if (option.tech) { const more = el('details', 'plain option-tech'); more.append(el('summary', '', 'Search details'), el('span', 'muted small', option.tech)); words.append(more); }
    const button = el('button', `secondary${option.accent ? ' is-signal' : ''}`, option.button);
    Object.assign(button, {type: 'button', title: option.preview || option.why || ''});
    button.addEventListener('click', () => option.run(button));
    card.append(words, button);
    return card;
  };
  const chips = el('div', body ? 'site-list' : 'option-grid');
  chips.id = ROW_IDS[id][1];
  if (body) chips.append(...body); else chips.append(...options.map(optionCard));
  if (note) { const strip = el('p', 'suggestion-note', icon('info')); strip.append(note); detail.append(strip); }
  if (text) detail.append(el('p', 'muted small suggestion-text', text));
  detail.append(chips);
  if (hidden.length) {
    const more = el('button', 'link', `${hiddenLabel} (${hidden.length})`);
    more.type = 'button';
    more.addEventListener('click', () => { chips.append(...hidden.map(optionCard)); more.remove(); });
    detail.append(more);
  }
  const head = el('div', 'suggestion-head'), words = el('div', 'suggestion-words'), name = el('div', 'suggestion-title');
  name.append(el('h3', '', title), ...(count ? [pill(String(count), tone)] : []));
  words.append(name, typeof summary === 'string' ? emphasize(summary) : summary);
  head.append(tile(glyph, tone), words, toggle, ...(menu.length ? [moreButton(menu, `More about ${title.toLowerCase()}`)] : []));
  row.append(head, detail);
  if (openRows.has(id)) setOpen(true);
  adviceEvent('shown', kind, 'strategy');
  return row;
}
// Tune my strategy (src/tune.py, counts only; spec PR 1a): "N changes your results support", Review opens the Tune dialog, ⋯ keeps Not now or
// Not true in your store. Shown only while your results support a change; drawn again only when that changes (a Focus read with the same
// changes leaves the rows alone).
function tuneRow(entry) {
  briefs.tune = {glyph: 'sliders', title: entry.title, text: entry.detail, cta: 'Review'};
  const row = el('section', `suggestion-card tone-${TONE.tune}`);
  Object.assign(row, {id: 'strategy-tune'});
  row.dataset.key = entry.key;
  const head = el('div', 'suggestion-head'), words = el('div', 'suggestion-words'), name = el('div', 'suggestion-title');
  name.append(el('h3', '', entry.title));
  words.append(name, emphasize(entry.detail));
  const review = el('button', 'secondary', 'Review');
  review.type = 'button';
  review.addEventListener('click', () => RUN.tune());
  head.append(tile('sliders', TONE.tune), words, review, moreButton([
    {icon: 'clock', label: 'Not now', title: 'Hidden for 14 days, then shown again if your results still support it', run: () => answerEntry(entry, 'Not now')},
    {icon: 'close', label: 'Not true', title: 'Never shown again for these changes', run: () => answerEntry(entry, 'Not true')}], 'More about tuning'));
  row.append(head);
  return row;
}
window.addEventListener('suggestions-updated', () => {
  const [entry] = homeSuggestions('strategy').filter(one => one.kind === 'tune');
  const tune = (rows.tune?.dataset.key || '') !== (entry?.key || '');
  if (tune) rows.tune = entry ? tuneRow(entry) : null;
  if (answeredKeys() !== answeredShown) repaint();   // a row answered on Focus leaves here too, or comes back when the store refused it
  else if (tune) drawSuggestions();
});
// ⋯ on a row: Not now (14 days) and Not true (never for this top option), kept in your store against the row's key (src/suggestions_search.py
// keys), the same answer its Focus row takes. Why (insights PR 1b, owner 28 Oct 2026): "Hide until the next search" went; one answer everywhere.
const rowKeys = () => [...Object.values(strategyState.shownVerdict?.keys || {}), ideasKey].filter(Boolean);
const answeredKeys = () => rowKeys().filter(answered).join('\n');
let answeredShown = '';
const repaint = () => (strategyState.shownVerdict ? paintCoverage(strategyState.shownVerdict) : shownIdeas && paintIdeas(shownIdeas));
const answerItems = (advice, key, title, aside = []) => (key ? [['clock', 'Not now', 'Hidden for 14 days, then shown again if it still holds. Your settings do not change.'],
  ['close', 'Not true', 'Never shown again for this suggestion; a new one can still come.']].map(([glyph, state, hint]) => ({icon: glyph, label: state, title: hint,
  run: () => { adviceEvent('dismissed', advice, 'strategy'); answerEntry({key, title, aside}, state); repaint(); }})) : []);
// One option done, from Strategy or from Focus's one press (where): a change to your search (a role word, a place, a filter removed) is saved to
// Search settings, said, and both pages read again; a site opens in your Chrome. action: {kind, value, note?} (coverage-actions.js runAction).
// While a draft changes the same list, applying waits: reviewing is fine, the change itself asks for Save or Discard first (owner, 7 Oct 2026).
const CHANGES = {
  place: value => ({list: 'places', done: `${value} is now one of your places${alsoInSettings()}. Jobs you already have stay.`}),
  role: value => ({list: 'roles', done: `"${value}" is now a role word${alsoInSettings()}.`}),
  exclude: value => ({list: '', done: `Titles with "${value.replace(/\\b/g, '')}" are no longer left out${alsoInSettings()}.`}),
  language: value => ({list: 'languages', done: `Jobs that require ${value} are no longer hidden${alsoInSettings()}.`}),
};
/** Does one search suggestion's option (Strategy's button, or Focus's one press: src/suggestions_search.py actions). */
export async function changeSearch(action, button, where = 'strategy') {
  if (action.kind === 'visit') {
    adviceEvent('taken', 'visit', where);
    const opened = await readSiteInChrome(window.pilot, action.value);
    if (opened.started) toastMessage('Reading in Chrome', `Jobadabra reads its jobs there by itself; follow it in Recent activity.${action.note ? ` ${action.note}.` : ''}`, {activity: true}, 'info');
    else toastMessage(opened.ok ? 'Opened in Chrome' : 'Not opened', opened.ok ? opened.why || 'It could not start the read.' : opened.error, NO_PLACE.outside, opened.ok ? 'info' : 'bad');
    return;
  }
  const {list, done} = CHANGES[action.kind](action.value);
  if (list && dirty().has(list)) {
    toastMessage('Save or discard your changes first', `This changes your ${LIST_WORDS[list]}, which you are editing now. Save or discard that draft, then add it.`, {view: 'strategy'}, 'warn');
    const bar = strategyBarNow()?.node;
    if (bar) { bar.classList.remove('is-nudged'); void bar.offsetWidth; bar.classList.add('is-nudged'); }
    return;
  }
  const label = button.textContent;
  button.disabled = true;
  const result = await withSaveProgress(words => { button.textContent = words; }, () => runAction(action, {pilot: window.pilot, openSetting}))
    .catch(error => ({ok: false, error: error.message}));
  button.textContent = label;
  if (!result.ok) { toastMessage('Not added', result.error, {view: 'strategy'}, 'bad'); button.disabled = false; return; }
  adviceEvent('taken', action.kind, where);
  // The next step with it: a refresh searches with the change (7 Oct 2026: the pop-up said only "Search widened").
  toastMessage({title: 'Search widened', body: `${done} Refresh your jobs to search with it.`, action: refreshAction, target: {view: 'strategy'}, tone: 'good'});
  if (where === 'strategy') loadStrategy();   // the cards show it at once, not after the next visit (it re-reads the suggestions too)
  loadFocus();   // Focus's row offers the next option, or leaves
}
const press = action => button => changeSearch(action, button);

export const refreshAction = {label: 'Find jobs', run: () => startSearch()};
const LIST_WORDS = {roles: 'roles', places: 'places', languages: 'excluded languages'};
// A row is drawn while its key is not answered (a verdict kept from before its keys draws every row, without the answers, until the fresh one).
const unanswered = (card, key) => (card && !(key && answered(key)) ? card : null);
const paintCoverage = verdict => {
  strategyState.shownVerdict = verdict;
  const keys = verdict?.keys || {};
  const coverage = unanswered(coverageCard(verdict), keys.coverage);
  rows.coverage = coverage && suggestionRow({kind: 'coverage', id: 'coverage', glyph: 'search', title: verdict.local ? 'Catch titles in other languages' : 'Add role words',
    summary: `Your keywords catch ${number(verdict.matched)} of ${number(verdict.in_places)} postings in your places`, text: coverage.text,
    options: coverage.chips.map(chip => ({label: plain(chip.label), button: 'Add role word', preview: `Adds "${chip.term}" to your role words. ${chip.title}`,
      run: press({kind: 'role', value: chip.term})})),
    brief: {title: verdict.local ? 'Catch titles in other languages' : 'Add role words', text: `Your keywords catch ${number(verdict.matched)} of ${number(verdict.in_places)} postings in your places`, cta: 'Review role words'},
    menu: answerItems('coverage', keys.coverage, 'Add role words')});
  const places = unanswered(placesCard(verdict), keys.places);
  const topPlace = places?.chips[0];
  rows.places = places && suggestionRow({kind: 'places', id: 'places', glyph: 'pin', title: 'Broaden locations',
    summary: `${topPlace.place} · ${number(topPlace.count)} matching role${topPlace.count === 1 ? '' : 's'} outside your places${places.chips.length > 1 ? `, and ${places.chips.length - 1} more place${places.chips.length > 2 ? 's' : ''}` : ''}`,
    text: places.text,
    options: places.chips.map(chip => ({label: plain(chip.label), button: 'Add place', preview: `Adds ${chip.place} to your places; jobs you already have stay. ${chip.title}`,
      run: press({kind: 'place', value: chip.place})})),
    brief: {title: 'Expand your locations', text: `${number(topPlace.count)} matching role${topPlace.count === 1 ? '' : 's'} in ${topPlace.place}${places.chips.length > 1 ? ` and ${places.chips.length - 1} more place${places.chips.length > 2 ? 's' : ''}` : ''}`, cta: 'Review location'},
    menu: answerItems('places', keys.places, 'Broaden locations')});
  // Filters of the user's own that hide matching jobs: an option removes that filter.
  const filters = unanswered(filtersCard(verdict), keys.filters);
  const filterHidden = filters ? filters.chips.reduce((sum, chip) => sum + chip.count, 0) : 0;
  rows.filters = filters && suggestionRow({kind: 'filters', id: 'filters', glyph: 'sliders', title: 'Loosen your filters',
    summary: `${filters.chips.length} of your filters hide ${number(filterHidden)} matching job${filterHidden === 1 ? '' : 's'}`, text: filters.text,
    options: filters.chips.map(chip => ({label: plain(chip.label), button: 'Remove filter', preview: chip.title,
      run: press(chip.exclude ? {kind: 'exclude', value: chip.exclude} : {kind: 'language', value: chip.language})})),
    brief: {title: 'Loosen your filters', text: `${filters.chips.length} of your filters hide ${number(filterHidden)} matching job${filterHidden === 1 ? '' : 's'}`, cta: 'Review filters'},
    menu: answerItems('filters', keys.filters, 'Loosen your filters')});
  // Unused job sources: an option opens its panel in Settings → Connections (a key to add there); nothing is turned on from here.
  const sources = unanswered(sourcesCard(verdict), keys.sources);
  rows.sources = sources && suggestionRow({kind: 'source', id: 'sources', glyph: 'link', title: 'Connect more job sources', review: 'Set up',
    summary: sources.chips.map(chip => plain(chip.label).split(' · ')[0]).join(' · '), text: sources.text,
    options: sources.chips.map(chip => ({label: plain(chip.label), button: 'Open in Settings', preview: chip.title,
      run: () => { adviceEvent('taken', 'source', 'strategy', {source: chip.id}); openSetting(chip.id); }})),
    brief: {title: 'Connect more sources', text: sources.chips.map(chip => plain(chip.label).split(' · ')[0]).join(', '), cta: 'Set up'},
    menu: answerItems('source', keys.sources, 'Connect more job sources')});
  // Sites only you can open: one chip per company in the row; Review lists every page (a company can have two genuinely different ones).
  const visits = unanswered(visitCard(verdict), keys.visits);
  if (visits) {
    const sites = sitesByName(visits.chips);
    const openPage = chip => event => changeSearch({kind: 'visit', value: chip.url, note: chip.note}, event.currentTarget);
    // By company (owner mockup, 7 Oct 2026): a letter tile, the name, how many pages, each page's own link (its real address), Open for the first.
    const TINTS = ['info', 'teal', 'violet', 'good'];
    const company = (site, i) => {
      const line = el('div', 'site-row'), words = el('div', 'site-words'), name = el('div', 'site-name'), links = el('div', 'site-links');
      name.append(el('b', '', site.name), ...(site.pages.length > 1 ? [pill(`${site.pages.length} destinations`)] : []));
      links.append(...site.pages.map(page => {
        const link = el('button', 'link', hostOf(page.url) || page.url);
        Object.assign(link, {type: 'button', title: page.title});
        link.addEventListener('click', openPage(page));
        return link;
      }));
      words.append(name, links);
      const open = el('button', 'secondary with-icon', 'Open');
      Object.assign(open, {type: 'button', title: site.pages[0].title});
      open.append(icon('external'));
      open.addEventListener('click', openPage(site.pages[0]));
      line.append(el('span', `ui-tile tone-${TINTS[i % TINTS.length]} site-avatar`, site.name.trim()[0]?.toUpperCase() || '?'), words, open);
      return line;
    };
    const SHOWN = 5;
    const list = sites.slice(0, SHOWN).map(company);
    if (sites.length > SHOWN) {
      const all = el('button', 'link site-all', `View all ${sites.length} sites →`);
      all.type = 'button';
      all.addEventListener('click', () => { all.replaceWith(...sites.slice(SHOWN).map((site, i) => company(site, i + SHOWN))); });
      list.push(all);
    }
    rows.visits = suggestionRow({kind: 'visit', id: 'visits', glyph: 'external', title: 'Browse sites manually', count: sites.length,
      summary: 'Open a site: Jobadabra reads its jobs in Chrome by itself.', text: '', body: list,
      brief: {title: `${sites.length} site${sites.length === 1 ? ' needs' : 's need'} manual browsing`, text: 'Use the Chrome extension', cta: 'View sites'},
      menu: answerItems('visit', keys.visits, 'Browse sites manually')});
  } else rows.visits = null;
  // Employers where people like you got interviews (shared pool): an option shows that employer's jobs in the Jobs list.
  const forYou = unanswered(employersCard(verdict), keys.foryou);
  rows.foryou = forYou && suggestionRow({kind: 'employer', id: 'foryou', glyph: 'building', title: 'Employers hiring people like you',
    summary: forYou.chips.slice(0, 3).map(chip => chip.company).join(' · ') + (forYou.chips.length > 3 ? ` and ${forYou.chips.length - 3} more` : ''), text: forYou.text,
    options: forYou.chips.map(chip => ({label: chip.label, button: 'See their jobs', preview: chip.title, run: () => {
      adviceEvent('taken', 'employer', 'strategy');
      openView('jobs');
      const box = $('filter-text');
      if (box) { box.value = chip.company; box.dispatchEvent(new Event('input', {bubbles: true})); }
    }})),
    brief: {title: 'Employers hiring people like you', text: forYou.chips.slice(0, 3).map(chip => chip.company).join(', ') + (forYou.chips.length > 3 ? ` and ${forYou.chips.length - 3} more` : ''), cta: 'See employers'},
    menu: answerItems('employer', keys.foryou, 'Employers hiring people like you')});
  if (shownIdeas) paintIdeas(shownIdeas);   // drawn before this check answered: its "your role words catch" line comes now
  drawSuggestions();
  if (strategyState.strategyShown && !strategyState.editing) renderTargets();   // the exclusions card says what the languages hid
};
// first: called when the page starts to load, beside the strategy read (not after it).
export async function loadCoverage({first = false} = {}) {
  if (first) {
    const last = lastVerdict();
    if (last) paintCoverage(last.verdict); else { checking = true; drawSuggestions(); }
  }
  const answer = await window.pilot.searchCoverage().catch(() => null);
  checking = false;
  const verdict = answer?.ok ? answer.coverage : null;
  if (answer?.ok) { try { localStorage.setItem(LAST, JSON.stringify({verdict})); } catch { /* the rows still show */ } }
  paintCoverage(verdict);
  await loadIdeas();
  pendingReview = '';   // the row it asked for is not there any more (hidden, or the search changed): nothing opens later by surprise
}
// "Explore related roles" (src/ai/role_ideas.py, owner 7 Oct 2026: "suggest potential roles"): roles from the Profile with how many open jobs in
// your places each would add; those with openings first, the empty ones behind "Show more". ⋯ Not true sets them aside too (ideas-aside.js): the
// engine never proposes them again.
// The last answer, kept: the engine asks Claude at most once a day (src/ai/role_ideas.py), so the kept ideas are today's and the row shows at
// the first paint (owner, 7 Oct 2026: the rows "add up after 5-10 seconds"). The fresh answer then replaces them quietly.
// Kept with the answer's key (src/suggestions_search.py ideas_key): the row's Not now / Not true. A list kept before keys has none until the next answer.
const IDEAS_LAST = 'jp.ideas.last';
const keptIdeas = () => {
  try { const kept = JSON.parse(localStorage.getItem(IDEAS_LAST) || 'null'); return Array.isArray(kept) ? {ideas: kept, key: ''} : Array.isArray(kept?.ideas) ? kept : null; } catch { return null; }
};
let ideasKey = '';
async function loadIdeas() {
  const kept = keptIdeas();
  if (kept) { ideasKey = kept.key; paintIdeas(kept.ideas); }
  else { pendingImprove.add('ideas'); drawImprove(); }   // nothing kept yet: a placeholder holds its place while the engine answers
  const answer = await window.pilot.roleIdeas?.(aside()).catch(() => null);
  pendingImprove.delete('ideas');
  const fresh = answer?.ok && Array.isArray(answer.ideas);
  if (fresh) { ideasKey = answer.key || ''; try { localStorage.setItem(IDEAS_LAST, JSON.stringify({ideas: answer.ideas, key: ideasKey})); } catch { /* shown when it answers */ } }
  paintIdeas(fresh ? answer.ideas : kept?.ideas || []);   // the engine could not answer: the kept ideas stay
}
let shownIdeas = null;
function paintIdeas(ideas) {
  shownIdeas = ideas;
  // A kept idea already added as a role is not offered again (the engine leaves it out of its next answer too).
  const searched = new Set(entriesOf(strategyState.lastStrategy, 'roles').map(entry => String(entry.fragment).toLowerCase()));
  const card = unanswered(ideasCard((ideas || []).filter(idea => !searched.has(String(idea.word).toLowerCase())), aside(), strategyState.shownVerdict), ideasKey);
  if (!card) { rows.ideas = null; drawSuggestions(); return; }
  // A card each: the role, why it fits, its openings; the word it is searched by under "Search details" (owner mockup, 7 Oct 2026).
  const option = chip => ({label: chip.role || plain(chip.label).replace(/ · \d+$/, ''), why: String(chip.why || '').replace(/\.+$/, '.'), button: '+ Add role', accent: true,
    meta: `${chip.count} opening${chip.count === 1 ? '' : 's'} now in your places`, tech: `Searched as "${chip.term}" in job titles. Adding it makes the next searches look for it.`,
    preview: `Adds "${chip.term}" to your role words: ${chip.title}`,
    run: press({kind: 'role', value: chip.term})});
  const {open, empty} = byOpenings(card.chips);
  const top = open[0];
  rows.ideas = suggestionRow({kind: 'ideas', id: 'ideas', glyph: 'briefcase', title: 'Explore related roles', count: card.chips.length,
    note: open.length ? '' : 'No current openings found in your selected locations.',
    summary: card.narrow || (top ? `${plain(top.label).replace(/ · \d+$/, '')} · ${top.count} open role${top.count === 1 ? '' : 's'}${open.length > 1 ? `, and ${open.length - 1} more` : ''}`
      : `${empty.length} role${empty.length === 1 ? '' : 's'} from your Profile, none with openings in your places now`),
    text: 'Based on your Profile. A role you add is included in your future searches.', options: (open.length ? open : empty).map(option), hidden: open.length ? empty.map(option) : [],
    hiddenLabel: 'Show roles with no current openings',
    brief: {title: 'Explore related roles', text: `${card.chips.length} suggestion${card.chips.length === 1 ? '' : 's'}${open.length ? `, ${open.length} with openings in your places` : ', no current openings in your places'}`, cta: 'Review roles'},
    menu: answerItems('ideas', ideasKey, 'Explore related roles', card.chips.map(chip => chip.term))});
  drawSuggestions();
}
