// Settings → Profile → What we learned (was Application answers; owner, 28 Oct 2026: "What we learned about you"; spec
// docs/superpowers/specs/2026-10-28-what-we-learned-design.md): one card, one list, one save bar. A search and All · New (n) · Confirmed (n); New rows are What
// we learned's drawer list itself (pages/jobs-questions.js questionsNow().learned: one count everywhere), each opening the drawer at it; Confirmed rows are the
// answered lines of the answers page, a small header per section, opened in place ("Editing", the answer control of its kind, "Answer as" under Advanced
// options). Why (28 Oct 2026, owner: "Saved answers… doesn't make sense at all. It's getting dropped. Same for [Website-specific questions] since we have
// Form fills"): no Saved answers box and no site rules here; site rules stay in Form knowledge, used by fills. The page's own intro (lines before its first
// heading) is shown small, never as answers. Never the not-answered mark on screen (renderer/answers-model.js). Same on every store: block edits through
// pages/outline-tab.js. Guarded by test/answers-layout.test.js and test/profile-tabs-render.test.js.
import {remembered} from '../view-memory.js';
import {el, pill, toggleOnBar} from '../components.js';
import {icon} from '../icons.js';
import {changeFor, kindChange, lineFor, matches, sections, shown} from '../answers-model.js';
import {profileBar} from './profile-save-bar.js';
import {outlineTab} from './outline-tab.js';
import {isStyle} from './letter-style.js';
import {keyOf} from '../question-filter.js';
import {countText, loadQuestions, questionsNow} from './jobs-questions.js';
import {fromDetailsLine} from '../answered-from-details.js';
import {ASKS} from '../question-nav.js';
import {formatFor, markFor, markOf} from '../question-kind.js';
import {answerControl, kindPicker} from '../question-control.js';
import {input, labelled, select} from './form-controls.js';

const TEXT = 'answers';
const VIEWS = ['all', 'new', 'confirmed'];
const savedView = {review: 'new', saved: 'confirmed'}[remembered('answersView')] || remembered('answersView');   // the names of before 28 Oct 2026
const filters = {query: '', view: VIEWS.includes(savedView) ? savedView : 'all'};
const opened = new Set();   // rows shown open (answer ids, review keys)
const drafts = new Map();   // answer id → the value typed; new questions under `new-<n>`: {section, question, value}
let added = 0, tab = null, keptFormats = {}, queueAsked = false, lastView = null;
document.addEventListener?.('questions-read', () => lastView?.redraw());
const kinds = new Map();   // answer id → the kind the person picked ("Answer as"), written with the question

const valueOf = item => drafts.get(item.id) ?? item.value;
const missing = item => item.open && !item.optional && !valueOf(item);

// The kind a row is answered with: the person's pick, else its mark in the store, else what this Mac kept (a fill's reading, else the AI's one judgment).
const formatOf = item => kinds.get(item.id) || formatFor({marked: item.mark, kept: keptFormats[keyOf(item.question)]});
const sameMark = (a, b) => markOf(a || {}) === markOf(b || {});
function setAnswer(view, item, text) {
  const mark = item.kind === 'note' ? item.mark : markFor(formatOf(item)), markChanged = !sameMark(mark, item.mark);
  if (text === item.value && !markChanged) { drafts.delete(item.id); view.undo(TEXT, changeFor(item, text)); } else { drafts.set(item.id, text); view.change(TEXT, changeFor(item, text, mark)); }
  if (item.kind === 'cell') { if (markChanged) view.change(TEXT, kindChange(item, mark)); else view.undo(TEXT, kindChange(item, mark)); }
}
// One row's answer control and its "Answer as" choice.
function answerField(view, item, placeholder) {
  return answerControl(formatOf(item), valueOf(item), text => setAnswer(view, item, text), {placeholder, ariaLabel: item.question || 'Note'});
}
function kindField(view, item) {
  return kindPicker(formatOf(item).kind, kind => {
    const before = formatOf(item);
    kinds.set(item.id, formatFor({marked: {kind, options: kind === before.kind ? before.options : [], list: kind === before.kind ? before.list : ''}, kept: keptFormats[keyOf(item.question)]}));
    setAnswer(view, item, valueOf(item));
    view.redraw();
  });
}

// One row: chevron · question (and its hint) · its answer or "Not set"; a row that needs an answer keeps "Add answer". Open: "Editing", the answer
// field, and "Answer as" folded under Advanced options (the kind is read from forms or the AI; the picker only corrects it).
function row(view, {key, title, under, value, needs, field, kind = null, optional = false, button = needs, status = null, chip = null, action = 'Add answer', run = null}) {
  const isOpen = opened.has(key);
  const head = el('div', `qa-row${isOpen ? ' is-open' : ''}${button ? '' : ' no-action'}`);
  const toggle = () => { if (isOpen) opened.delete(key); else opened.add(key); view.redraw(); };
  const chevron = Object.assign(el('button', 'link qa-chevron', icon('chevron')), {type: 'button', ariaLabel: isOpen ? 'Close' : 'Open'});
  chevron.classList.add('is-bar-chevron');
  chevron.addEventListener('click', toggle);
  toggleOnBar(head, toggle);
  const words = el('div', 'qa-words');
  words.append(Object.assign(el('b', 'qa-title', title), {title}));   // long questions clamp to two lines (CSS); the whole one on hover and in the open row
  if (under) words.append(el('span', 'muted small', under));
  if (chip && !isOpen) words.append(chip);   // New / Confirmed / Guessed sits under the question: the row grid keeps its columns (it wrapped as a 5th cell)
  head.append(chevron, words, isOpen ? pill('Editing', 'signal') : status && !value ? status : el('span', value ? 'qa-value' : 'qa-value muted', value ? shown(value) : optional ? 'Optional' : 'Not set'));
  if (button) {
    const press = Object.assign(el('button', 'secondary qa-add', action), {type: 'button'});
    press.addEventListener('click', () => (run ? run() : (opened.add(key), view.redraw())));
    head.append(press);
  }
  if (!isOpen) return [head];
  const edit = el('div', 'qa-edit');
  edit.append(labelled('Your answer', field()));
  const advanced = el('details', 'plain qa-advanced');
  advanced.append(el('summary', 'link', 'Advanced options'));
  if (kind) advanced.append(labelled('Answer as', kind()));
  advanced.append(el('p', 'muted small', 'Left empty, it stays not set and forms ask you again.'));
  edit.append(advanced);
  return [head, edit];
}

// Why a drawer row is there (mockup 04, from what the row already holds): an answer to accept, a saved answer to check, or none yet.
const statusOf = row => (row.proposal ? {label: 'Suggested answer', tone: 'signal', action: 'Review', glyph: 'sparkle'}
  : row.details ? {label: ASKS[row.details.kind] || 'Review saved answer', tone: 'info', action: 'Review', glyph: 'info'} : {label: 'Missing answer', tone: 'warn', action: 'Add answer', glyph: 'bang-circle'});
// A status pill leads with its icon (mockup 04), so the kind reads before the words.
const statusPill = (label, tone, glyph) => { const node = pill(label, tone); node.prepend(icon(glyph)); return node; };
// A question saved by a build before 17 Oct 2026 was cut at 120 characters (#1281): said under it, never guessed back.
const cutShort = question => String(question || '').length >= 118 && String(question).length <= 120 && /[\p{L}\p{N}]$/u.test(question);
// A question as a row's title: a cut one ends in "…" (never mid-word with nothing after), and every row that shows it says why (saved and Needs review alike).
const titleOf = question => (cutShort(question) ? `${shown(question)}…` : shown(question));
const cutNote = question => (cutShort(question) ? 'Cut short by an older version' : '');
const openDrawer = start => import('./question-review.js').then(review => review.openQuestionReview({queue: 'learned', start}));
// A section's notes (an instruction for the AI, not an answer: owner, 17 Oct 2026) folded in one row; still on the page and still sent to the AI.
function noteFold(notes) {
  const fold = el('details', 'plain qa-note-fold');
  fold.append(el('summary', 'muted small', `Note for the AI · ${notes.length === 1 ? '1 paragraph' : `${notes.length} paragraphs`}`),
    ...notes.map(note => el('p', 'muted small qa-note', shown(note.value || note.text))));
  return fold;
}
const answerRow = (view, item, chip = null) => row(view, {key: item.id, button: false, chip, title: item.kind === 'note' ? 'Note' : titleOf(item.question),
  under: [item.asked ? `Asked by ${item.asked}` : item.kind === 'note' ? '' : shown(item.hint), item.guess && !drafts.has(item.id) ? 'Unconfirmed: saved as a guess' : '', cutNote(item.question)].filter(Boolean).join(' · '), value: valueOf(item), needs: missing(item), optional: item.optional,
  field: () => (item.kind === 'note' ? input(valueOf(item), text => setAnswer(view, item, text), {placeholder: 'Your answer', ariaLabel: 'Note'}) : answerField(view, item, item.hint ? `e.g. ${shown(item.hint)}` : 'Your answer')),
  kind: item.kind === 'note' ? null : () => kindField(view, item)});

function newQuestion(view, key, list) {
  const draft = drafts.get(key);
  const after = () => (list.find(section => section.title === draft.section) || list[list.length - 1])?.after;
  const sync = () => { view.undo(TEXT, {op: 'insert', key}); if (draft.question.trim() && after()) view.change(TEXT, {op: 'insert', after: after(), key, lines: [lineFor(draft.question, draft.value)]}); };
  const edit = el('div', 'qa-edit is-new form-grid cols-3');
  edit.append(labelled('Question', input(draft.question, value => { draft.question = value; sync(); }, {placeholder: 'As forms ask it'})),
    labelled('Answer', input(draft.value, value => { draft.value = value; sync(); }, {placeholder: 'Left empty: not set'})),
    labelled('Section', select(list.map(section => [section.title, section.title || 'Answers']), draft.section, value => { draft.section = value; sync(); }, 'Section')));
  return edit;
}

// The search and All (n) · New (n) · Confirmed (n).
function toolbar(view, into, counts) {
  const bar = el('div', 'toolbar');
  const search = Object.assign(el('input', ''), {type: 'search', placeholder: 'Search what we learned…', value: filters.query, ariaLabel: 'Search what we learned'});
  search.addEventListener('input', () => { filters.query = search.value; const at = search.selectionStart; view.redraw(); const again = into.querySelector('input[type=search]'); again?.focus(); again?.setSelectionRange(at, at); });
  const box = el('label', 'search-box');
  box.append(icon('search'), search);
  const views = el('div', 'segmented');
  views.setAttribute('role', 'group');
  views.setAttribute('aria-label', 'Show');
  for (const [key, name] of [['all', 'All'], ['new', 'New'], ['confirmed', 'Confirmed']]) {
    const button = Object.assign(el('button', key === filters.view ? 'is-active' : '', name), {type: 'button'});
    button.dataset.view = key;
    if (counts[key]) button.append(' ', pill(String(counts[key]), key === 'new' ? 'info' : 'neutral'));
    button.addEventListener('click', () => { filters.view = key; remembered('answersView', key); wanted = null; view.redraw(); });
    views.append(button);
  }
  bar.append(box, views);
  into.append(bar);
}

function draw(view, into) {
  const all = sections(view.items[TEXT] || []).filter(section => !isStyle(section.title));   // the letter style is the Cover letter tab's (letter-style.js)
  // The page's own intro (the lines before its first heading) explains the page: shown small, never as answers (a page with no heading is all answers).
  const intro = all.length > 1 && !all[0].title ? all[0] : null;
  const list = intro ? all.slice(1) : all;

  // New: What we learned's drawer list itself (one count everywhere: the Jobs card, the tab, the drawer; owner, 28 Oct 2026).
  lastView = view;
  if (!questionsNow().read && !queueAsked) { queueAsked = true; loadQuestions().catch(() => {}); }
  const learned = questionsNow().learned, fromDetails = questionsNow().fromDetails || 0;
  const fresh = learned.filter(each => matches({question: each.question, value: each.details?.line || ''}, {query: filters.query}));
  // Confirmed: the answered lines (an empty optional or unanswered line is neither: forms ask it again, and it is New once a form asks it). Why (28 Oct 2026,
  // spec AC2): a line the AI judged a Your details fact, one job's or consent (questionsNow().notLearned, lib/question-lists.js) is no learning: not listed.
  const notLearned = new Set((questionsNow().notLearned || []).map(keyOf));
  const confirmed = list.map(section => ({section, items: section.items.filter(item => item.kind !== 'note' && valueOf(item) && !missing(item) && !notLearned.has(keyOf(item.question))
    && matches({...item, value: valueOf(item), open: false}, {query: filters.query}))}));
  const confirmedCount = confirmed.reduce((sum, each) => sum + each.items.length, 0);
  toolbar(view, into, {all: learned.length + confirmedCount, new: learned.length, confirmed: confirmedCount});
  for (const key of [...drafts.keys()].filter(k => String(k).startsWith('new-'))) into.append(newQuestion(view, key, list));

  if (filters.view === 'all' && learned.length) {
    const banner = el('div', 'notice qa-banner');
    const go = Object.assign(el('button', 'primary small-btn', 'Check'), {type: 'button', id: 'answers-review-go'});
    go.addEventListener('click', () => openDrawer());   // one review flow, the Jobs card's drawer
    const words = el('span', 'qa-banner-words');   // mockup 04: the icon, the count bold
    words.append(icon('sparkle'), el('b', '', countText.learned(learned.length)));
    banner.append(words, go);
    into.append(banner);
  }

  const box = el('section', 'answer-item qa-section qa-learned');
  if (filters.view !== 'confirmed') {
    for (const each of fresh) {
      const sure = statusOf(each);
      box.append(...row(view, {key: `new:${each.key}`, title: titleOf(each.question), under: [each.company, each.details?.line, cutNote(each.question)].filter(Boolean).join(' · '),
        value: '', needs: true, status: statusPill(sure.label, sure.tone, sure.glyph), chip: pill('New', 'info'), action: sure.action, run: () => openDrawer(each.key)}));
    }
  }
  if (filters.view !== 'new') {
    if (fromDetails) box.append(el('p', 'muted small qa-from-details', `${fromDetailsLine(fromDetails)}: edit them in Your details`));
    if (intro && !filters.query) for (const item of intro.items) box.append(el('p', 'muted small qa-intro', shown(item.question ? `${item.question}: ${item.value}` : item.value || item.text)));
    for (const {section, items} of confirmed) {
      const notes = filters.query ? [] : section.items.filter(item => item.kind === 'note');
      if (!items.length && !notes.length) continue;
      box.append(el('h5', 'qa-group', shown(section.title) || 'Answers'));
      if (notes.length) box.append(noteFold(notes));
      for (const item of items) box.append(...answerRow(view, item, item.guess ? pill('Guessed', 'info') : pill('Confirmed', 'good')));   // a guess is not confirmed (spec: states)
    }
  }
  const shownRows = (filters.view !== 'confirmed' ? fresh.length : 0) + (filters.view !== 'new' ? confirmedCount : 0);
  if (!shownRows) box.append(el('p', 'muted qa-empty', filters.query ? 'Nothing matches this search.'
    : filters.view === 'new' ? 'Nothing to check: forms have every answer they asked for.' : 'Nothing yet. As you apply, what we learn about you shows here.'));
  into.append(box);
}

export function addQuestion() {
  const key = `new-${++added}`;
  const list = sections(tab?.items(TEXT) || []);
  drafts.set(key, {section: list[list.length - 1]?.title || '', question: '', value: ''});
  tab?.redraw();
}
// The question review's "Saved answers" / "View source": the tab opens searched for that answer.
let wanted = null;   // the view a jump named (Confirmed, New), used by the next load instead of All
/** Plan an explicit answer-search jump; omitted view opens All, while data refresh preserves the selected view. */
export function searchAnswers(query = '', view = null) { filters.query = String(query || ''); wanted = view || 'all'; }

export async function loadApplicationAnswers() {
  const node = document.getElementById('answers-body');
  if (!node) return;
  if (!tab || tab.node !== node) {
    tab = {...outlineTab('answers', [TEXT], node, draw, {onReset: () => { drafts.clear(); kinds.clear(); opened.clear(); },
      bar: profileBar(), tab: 'answers', label: 'What we learned'}), node};
  }
  const named = wanted;
  // Why (2026-10-27, owner; views All / New / Confirmed since 28 Oct 2026): refreshing data keeps the selected view; an explicit jump can change it.
  if (VIEWS.includes(named)) { filters.view = named; remembered('answersView', named); }
  await tab.load();
  if (named) { setTimeout(() => { if (wanted === named) wanted = null; }, 2000); node.querySelector('.segmented')?.scrollIntoView?.({block: 'nearest'}); }   // later loads of the same jump keep it
}
