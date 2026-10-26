// Strategy page, the target cards: Locations and the Advanced ones (skills, exclusions, more search settings), their lists (chips,
// the remote choice, the digest minimum) as read and in their editor, and renderStrategy. One card's editor at a time, drafts kept per card, one page bar
// (strategy-cards.js); the Main goals card is main-goals.js. Guarded by: test/strategy-cards.test.js, save-progress, strategy-chips, locations-card tests.
import {withSaveProgress} from '../save-progress.js';
import {el, pill, tile} from '../components.js';
import {readRows} from '../card-shell.js';
import {icon} from '../icons.js';
import {shared} from './shared.js';
import {$, show} from './core.js';
import {openView} from './nav.js';
import {searchLevel} from '../goal-kinds.js';
import {toastMessage} from './startup.js';
import {offered, shownLists} from '../key-sources.js';
import {titleCase} from './strategy-review.js';
import {showSearchChanged, wireSearchChanged} from '../search-changed.js';
import {exclusionGroups, withTyped} from '../strategy-parts.js';
import {inDraft, sink} from '../strategy-sink.js';
import {strategyState} from './strategy-state.js';
import {PLAIN, cardHeader, changed, dirty, drafts, isOpen, cardOf, openCard, redrawCards} from './strategy-cards.js';
import {renderMainGoals} from './main-goals.js';
import {redrawPreferences} from './job-preferences.js';
import {coverageLine, relocationChoice} from './locations-card.js';
import {coverage, relocationNow, relocationWords, remoteWords} from '../locations-model.js';
import {loadStrategy} from './strategy.js';
import {drawImprove, refreshAction} from './strategy-suggestions.js';
import {drawOutdated} from './strategy-rescore.js';
import {chipsOf, folded, loadMeanings, meaningLabels, typoHints} from './strategy-chips.js';
const SEARCHED = 5;   // lib/target-roles.js: the titles also typed into job boards
import {GROUPS, asWholeWord, matchGroups, placeLabel, shownGroups, shownWord} from '../match-groups.js';

// ---------- The setup review's cards, with your live settings (owner, 7 Oct 2026). Lists: Edit → the page bar's Save (lib/strategy.js editLists, to
// ⚙️ Search settings). [card, icon, title, its lists: [list, label or note, what the add field asks]]. Target roles moved to Main goals (owner, 18 Oct
// 2026, mockup 03); every other list still edits here: Locations beside Job preferences, the rest folded under Advanced search settings.
export const CARD_TONE = {roles: 'violet', places: 'teal', stack: 'info', languages: 'warn', search: 'neutral'};   // the colours of each kind's suggestions
export const TARGET_CARDS = [
  ['places', 'pin', 'Locations', [['places', 'Preferred locations', 'Add a city or region'], ['country', 'Acceptable locations', 'Add a country or region'],
    ['abroad', 'Places you would relocate to', 'Add a city abroad'], ['rights', 'Work rights: where you can work without a visa', 'Add a country or EU']]],
  ['stack', 'layers', 'Skills & experience', [['stack', 'Key skills and tools you want in jobs.', 'Add a skill or tool']]],
  ['languages', 'shield', 'Exclusions & preferences', [['languages', 'Languages that rule a job out', 'Add a language']]],
  // What only the ⚙️ Search settings page had (P8, 9 Oct 2026), so every store edits it here (lib/strategy-edit.js), with the level and the digest's minimum.
  ['search', 'search', 'More search settings', [['titleSkip', 'Job titles to skip', 'Add a word'], ['skip', 'Companies to skip', 'Add a company'], ['remoteSkip', 'Remote jobs: regions to skip', 'Add a region'],
    ['finders', 'Words that find new employers', 'Add a word'], ['gqueries', 'Google Jobs searches', 'Add a search'],
    ['gplaces', 'Google Jobs places: "City,Region,Country · language"', 'Add a place, e.g. Zurich,Zurich,Switzerland · de']]],
];
export const TARGET_LISTS = ['roles', ...TARGET_CARDS.flatMap(([, , , lists]) => lists.map(([name]) => name))];
export {shownLists};
// Advanced search settings: one column of full-width cards (owner, 25 Oct 2026: "2 columns with very different heights, let's better have 1 column, and
// full rows cards"; they hold lists that grow with the user's data, so each is .is-wide in the shared .card-grid).
export const ADVANCED = ['stack', 'languages', 'search'];
export const inColumns = cards => ADVANCED.map(key => cards.find(card => card.dataset.list === key || card.dataset.card === key)).filter(Boolean)
  .map(card => { card.classList.add('is-wide'); return card; });
// A list's entries as stored ({fragment, label}): the match lists come as both, the plain ones (search phrases, languages) as written.
export const entriesOf = (data, name) => data?.lists?.[name] || (data?.texts?.[name] || []).map(text => ({fragment: text, label: text}));
// One list as it will be after Save: the stored entries not removed, then the words added.
export function editedList(entries, edit = {add: [], remove: []}) {
  const gone = new Set(edit.remove);
  return [...entries.filter(entry => !gone.has(entry.fragment)).map(entry => ({...entry, added: false})),
    ...edit.add.map(word => ({fragment: '', label: word, added: true}))];
}
const AS_TYPED = new Set(['skip', 'gplaces']);   // shown as typed too: a company's own spelling, a place's language code ("de", not "De")
// A list's chips: in its card's open editor with × and an add field (Enter adds a chip, never saves), else as stored.
export function listChips(name, placeholder) {
  const editing = isOpen(cardOf(name)), edit = editing ? (drafts().targetEdits[name] ||= {add: [], remove: []}) : null, typed = drafts().typed;
  const stored = entriesOf(strategyState.lastStrategy, name);
  const box = el('div', 'chips');
  const entries = editing ? editedList(stored, edit) : stored;
  // Target roles: one list, the first five titles are also what job boards are searched for (src/target_roles.py SEARCHED), marked with a magnifier.
  const searched = name === 'roles' ? new Set(entries.slice(0, SEARCHED)) : new Set();
  const pillOf = entry => {
    const pill = el('span', `chip${editing ? ' removable' : ''}${entry.added ? ' is-added' : ''}${searched.has(entry) ? ' is-searched' : ''}`);
    if (searched.has(entry)) { pill.title = 'Also searched on job boards'; pill.append(icon('search')); }
    pill.append(el('span', '', name === 'gplaces' ? placeLabel(entry.label) : AS_TYPED.has(name) ? entry.label : titleCase(shownWord(entry.label))));
    if (editing) {
      const remove = Object.assign(document.createElement('button'), {type: 'button', className: 'x', textContent: '×', title: `Remove ${shownWord(entry.label)}`});
      remove.setAttribute('aria-label', `Remove ${shownWord(entry.label)}`);
      remove.addEventListener('click', () => {
        if (entry.added) edit.add = edit.add.filter(word => word !== entry.label); else edit.remove.push(entry.fragment);
        redrawCards();
      });
      pill.append(remove);
    }
    return pill;
  };
  // A match list holding both kinds: its whole-word entries under their own name (match-groups.js), never shown with quotes.
  const groups = PLAIN.has(name) ? null : matchGroups(entries);
  if (groups?.anywhere.length && groups.whole.length) {
    for (const [key, title] of GROUPS) box.append(el('span', 'muted small', title), ...groups[key].map(pillOf));
  } else box.append(...entries.map(pillOf));
  if (!entries.length && !editing) box.append(el('span', 'muted small', 'None'));
  if (editing) {
    const input = Object.assign(document.createElement('input'), {className: 'add', placeholder: `${placeholder}, then Enter`, value: typed[name] || ''});
    input.dataset.list = name;
    input.addEventListener('input', () => { typed[name] = input.value; changed(); });
    // A match word can be added as the whole word only (stored \bword\b by lib/strategy-edit.js cleanEdits), never by typing quotes.
    const whole = PLAIN.has(name) ? null : Object.assign(document.createElement('input'), {type: 'checkbox', checked: !!wholeWords[name]});
    whole?.addEventListener('change', () => { wholeWords[name] = whole.checked; });
    input.addEventListener('keydown', event => {
      const text = input.value.trim(), plain = PLAIN.has(name) ? text : text.toLowerCase(), word = whole?.checked ? asWholeWord(plain) : plain;
      if (event.key !== 'Enter' || !plain) return;
      const same = entry => shownWord(entry.label).toLowerCase() === plain.toLowerCase();
      const back = stored.find(entry => edit.remove.includes(entry.fragment) && same(entry));
      if (back) edit.remove = edit.remove.filter(fragment => fragment !== back.fragment);   // removed, then typed again: kept
      else if (!edit.add.some(added => shownWord(added).toLowerCase() === plain.toLowerCase()) && !stored.some(same)) edit.add.push(word);
      event.preventDefault();   // Enter adds a chip; it never saves the strategy
      delete typed[name];
      redrawCards();
      document.querySelector(`.strategy-live input.add[data-list="${name}"]`)?.focus();
    });
    box.append(input);
    if (whole) { const label = el('label', 'check-row muted small'); label.append(whole, el('span', '', 'Add as a whole word only')); box.append(label); }   // the shared checkbox row
  }
  return box;
}
const wholeWords = {};   // the "Whole word only" box per list while editing
// Remote jobs (Search settings "Remote jobs"): a place of its own, or only jobs in your places.
function remoteChoice() {
  const now = strategyState.lastStrategy?.remote_jobs !== false, draft = drafts().targetEdits.remote, chosen = draft ? draft.set === 'Yes' : now;
  if (!isOpen('places')) return el('span', '', remoteWords(chosen, labelsOf('country').slice(0, 1).map(titleCase)));
  const group = el('div', 'segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Remote work');
  for (const [label, yes] of [['Yes', true], ['No', false]]) {
    const button = el('button', yes === chosen ? 'is-active' : '', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(yes === chosen));
    button.addEventListener('click', () => {
      if (yes === now) delete drafts().targetEdits.remote; else drafts().targetEdits.remote = {set: label};
      renderTargets();
    });
    group.append(button);
  }
  return group;
}
// Your level (Search settings "Your level"): postings whose title plainly names another level are skipped; Any keeps them all. Its one home is Goals → Target
// level (owner, 18 Oct 2026: "Goals only"; lib/goal-level.js writes it): shown here read-only, in both modes, with "Change in Goals" (opens Main goals' editor).
const LEVELS = [['', 'Any'], ['junior', 'Junior'], ['mid', 'Mid'], ['senior', 'Senior'], ['lead', 'Lead']];
function levelChoice() {
  const goal = strategyState.lastStrategy?.goals?.seniority, now = goal ? searchLevel(goal) : strategyState.lastStrategy?.level || '', line = el('span', '');
  const change = Object.assign(el('button', 'link', 'Change in Goals'), {type: 'button', title: 'Your level follows your Target level'});
  change.addEventListener('click', () => {
    openCard('goals');
    document.querySelector('#strategy-main-goals .card')?.scrollIntoView({block: 'start'});
  });
  line.append(el('span', '', LEVELS.find(([value]) => value === now)?.[1] || 'Any'), el('span', 'muted small', ' · from your Target level · '), change);
  return line;
}
// The digest's minimum fit score (Search settings "Minimum fit score for the digest"; the engine's default is 50).
function minScoreInput() {
  const now = strategyState.lastStrategy?.digest_min_score ?? 50, shown = drafts().targetEdits.minScore?.set ?? now;
  if (!isOpen('search')) return el('span', '', `${shown} / 100: lower scores stay in your list, out of the digest`);
  const input = Object.assign(document.createElement('input'), {type: 'number', min: 0, max: 100, step: 1, className: 'add', value: shown});
  input.setAttribute('aria-label', 'Minimum fit score for the digest');
  input.addEventListener('change', () => {
    const value = Math.round(Number(input.value));
    if (!Number.isFinite(value) || value < 0 || value > 100 || value === now) delete drafts().targetEdits.minScore;
    else drafts().targetEdits.minScore = {set: value};
    changed();
  });
  return input;
}
const LEADS = {places: 'Where you want to work.', stack: 'Key skills and tools you want in jobs.',
  languages: 'A job that requires one is hidden; one that only prefers it ranks lower.'};
function targetCard([key, glyph, title, lists]) {
  const open = isOpen(key), card = el('section', `card${open ? ' is-editing' : ''}`);
  card.dataset.list = key;
  card.dataset.card = key;
  card.append(cardHeader(key, glyph, CARD_TONE[key] || 'neutral', title, LEADS[key] || '', card));
  if (key === 'places') card.append(...[coverageLine(reloadTargets)].filter(Boolean));   // visible in both modes, Advanced or not
  if (!open) { const read = el('div', 'card-read'); read.append(...VIEWS[key]()); card.append(read); return card; }
  for (const [name, label, placeholder] of shownLists(lists)) {
    // Relocation is a value (Yes / No / Not specified); its places are asked only for Yes, and kept whatever the mode.
    if (name === 'abroad') { card.append(el('p', 'sub', 'Relocation'), relocationChoice(renderTargets)); if (relocationNow(strategyState.lastStrategy, drafts().targetEdits) !== 'yes') continue; }
    const box = listChips(name, placeholder);
    if (name === 'places') { const priority = el('div', 'priority'); priority.append(el('b', '', label), box); card.append(priority); continue; }
    if (label) card.append(el('p', 'sub', label));
    card.append(box);
  }
  if (key === 'places') card.append(el('p', 'sub', 'Remote work'), remoteChoice());
  if (key === 'search') card.append(el('p', 'sub', 'Your level'), levelChoice(), el('p', 'sub', 'Minimum fit score for the digest'), minScoreInput());
  return card;
}
// ---------- The cards as read (not editing): grouped and short; Edit shows every list in full as before ----------
// A row's label with its one-line fact joined to it, in the muted label style (owner's rule, 18 Oct 2026: never a lone line above or below a chip row).
const labelWith = (label, hint) => { const words = el('span', '', label); words.append(el('span', 'muted small', ` · ${hint}`)); return words; };
const savedLabels = name => entriesOf(strategyState.lastStrategy, name).map(entry => entry.label);
// A list as read: as saved, or, while its card holds a draft, as Save will write it (words still typed included), so a closed card's summary shows it.
export function draftEntries(name) {
  const stored = entriesOf(strategyState.lastStrategy, name);
  if (!dirty().has(name)) return stored;
  const edit = withTyped(drafts().targetEdits, drafts().typed, PLAIN, list => entriesOf(strategyState.lastStrategy, list))[name];
  return edit ? editedList(stored, edit) : stored;
}
const labelsOf = name => draftEntries(name).map(entry => entry.label);
// As read: one chip per meaning (strategy-chips.js), whole-word entries apart when a list mixes both kinds, "Did you mean …?" lines under the chips.
// A list with a draft draws its draft words plainly: meanings and typo hints belong to what is saved.
const shownOf = name => meaningLabels(name, savedLabels(name));
function withHints(name, draw) {
  if (dirty().has(name)) return draw(labelsOf(name));
  const parts = shownGroups(entriesOf(strategyState.lastStrategy, name), shownOf(name));
  const hints = typoHints(name, {fix: (entry, suggestion, button) => fixTypo(name, entry, suggestion, button), keep: keepTypo});
  if (parts.length === 1 && !hints.length) return draw(parts[0].labels);
  const box = el('div', 'setting-body');   // the row's own grid: groups and lines sit under each other at its gap
  for (const part of parts) box.append(...(part.title ? [el('span', 'muted small', part.title)] : []), draw(part.labels));
  box.append(...hints);
  return box;
}
// Fix: the misspelt entry out, the suggestion in, saved like an edit (lib/strategy.js editLists). Keep: never flagged again.
async function fixTypo(name, entry, suggestion, button) {
  const stored = entriesOf(strategyState.lastStrategy, name).find(item => item.label === entry);
  const edits = {[name]: {add: [suggestion], remove: stored ? [stored.fragment] : []}};
  const result = await withSaveProgress(words => { button.textContent = words; }, () => sink.editTargets(edits)).catch(error => ({ok: false, error: error.message}));
  if (!result.ok) { toastMessage('Not fixed', result.error || 'Try again.', {card: 'strategy-advanced'}, 'bad'); renderTargets(); return; }
  toastMessage({title: `"${suggestion}" saved ✓`, body: 'Refresh your jobs to search with it.', action: refreshAction, target: {card: 'strategy-advanced'}, tone: 'good'});
  await reloadTargets();
}
async function keepTypo(entry) {
  strategyState.keptTypos = [...(strategyState.keptTypos || []), entry];
  renderTargets();
  await window.pilot.keepTypo(entry).catch(() => null);
}
const VIEWS = {
  // Roomy (mockup 03): one row per setting, icon · label on its own line over the value (a list's chips or one value) (owner, 18 Oct 2026: "Either
  // we're fully inline, either we're fully on the new line"); every divider full width.
  places() {
    const places = labelsOf('places'), regions = labelsOf('country'), rights = labelsOf('rights'), abroad = draftEntries('abroad');
    const mode = relocationNow(strategyState.lastStrategy, drafts().targetEdits);
    const none = words => el('span', 'muted', words);
    // The goal "Work mode" (what you accept) and Remote work (where remote jobs are searched) read as a contradiction side by side (owner, 7 Oct 2026):
    // said on the row's hover, never as a footnote under the card (owner, 18 Oct 2026: no floating footnotes).
    const remote = remoteChoice();
    remote.title = 'Work mode (in Main goals) is the kind of job you accept; Remote work is whether jobs you could do from where you can work count.';
    const preferred = places.length ? withHints('places', chipsOf) : none('None');
    preferred.title = 'Ranked first';
    return [readRows([{icon: 'pin', label: 'Preferred locations', value: preferred},
      {icon: 'globe', label: 'Acceptable locations', value: regions.length ? withHints('country', labels => folded(labels, 10, 'Show all')) : none('None selected')},
      mode === 'yes' && abroad.length ? {icon: 'send', label: 'Places you would relocate to', value: folded(abroad.map(entry => entry.label), 10, 'Show all')}
        : {icon: 'send', label: 'Relocation', value: relocationWords(mode, abroad)},
      {icon: 'building', label: 'Remote work', value: remote},
      {icon: 'shield', label: 'Work rights', value: rights.length ? withHints('rights', chipsOf) : pill('Not set', 'warn', {title: 'Jobs abroad are flagged "visa sponsorship needed"'})}],
    {lined: true})];
  },
  stack() {
    const stack = labelsOf('stack');
    return [readRows([{icon: 'layers', label: 'Key skills', value: stack.length ? withHints('stack', labels => folded(labels, 10, 'Show all')) : el('span', 'muted', 'None')}], {lined: true})];
  },
  search() {
    const row = (glyph, label, name, none) => {
      const draw = labels => (AS_TYPED.has(name) ? chipsOf(labels, false) : folded(labels, 6, 'Show all'));
      const value = !labelsOf(name).length ? el('span', 'muted', none) : name === 'gplaces' ? draw(labelsOf(name).map(placeLabel)) : withHints(name, draw);
      return {icon: glyph, label, value};
    };
    return [readRows([{icon: 'user', label: 'Your level', value: levelChoice()}, {icon: 'target', label: 'Minimum fit score for the digest', value: minScoreInput()},
      row('close', 'Job titles to skip', 'titleSkip', 'None'), row('building', 'Companies to skip', 'skip', 'None'), row('globe', 'Remote jobs: regions to skip', 'remoteSkip', 'None'),
      row('sparkle', 'Words that find new employers', 'finders', 'None'),
      ...(offered('serpapi') ? [row('search', 'Google Jobs searches', 'gqueries', 'None: Google Jobs is not searched'), row('pin', 'Google Jobs places', 'gplaces', 'None')] : [])], {lined: true})];
  },
  languages() {
    const data = strategyState.lastStrategy, {languages, hide, lower} = exclusionGroups({...data, texts: {...data?.texts, languages: labelsOf('languages')}});
    const block = el('div', 'setting-body');
    block.append(languages.length ? chipsOf(languages) : el('span', 'muted', 'None'));
    // Warning colour only for a consequence: the last coverage check counted matching jobs these languages hid (src/coverage.py).
    const listed = new Set(languages.map(language => language.toLowerCase()));
    const hidden = (strategyState.shownVerdict?.languages || []).filter(item => listed.has(String(item.language).toLowerCase())).reduce((sum, item) => sum + (item.count || 0), 0);
    if (hidden) {
      const warn = el('p', 'tone-warn exclusion-warn', icon('alert'));
      warn.append(`Hides ${hidden.toLocaleString('en-US')} job${hidden === 1 ? '' : 's'} that match your roles and places (see Suggestions).`);
      block.append(warn);
    }
    const group = (title, items) => [el('span', 'muted small', title), items.length ? chipsOf(items.map(item => item.label), false) : el('span', 'muted small', 'None')];
    const rules = el('div', 'setting-body');
    rules.append(...group('Hide matching jobs', hide), ...group('Rank them lower', lower));
    return [readRows([{icon: 'globe', label: 'Languages that rule a job out', value: block},
      {icon: 'sliders', label: labelWith('Other exclusions and ranking rules', `${hide.length} hide jobs, ${lower.length} rank${lower.length === 1 ? 's' : ''} lower`), value: rules}], {lined: true})];
  },
};
const reloadTargets = async () => { await loadStrategy(); renderTargets(); };
// Locations beside Job preferences; the rest folded under Advanced search settings (index.html), opened when one of its cards is edited (openCard).
export function renderTargets() {
  shared.coverageActive = coverage(strategyState.lastStrategy).active;   // ⌘K lists "Reset search coverage" only while it is on
  const cards = TARGET_CARDS.map(targetCard);
  $('strategy-locations').replaceChildren(...cards.filter(card => card.dataset.card === 'places'));
  $('strategy-targets').replaceChildren(...inColumns(cards.filter(card => ADVANCED.includes(card.dataset.card))));
  changed();
  if (!strategyState.editing && strategyState.lastStrategy && !inDraft()) loadMeanings(savedLabels, renderTargets);   // once per set of lists; redraws when they come
}
// Main goals, the target cards and Job preferences, from the drafts (strategy-cards.js redraws through this).
export function renderCards() {
  renderMainGoals();
  renderTargets();
  redrawPreferences();
}

export function renderStrategy(data) {
  strategyState.strategyShown = true;
  strategyState.lastStrategy = data;
  show($('strategy-profile-empty'), !!data.profile_empty);
  wireSearchChanged();
  showSearchChanged(shared.state?.settings);   // scores are paused until it is filled (src/ai/score.py unfilled)
  drawOutdated(data.outdated, loadStrategy);   // "N jobs were scored using previous search settings", from the saved settings, never the draft
  if (strategyState.editing) { renderCards(); drawImprove(); return; }   // a fresh read while editing keeps the edits on screen
  $('strategy-insight').classList.remove('is-loading');
  renderCards();
  const level = value => (value >= 70 ? 'good' : value >= 50 ? 'warn' : 'bad');
  // Averages of what the matches scored, not the weights of the score (owner, 7 Oct 2026: "How matches are scored" read as weights).
  $('strategy-score-note').textContent = !data.scored ? 'No scored matches yet: run a search with your AI key.'
    : `Across your ${data.scored} scored match${data.scored === 1 ? '' : 'es'} · Averages, not scoring weights.`;
  // Two different groups: "stale" jobs are queued and get a new score over the next searches; "previous" ones are kept and never queued
  // unless you ask (src/ai/score.py).
  show($('strategy-stale'), !!data.stale);
  $('strategy-stale-text').textContent = data.stale ? `${data.stale} job${data.stale === 1 ? '' : 's'} queued for a new score after your Profile change · up to 60 per search` : '';
  drawImprove();
  $('strategy-scores').replaceChildren(...data.components.map(part => {
    const line = el('div', 'score-bar');
    const track = el('span', 'score-track');
    const fill = el('span', 'score-fill');
    fill.style.width = `${part.value}%`;
    track.append(fill);
    line.append(el('span', 'score-name', part.label), track, el('span', `score-level tone-${level(part.value)}`, `${part.value} / 100`));
    return line;
  }));
  const glance = (glyph, count, text, go, tone = 'neutral') => {
    const button = Object.assign(document.createElement('button'), {type: 'button', className: 'glance-row'});
    button.append(tile(glyph, tone), el('b', '', String(count)), el('span', 'muted', text), el('span', 'glance-arrow', '›'));
    button.addEventListener('click', go);
    return button;
  };
  const jobsBy = kind => () => { openView('jobs'); if (kind) document.querySelector(`[data-stat="${kind}"]`)?.click(); };
  $('strategy-glance').replaceChildren(glance('file', data.counts.matches, 'scored matches', jobsBy('total'), 'info'),
    glance('layers', data.counts.kits, 'application kits ready', jobsBy(''), 'violet'), glance('send', data.counts.sent, 'applications sent', jobsBy('applied'), 'signal'));
  show($('strategy-insight'), !!data.insight);
  if (data.insight) {
    $('strategy-insight-text').textContent = data.insight.action || data.insight.headline;
    $('strategy-insight-open').onclick = () => window.pilot.openExternal(data.insight.url);
  }
}
