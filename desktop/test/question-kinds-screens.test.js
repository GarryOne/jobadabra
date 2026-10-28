// The owner's live examples (17 Oct 2026: "pay attention to the field/question format"; date + amount added the same day) drawn on EVERY screen that lists open questions: each gets the
// control of its kind, never a text box for a choice. A new screen that lists them is added to SCREENS (the class, not the case).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {formatFor, markOf} from '../renderer/question-kind.js';

const body = install();
const EXAMPLES = [
  {question: 'Yes, I live in Switzerland, or am willing to relocate if I currently live elsewhere', mark: {kind: 'yes_no', options: []}, want: 'yes_no'},
  {question: 'Do you have a valid permission to work in Switzerland?', mark: {kind: 'single', options: ['Yes', 'No']}, want: 'single'},
  {question: 'To be eligible to work in Switzerland, please select what applies', mark: {kind: 'single', options: ['Swiss citizen', 'EU/EFTA citizen', 'C permit', 'B permit', 'None of these']}, want: 'single'},
  {question: 'Title', mark: {kind: 'single', options: ['Mr', 'Mrs', 'Ms']}, want: 'single'},
  {question: 'Country/Region of Residence', mark: {kind: 'single', options: [], list: 'countries'}, want: 'single'},
  {question: 'Notice period', mark: null, want: 'text'},
  {question: 'Earliest start date', mark: {kind: 'date', options: []}, want: 'date'},
  {question: 'What is your earliest start date, and are there any constraints we should be aware of?', mark: {kind: 'date', options: [], constraints: true}, want: 'date'},
  {question: 'Expected annual salary', mark: {kind: 'amount', options: []}, want: 'amount'},
];
const kindsIn = node => node.querySelectorAll('[data-answer-kind]').map(control => control.dataset.answerKind);
const isChoice = control => control.tagName === 'SELECT' || control.className.includes('segmented');
const VALUES = {date: 'date', amount: 'number'};   // a value kind is drawn as its own input, never a plain text box
const hasInput = (control, type) => control.querySelectorAll('input').some(input => input.type === type);

const SCREENS = {
  // Jobs' card opens the review drawer (pages/question-review.js): one question at a time; walking the queue draws each one's control.
  'Jobs → Application questions → review drawer': async () => {
    for (const id of ['questions', 'questions-count', 'questions-details', 'questions-error', 'questions-retry', 'questions-review', 'questions-manage', 'review-drawer-layer', 'review-panel']) {
      const node = globalThis.document.createElement('div');
      node.id = id;
      body.append(node);
    }
    const calls = {state: async () => ({settings: {}}), openQuestions: async () => ({details: [], learned: EXAMPLES.map((each, i) => ({key: `b${i}`, question: each.question, company: 'Adnovum', format: formatFor({marked: each.mark})})), hidden: []})};
    globalThis.window.pilot = new Proxy(calls, {get: (all, key) => all[key] || (() => null)});
    const {openQuestionReview} = await import('../renderer/pages/question-review.js');
    await openQuestionReview({queue: 'learned', force: true});
    const seen = globalThis.document.createElement('div');
    const panel = globalThis.document.getElementById('review-panel');
    for (const _ of EXAMPLES) { seen.append(panel.querySelector('[data-answer-kind]')); panel.querySelector('#qr-skip').click(); }
    return seen;
  },
  // Owner, 28 Oct 2026: an open question is answered in the drawer only; the tab edits a confirmed answer in place, with the control of its kind.
  'Profile → What we learned → a confirmed answer opened': async () => {
    const node = globalThis.document.createElement('div');
    node.id = 'answers-body';
    body.append(node);
    const valueOf = each => ({yes_no: 'Yes', single: each.mark?.options[0] || 'Switzerland', date: '2026-12-01', amount: '90000'})[each.want] || 'One month';   // a fictional answer of its kind
    const lines = EXAMPLES.map((each, i) => ({id: `l${i}`, type: 'bulleted_list_item', text: `${each.question}: ${valueOf(each)}${each.mark ? ` ${markOf(each.mark)}` : ''}`}));
    globalThis.window.pilot = new Proxy({textOutline: async name => ({ok: true, items: name === 'answers' ? [{id: 'h', type: 'heading_2', text: 'Asked on forms'}, ...lines] : [], store: 'sqlite', link: null})},
      {get: (all, key) => all[key] || (() => null)});
    const {loadApplicationAnswers} = await import('../renderer/pages/application-answers.js');
    await loadApplicationAnswers();
    node.querySelectorAll('.segmented button').find(button => button.dataset.view === 'confirmed').listeners.click[0]();
    for (let i = 0; i < EXAMPLES.length; i++) {   // each opened row redraws the list: open the next closed one
      const closed = node.querySelectorAll('.qa-learned .qa-row').find(row => !row.classList.contains('is-open'));
      closed?.querySelector('.qa-chevron').listeners.click[0]();
    }
    return node.querySelector('.qa-learned');
  },
};

for (const [name, draw] of Object.entries(SCREENS)) {
  test(`${name}: each example gets the control of its kind`, async () => {
    const node = await draw();
    assert.ok(node, 'the screen drew its list');
    const kinds = kindsIn(node);
    assert.deepEqual([...kinds].sort(), EXAMPLES.map(each => each.want).sort(), kinds.join(', '));
    const controls = node.querySelectorAll('[data-answer-kind]');
    for (const control of controls.filter(each => each.dataset.answerKind !== 'text')) {
      const kind = control.dataset.answerKind;
      if (VALUES[kind]) assert.ok(hasInput(control, VALUES[kind]), `${kind} has its own ${VALUES[kind]} input`);
      else assert.ok(isChoice(control), `${kind} is a choice, not a text box`);
    }
    const constraint = controls.find(each => each.querySelectorAll('.segmented').length && each.dataset.answerKind === 'date');
    assert.ok(constraint, 'a date that asks about constraints offers No constraints / Add constraints');
  });
}
