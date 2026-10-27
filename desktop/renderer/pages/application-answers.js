// Settings → Profile → Application answers (owner, 16 Oct 2026: Standard answers and Form knowledge merged; 17 Oct 2026: "too crowded… Make it
// look like this", his mockup): one tab, one save bar, two texts. A search and All · Needs review (n) · Saved; on All, one banner "n questions need
// review" instead of the list; Saved answers = one card, a small header per section, one line per answer (question · value), opened in place
// ("Editing", the answer control of its kind, "Answer as" under Advanced options); the page's own intro (lines before its first heading) is shown
// small, never as answers; Website-specific questions folded (pages/website-rules.js). Never the not-answered mark on screen (renderer/answers-model.js).
// Same on every store: block edits through pages/outline-tab.js. Guarded by test/profile-tabs-render.test.js and test/answers-layout.test.js.
import {remembered} from '../view-memory.js';
import {el, pill, toggleOnBar} from '../components.js';
import {icon} from '../icons.js';
import {changeFor, kindChange, lineFor, matches, sections, shown} from '../answers-model.js';
import {profileBar} from './profile-save-bar.js';
import {outlineTab} from './outline-tab.js';
import {isStyle} from './letter-style.js';
import {extrasIn, keyOf, visibleQuestions} from '../question-filter.js';
import {loadQuestions, questionsNow} from './jobs-questions.js';
import {fromDetailsLine} from '../answered-from-details.js';
import {ASKS} from '../question-nav.js';
import {stageAnswer} from '../question-wordings.js';
import {formatFor, markFor, markOf} from '../question-kind.js';
import {answerControl, kindPicker} from '../question-control.js';
import {drawRules, input, labelled, newRule, resetRules, reviewRows, select} from './website-rules.js';

const TEXT = 'answers';
const savedView = remembered('answersView');
const filters = {query: '', view: ['all', 'review', 'saved'].includes(savedView) ? savedView : 'all'};   // view: all | review | saved
const opened = new Set();   // rows shown open (answer ids, review keys)
const drafts = new Map();   // answer id → the value typed; new questions under `new-<n>`: {section, question, value}
let added = 0, tab = null, rulesOpen = false, verdicts = {}, keptFormats = {}, askedFor = '', showHidden = false, queueAsked = false, lastView = null;
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
// row: a Needs review row; its other wordings (row.also) get the same answer (renderer/question-wordings.js).
function answerField(view, item, placeholder, row = null) {
  return answerControl(formatOf(item), valueOf(item), text => (row ? stageAnswer(row, text, each => setAnswer(view, each, text)) : setAnswer(view, item, text)), {placeholder, ariaLabel: item.question || 'Note'});
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
function row(view, {key, title, under, value, needs, field, kind = null, optional = false, button = needs, status = null, action = 'Add answer', run = null}) {
  const isOpen = opened.has(key);
  const head = el('div', `qa-row${isOpen ? ' is-open' : ''}${button ? '' : ' no-action'}`);
  head.dataset.answerKey = key;
  const toggle = () => { if (isOpen) opened.delete(key); else opened.add(key); view.redraw(); };
  const chevron = Object.assign(el('button', 'link qa-chevron', icon('chevron')), {type: 'button', ariaLabel: isOpen ? 'Close' : 'Open'});
  chevron.classList.add('is-bar-chevron');
  chevron.addEventListener('click', toggle);
  toggleOnBar(head, toggle);
  const words = el('div', 'qa-words');
  words.append(Object.assign(el('b', 'qa-title', title), {title}));   // long questions clamp to two lines (CSS); the whole one on hover and in the open row
  if (under) words.append(el('span', 'muted small', under));
  const state = isOpen ? pill('Editing', 'signal') : status && !value ? status : el('span', value ? 'qa-value' : 'qa-value muted', value ? shown(value) : optional ? 'Optional' : 'Not set');
  state.classList.add('qa-status');
  head.append(chevron, words, state);
  if (button) {
    const press = Object.assign(el('button', 'secondary qa-add qa-action', action), {type: 'button'});
    press.addEventListener('click', () => (run ? run() : (opened.add(key), view.redraw())));
    head.append(press);
  } else head.append(el('span', 'qa-action-empty'));
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

function locationTitle(text) { return String(text || '').replace(/^\P{L}+/u, '').replace(/\s+/gu, ' ').trim(); }
const locationPath = text => String(text || '').split('→').map(locationTitle).filter(Boolean).join(' → ');

function destinationFor(where, fact, question, key) {
  const parts = locationPath(where).split(' → ').filter(Boolean);
  if (!parts.length) return null;
  const tabs = [...document.querySelectorAll('[data-profile-tab]')];
  const tab = tabs.find(each => locationTitle(each.textContent) === parts[0]);
  if (tab) {
    if (parts[1]) {
      if (tab.dataset.profileTab === 'answers') return {label: parts.join(' → '), sourcePath: where, tab: 'answers', question: fact || question, view: 'saved'};
      const panel = [...document.querySelectorAll(`[data-profile-panel="${tab.dataset.profileTab}"]`)].find(each =>
        locationTitle([...((each.querySelector('.card-words')?.children) || [])].find(child => child.tagName === 'H3')?.textContent) === parts[1]);
      if (panel?.id) return {label: parts.join(' → '), sourcePath: where, panelId: panel.id, fact, key};
      if (tab.dataset.profileTab !== 'details') return {label: parts.join(' → '), sourcePath: where, tab: tab.dataset.profileTab, question: fact || question};
      return {label: parts.join(' → '), sourcePath: where};
    }
    return {label: parts.join(' → '), sourcePath: where, tab: tab.dataset.profileTab, question: fact || question, view: 'saved'};
  }
  const strategy = document.querySelector('.nav[data-view="strategy"]');
  return strategy && locationTitle(strategy.textContent) === parts[0] ? {label: parts.join(' → '), sourcePath: where, viewName: 'strategy'} : {label: parts.join(' → '), sourcePath: where};
}

function focusFact(panel, destination) {
  if (!panel) return;
  panel.querySelector('button.secondary.small-btn.with-icon')?.click();
  const field = (() => {
    if (panel.id === 'setting-contact' && destination.key) {
      try {
        const ref = JSON.parse(destination.key.slice('details:'.length).split(':').slice(1).join(':'));
        return panel.querySelector(`[data-contact="${ref.field}"]`);
      } catch { return null; }
    }
    if (destination.fact) {
      const row = [...panel.querySelectorAll('.fact-line')].find(each => locationTitle(each.querySelector('span')?.textContent) === locationTitle(destination.fact));
      return row?.querySelector('[data-fact-value]');
    }
    return null;
  })();
  field?.focus();
}

async function openLocation(destination, {key, question, view, into}) {
  if (destination.row) {
    opened.add(key);
    view.redraw();
    into.querySelectorAll('.qa-row').find(each => each.dataset.answerKey === key)?.scrollIntoView?.({block: 'center'});
    return;
  }
  if (destination.panelId) {
    const panel = document.getElementById(destination.panelId);
    document.querySelector(`[data-profile-tab="${panel?.dataset.profilePanel}"]`)?.click();
    setTimeout(() => {
      panel?.scrollIntoView?.({behavior: 'smooth', block: 'start'});
      focusFact(panel, destination);
    }, 80);
    return;
  }
  if (destination.tab === 'answers') {
    searchAnswers(destination.question || question, destination.view || 'saved');
    document.querySelector('[data-profile-tab="answers"]')?.click();
    await loadApplicationAnswers();
    const target = [...into.querySelectorAll('.qa-row')].find(each => locationTitle(each.querySelector('.qa-title')?.getAttribute('title') || each.querySelector('.qa-title')?.textContent) === locationTitle(question));
    if (target) {
      opened.add(target.dataset.answerKey);
      view.redraw();
      into.querySelectorAll('.qa-row').find(each => each.dataset.answerKey === target.dataset.answerKey)?.scrollIntoView?.({block: 'center'});
    }
    return;
  }
  if (destination.tab) document.querySelector(`[data-profile-tab="${destination.tab}"]`)?.click();
  if (destination.viewName) document.querySelector('.nav[data-view="strategy"]')?.click();
}

function addLocationColumns(into, locations, view) {
  for (const section of into.querySelectorAll('.qa-section')) {
    const rows = [...section.querySelectorAll('.qa-row')].filter(each => !each.classList.contains('qa-columns'));
    if (!rows.length) continue;
    for (const rowNode of rows) {
      const key = rowNode.dataset.answerKey;
      const destination = locations.get(key);
      const subtitle = rowNode.querySelector('.qa-words .muted.small');
      if (subtitle && destination?.sourcePath) {
        const parts = subtitle.textContent.split(' · ');
        const rest = parts.filter(part => locationPath(part) !== locationPath(destination.sourcePath));
        if (rest.length !== parts.length) {
          if (rest.length) subtitle.textContent = rest.join(' · '); else subtitle.remove();
        }
      }
      const cell = el('span', 'qa-location');
      const link = destination && (destination.panelId || destination.tab || destination.viewName || destination.row);
      if (link) {
        const anchor = Object.assign(el('a', 'qa-location-link', destination.label), {href: '#'});
        anchor.setAttribute('aria-label', `Open ${destination.label}`);
        anchor.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          openLocation(destination, {key, question: destination.question, view, into}).catch(() => {});
        });
        cell.append(anchor);
      } else cell.append(destination?.label || 'Location not recorded');
      rowNode.insertBefore(cell, rowNode.children[2] || null);
    }
    const header = el('div', 'qa-columns');
    header.setAttribute('aria-hidden', 'true');
    header.append(el('span'), el('span', '', 'Question'), el('span', '', 'Location'), el('span', '', 'Answer'), el('span', '', 'Action'));
    section.insertBefore(header, rows[0]);
  }
}

// Why a queue row is there (mockup 04, from what the row already holds): an answer to accept, a guess to confirm, or none yet.
const statusOf = entry => (entry.proposal ? {label: 'Suggested answer', tone: 'signal', action: 'Review', glyph: 'sparkle'}
  : entry.item.guess ? {label: 'Confirm answer', tone: 'info', action: 'Review', glyph: 'info'} : {label: 'Missing answer', tone: 'warn', action: 'Add answer', glyph: 'bang-circle'});
// A status pill leads with its icon (mockup 04), so the kind reads before the words.
const statusPill = (label, tone, glyph) => { const node = pill(label, tone); node.prepend(icon(glyph)); return node; };
// An answer marked optional in the store, still empty: never urgent, folded apart ("Optional profile fields · N unanswered").
const emptyOptional = item => item.optional && !valueOf(item);
let optionalOpen = false;
function optionalFold(view, items) {
  const fold = el('details', 'plain qa-optional');
  fold.open = optionalOpen || !!filters.query;
  fold.addEventListener('toggle', () => { optionalOpen = fold.open; });
  fold.append(el('summary', 'muted small', `Optional fields · ${items.length} unanswered · not in your review queue`));
  for (const item of items) fold.append(...answerRow(view, item));
  return fold;
}

// A question saved by a build before 17 Oct 2026 was cut at 120 characters (#1281): said under it, never guessed back.
const cutShort = question => String(question || '').length >= 118 && String(question).length <= 120 && /[\p{L}\p{N}]$/u.test(question);
// A question as a row's title: a cut one ends in "…" (never mid-word with nothing after), and every row that shows it says why (saved and Needs review alike).
const titleOf = question => (cutShort(question) ? `${shown(question)}…` : shown(question));
const cutNote = question => (cutShort(question) ? 'Cut short by an older version' : '');
// A section's notes (an instruction for the AI, not an answer: owner, 17 Oct 2026) folded in one row; still on the page and still sent to the AI.
function noteFold(notes) {
  const fold = el('details', 'plain qa-note-fold');
  fold.append(el('summary', 'muted small', `Note for the AI · ${notes.length === 1 ? '1 paragraph' : `${notes.length} paragraphs`}`),
    ...notes.map(note => el('p', 'muted small qa-note', shown(note.value || note.text))));
  return fold;
}
const answerRow = (view, item) => row(view, {key: item.id, button: false, title: item.kind === 'note' ? 'Note' : titleOf(item.question),
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

function card(title, glyph, extra = []) {
  const box = el('section', 'answer-item qa-section'), head = el('div', 'qa-section-head');
  head.append(icon(glyph), el('h4', '', title), ...extra);
  box.append(head);
  return box;
}

// The search and All · Needs review (n) · Saved.
function toolbar(view, into, reviewCount) {
  const bar = el('div', 'toolbar');
  const search = Object.assign(el('input', ''), {type: 'search', placeholder: 'Search answers…', value: filters.query, ariaLabel: 'Search answers and rules'});
  search.addEventListener('input', () => { filters.query = search.value; const at = search.selectionStart; view.redraw(); const again = into.querySelector('input[type=search]'); again?.focus(); again?.setSelectionRange(at, at); });
  const box = el('label', 'search-box');
  box.append(icon('search'), search);
  const views = el('div', 'segmented');
  views.setAttribute('role', 'group');
  views.setAttribute('aria-label', 'Show');
  for (const [key, name] of [['all', 'All'], ['review', 'Needs review'], ['saved', 'Saved']]) {
    const button = Object.assign(el('button', key === filters.view ? 'is-active' : '', name), {type: 'button'});
    button.dataset.view = key;
    if (key === 'review' && reviewCount) button.append(' ', pill(String(reviewCount), 'warn'));
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

  // Needs review: what forms will still ask (an answer not set, a website rule with no value).
  const candidates = list.flatMap(section => section.items.filter(item => item.open && !item.optional && !drafts.has(item.id) && matches(item, {query: filters.query}))
    .map(item => ({item, section})));
  // The same filter as Jobs → Answer once: readable, reusable, not already answered; the rest is "N hidden · show" (nothing deleted). The AI's verdicts are asked once per set of questions.
  const labels = candidates.map(each => each.item.question), signature = labels.join('\n');
  if (labels.length && signature !== askedFor) {
    askedFor = signature;
    const unmarked = candidates.filter(each => !each.item.mark?.kind).map(each => each.item.question);
    Promise.resolve(window.pilot.questionVerdicts(labels, unmarked)).then(result => { if (result?.ok) { verdicts = {...verdicts, ...result.verdicts}; keptFormats = {...keptFormats, ...(result.formats || {})}; view.redraw(); } }).catch(() => {});
  }
  const {shown: shownRows, hidden: hiddenRows, fromDetails} = visibleQuestions(candidates.map(each => ({...each, question: each.item.question})), verdicts);
  const ruleRows = reviewRows(view, filters.query).filter(each => !each.value);
  // ONE queue for the banner, the Needs review count and its rows (owner, 18 Oct 2026: the filter said 6, the banner 5): the questions forms still ask and
  // Your details' unclear items, as the review drawer walks them. Website rules with no value are listed apart, under their own count.
  lastView = view;
  if (!questionsNow().read && !queueAsked) { queueAsked = true; loadQuestions().catch(() => {}); }
  const extraRows = extrasIn(questionsNow().list).filter(each => matches({question: each.question, value: each.details?.line || ''}, {query: filters.query}));
  const detailRows = extraRows.filter(each => each.details), setupRows = extraRows.filter(each => each.setup);
  const locations = new Map();
  for (const section of list) for (const item of section.items) {
    if (item.kind !== 'note') locations.set(item.id, {label: `Application answers → ${shown(section.title) || 'Answers'}`, sourcePath: shown(section.title) || 'Answers', row: true, question: item.question});
  }
  for (const entry of shownRows) {
    const section = list.find(each => each.items.some(item => item.id === entry.item.id));
    locations.set(`review:${entry.item.id}`, {label: `Application answers → ${shown(section?.title) || 'Answers'}`, sourcePath: shown(section?.title) || 'Answers', row: true, question: entry.item.question});
  }
  for (const each of detailRows) locations.set(`details:${each.key}`, destinationFor(each.details?.where, each.details?.fact, each.question, each.key));
  for (const each of setupRows) locations.set(each.key, destinationFor(each.details?.where || each.setup?.where, each.details?.fact, each.question, each.key));
  for (const each of ruleRows) locations.set(each.key, {label: 'Application answers → Website-specific questions', row: true, question: each.title});
  const reviewCount = shownRows.length + extraRows.length;

  toolbar(view, into, reviewCount);
  for (const key of [...drafts.keys()].filter(k => String(k).startsWith('new-'))) into.append(newQuestion(view, key, list));

  // The banner: the same queue's count (owner, 17 Oct 2026: "make the count match the review queue"; 18 Oct: "One queue for all").
  const asked = reviewCount;
  if (filters.view === 'all' && asked) {
    const banner = el('div', 'notice qa-banner');
    const go = Object.assign(el('button', 'primary small-btn', 'Review questions'), {type: 'button', id: 'answers-review-go'});
    // The questions are reviewed one at a time in the drawer Jobs opens too (pages/question-review.js): one review flow, two ways in.
    go.addEventListener('click', () => import('./question-review.js').then(review => review.openQuestionReview()));
    const words = el('span', 'qa-banner-words');   // mockup 04: the alert icon, the count bold, a detail beside it (never a line of its own)
    words.append(icon('alert'), el('b', '', `${asked} question${asked === 1 ? '' : 's'} need${asked === 1 ? 's' : ''} your review`), ...(fromDetails.length ? [el('span', 'muted small', fromDetailsLine(fromDetails.length))] : []));
    banner.append(words, go);
    into.append(banner);
  }

  if (filters.view === 'review') {
    const open = showHidden ? [...shownRows, ...hiddenRows] : shownRows;
    const review = card('Needs review', 'alert', [pill(`${reviewCount} to review`, 'warn', {dot: true})]);
    review.classList.add('is-review');
    for (const entry of open) {
      const {item, section} = entry, sure = statusOf(entry);
      review.append(...row(view, {key: `review:${item.id}`, title: titleOf(item.question), under: [item.asked ? `Asked by ${item.asked}` : '', shown(section.title) || 'Answers', cutNote(item.question)].filter(Boolean).join(' · '),
        value: valueOf(item), needs: true, status: statusPill(sure.label, sure.tone, sure.glyph), action: sure.action,
        field: () => answerField(view, item, item.hint ? `e.g. ${shown(item.hint)}` : 'Your answer', entry), kind: () => kindField(view, item)}));
    }
    // Your details' unclear items: answered in the review drawer, at that item (its one review flow).
    for (const each of setupRows) {
      review.append(...row(view, {key: each.key, title: shown(each.question), under: each.hint, value: '', needs: true,
        status: statusPill(each.priority, 'bad', 'alert'), action: each.setup.action,
        run: () => import('./question-review.js').then(page => page.openQuestionReview({start: each.key}))}));
    }
    for (const each of detailRows) {
      review.append(...row(view, {key: `details:${each.key}`, title: shown(each.question), under: [each.details?.where || 'Your details', each.details?.line].filter(Boolean).join(' · '), value: '', needs: true,
        status: statusPill(ASKS[each.details?.kind] || 'Review saved answer', 'info', 'info'), action: 'Review', run: () => import('./question-review.js').then(drawer => drawer.openQuestionReview({start: each.key})), field: () => el('span')}));
    }
    if (ruleRows.length) {
      review.append(el('h5', 'qa-group', `Website rules without an answer · ${ruleRows.length}`));
      for (const each of ruleRows) review.append(...row(view, {...each, needs: true, status: statusPill('Missing answer', 'warn', 'bang-circle')}));
    }
    if (hiddenRows.length) {
      const more = Object.assign(el('button', 'link', showHidden ? 'Hide the others' : `${hiddenRows.length} hidden · show`), {type: 'button', id: 'review-hidden'});
      more.addEventListener('click', () => { showHidden = !showHidden; view.redraw(); });
      review.append(more);
    }
    if (!open.length && !detailRows.length && !ruleRows.length && !hiddenRows.length) review.append(el('p', 'muted qa-empty', 'Nothing to review: forms have every answer they asked for.'));
    into.append(review);
    addLocationColumns(into, locations, view);
    return;
  }

  // Saved answers: one card, a small header per section, one line per answer.
  const saved = card('Saved answers', 'file-text');
  saved.classList.add('qa-saved');
  if (fromDetails.length && filters.view !== 'review') saved.append(el('p', 'muted small qa-from-details', `${fromDetailsLine(fromDetails.length)}: edit them in Your details`));
  if (intro) for (const item of intro.items) saved.append(el('p', 'muted small qa-intro', shown(item.question ? `${item.question}: ${item.value}` : item.value || item.text)));
  // Only answers that are set (owner, 18 Oct 2026: no "Not set" under Saved): an unanswered one is in the queue, behind "N hidden · show", or optional (folded below).
  let any = false;
  const optional = [];
  for (const section of list) {
    const set = section.items.filter(item => item.kind !== 'note' && !missing(item) && matches({...item, value: valueOf(item), open: missing(item)}, {query: filters.query}));
    optional.push(...set.filter(emptyOptional));
    const items = set.filter(item => !emptyOptional(item));
    const notes = filters.query || filters.view === 'review' ? [] : section.items.filter(item => item.kind === 'note');
    if (!items.length && !notes.length) continue;
    any = true;
    saved.append(el('h5', 'qa-group', shown(section.title) || 'Answers'));
    if (notes.length) saved.append(noteFold(notes));
    for (const item of items) saved.append(...answerRow(view, item));
  }
  if (optional.length) saved.append(optionalFold(view, optional));
  if (!any && !optional.length) saved.append(el('p', 'muted qa-empty', list.length ? 'No answer matches this search.' : 'No standard answers yet: they are added as forms ask questions, or with Add answer.'));
  into.append(saved);

  // Website-specific questions, folded: exceptions and what Jobadabra learned from forms.
  const rules = el('details', 'answer-item qa-section kn-rules');
  rules.open = rulesOpen || !!filters.query;
  rules.addEventListener('toggle', () => { rulesOpen = rules.open; });
  const summary = el('summary', 'qa-section-head');
  const words = el('div', 'qa-words');
  const count = el('span', 'muted small');
  words.append(el('h4', '', 'Website-specific questions'), count);
  const add = Object.assign(el('button', 'secondary with-icon', icon('plus')), {type: 'button', id: 'rules-add'});
  add.append('Add rule');
  add.addEventListener('click', event => { event.preventDefault(); newRule(); rulesOpen = true; view.redraw(); });
  summary.append(icon('globe'), words, add, Object.assign(el('span', 'qa-chevron', icon('chevron')), {ariaHidden: 'true'}));
  const inner = el('div', 'kn-body');
  rules.append(summary, inner);
  const learned = drawRules(view, inner, filters.query).count;
  count.textContent = `Review how form questions map to your saved answers · ${learned} learned from forms`;
  into.append(rules);
  addLocationColumns(into, locations, view);
}

export function addQuestion() {
  const key = `new-${++added}`;
  const list = sections(tab?.items(TEXT) || []);
  drafts.set(key, {section: list[list.length - 1]?.title || '', question: '', value: ''});
  tab?.redraw();
}
// The question review's "Manage saved answers" / "View source": the tab opens searched for that answer.
let wanted = null;   // the tab a jump named (Saved, Needs review), used by the next load instead of All
/** Plan an explicit answer-search jump; omitted view opens All, while data refresh preserves the selected view. */
export function searchAnswers(query = '', view = null) { filters.query = String(query || ''); wanted = view || 'all'; }
export function addRule() { newRule(); rulesOpen = true; tab?.redraw(); }

export async function loadApplicationAnswers() {
  const node = document.getElementById('answers-body');
  if (!node) return;
  if (!tab || tab.node !== node) {
    tab = {...outlineTab('answers', [TEXT, 'knowledge'], node, draw, {onReset: () => { drafts.clear(); kinds.clear(); opened.clear(); resetRules(); },
      bar: profileBar(), tab: 'answers', label: 'Application answers'}), node};
  }
  const named = wanted;
  // Why (2026-10-27, owner): refreshing data keeps the selected view; an explicit jump can change it.
  if (['all', 'review', 'saved'].includes(named)) { filters.view = named; remembered('answersView', named); }
  await tab.load();
  if (named) { setTimeout(() => { if (wanted === named) wanted = null; }, 2000); node.querySelector('.segmented')?.scrollIntoView?.({block: 'nearest'}); }   // later loads of the same jump keep it
}
