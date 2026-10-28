// Profile → What we learned (pages/application-answers.js; owner, 28 Oct 2026: "What we learned about you", no Saved answers box; 17 Oct 2026 mockup: "too
// overwhelming/crowded… Make it look like this"): All · New (n) · Confirmed (n) over ONE list; New rows are What we learned's drawer, Confirmed rows the
// answered lines with a header per section; the page's intro never as answers; a row opens in place ("Editing", "Answer as" under Advanced options).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pageBar, pressSave} from './page-bar.js';
import {install} from './tiny-dom.js';

const body = install();
const ANSWERS = [
  {id: 'n1', type: 'paragraph', text: 'Standard answers for job application forms. The application kit reads this page.'},
  {id: 'n2', type: 'paragraph', text: 'Fields marked ❓ to confirm are blanks or guesses: replace them.'},
  {id: 'h1', type: 'heading_2', text: 'Eligibility'},
  {id: 'e1', type: 'bulleted_list_item', text: 'Authorised to work in Switzerland?: Yes, B permit'},
  {id: 'e2', type: 'bulleted_list_item', text: 'Will you need sponsorship?: ❓'},
  {id: 'h2', type: 'heading_2', text: 'Availability and pay'},
  {id: 'a0', type: 'paragraph', text: 'Use the expectation from Your details when a form asks.'},
  {id: 'a1', type: 'bulleted_list_item', text: 'Notice period: 1 month'},
];

const LEARNED = [{key: 'q1', question: 'Will you need sponsorship?', company: 'Acme Robotics', format: {kind: 'yes_no', control: 'yes_no', options: ['Yes', 'No']}}];
async function open(sent = [], notLearned = []) {
  globalThis.localStorage = {getItem: () => null, setItem: () => {}};
  globalThis.window.pilot = new Proxy({textOutline: async name => ({ok: true, items: name === 'answers' ? ANSWERS : [], store: 'sqlite', link: null}),
    openQuestions: async () => ({details: [], learned: LEARNED, letter: null, hidden: [], consent: 0, notLearned}),
    textEdit: async (name, changes) => { sent.push([name, changes]); return {ok: true, items: ANSWERS}; }}, {get: (all, key) => all[key] || (() => null)});
  const node = globalThis.document.createElement('div');
  node.id = 'answers-body';
  body.replaceChildren(node, ...['questions', 'questions-count', 'questions-details', 'questions-error', 'questions-retry', 'questions-review'].map(id => Object.assign(globalThis.document.createElement('div'), {id})));
  await (await import('../renderer/pages/application-answers.js')).loadApplicationAnswers();
  await new Promise(resolve => setTimeout(resolve, 20));   // the drawer's own read (jobs-questions.js), then the redraw it triggers
  return node;
}
const view = (node, key) => node.querySelectorAll('.segmented button').find(button => button.dataset.view === key);
const rowTitles = node => node.querySelectorAll('.qa-learned .qa-row').map(row => row.querySelector('b').textContent);

test('All: the banner, ONE list (New rows, then Confirmed with a header per section), the intro and notes as small text; no Saved box, no site rules', async () => {
  const node = await open();
  assert.deepEqual(node.querySelectorAll('.segmented button').map(button => button.textContent), ['All 3', 'New 1', 'Confirmed 2']);
  assert.match(node.querySelector('.qa-banner').textContent, /1 to check/);
  assert.equal(node.querySelectorAll('.qa-section').length, 1, 'one list');
  assert.deepEqual(node.querySelectorAll('.qa-learned .qa-group').map(head => head.textContent), ['Eligibility', 'Availability and pay']);
  assert.deepEqual(rowTitles(node), ['Will you need sponsorship?', 'Authorised to work in Switzerland?', 'Notice period']);
  assert.deepEqual(node.querySelectorAll('.qa-learned .qa-row .ui-pill').map(chip => chip.textContent).filter(text => /New|Confirmed/.test(text)), ['New', 'Confirmed', 'Confirmed']);
  assert.equal(node.querySelectorAll('.qa-learned .qa-intro').length, 2, 'the page intro: small text');
  assert.match(node.querySelector('.qa-learned .qa-note').textContent, /Use the expectation from Your details/);
  assert.doesNotMatch(node.textContent, /Saved answers|Website-specific|Add rule/);
  assert.ok(!node.textContent.includes('❓'));
});

test('Confirmed shows only set answers; New shows the drawer\'s rows; data refresh retains New', async () => {
  let node = await open();
  view(node, 'confirmed').listeners.click[0]();
  assert.deepEqual(rowTitles(node), ['Authorised to work in Switzerland?', 'Notice period']);
  view(node, 'new').listeners.click[0]();
  assert.deepEqual(rowTitles(node), ['Will you need sponsorship?']);
  node = await open();
  assert.ok(view(node, 'new').classList.contains('is-active'));
  view(node, 'all').click();   // explicitly reset the next scenario's starting view
});

test('a row opens in place: "Editing", Your answer, Answer as under Advanced options; the save bar counts the change', async () => {
  const sent = [];
  const node = await open(sent);
  const row = node.querySelectorAll('.qa-learned .qa-row').find(each => /Notice period/.test(each.textContent));
  row.querySelector('.qa-chevron').listeners.click[0]();
  const opened = node.querySelectorAll('.qa-learned .qa-row').find(each => /Notice period/.test(each.textContent));
  assert.match(opened.textContent, /Editing/);
  const edit = node.querySelector('.qa-edit');
  assert.match(edit.textContent, /Your answer/);
  assert.ok(edit.querySelector('details.qa-advanced select'), 'Answer as is under Advanced options');
  const field = edit.querySelector('input');
  field.value = '2 months';
  field.dispatch('input');
  assert.match((await pageBar(node)).querySelector('.save-bar-title').textContent, /^1 unsaved change in What we learned/);
  assert.equal((await pageBar(node)).querySelector('button.secondary').textContent, 'Discard all');
  await pressSave(node);
  assert.deepEqual(sent.map(([name, changes]) => [name, changes[0].id]), [['answers', 'a1']]);
});

// Spec AC2 (28 Oct 2026; mac-27 on the first preview: eligibility and notice showed as Confirmed): a saved line the AI judged a Your details fact (or one
// job's, or consent) is no learning: the read names it in notLearned (lib/question-lists.js) and the tab leaves it out, its line kept on the page.
test('a saved line the AI judged a Your details fact is not listed, nor counted', async () => {
  const node = await open([], ['Authorised to work in Switzerland?', 'Notice period']);
  await (await import('../renderer/pages/jobs-questions.js')).loadQuestions({force: true});   // the tab asked once already (an earlier test): a fresh read, as a save does
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(rowTitles(node), ['Will you need sponsorship?']);
  assert.deepEqual(node.querySelectorAll('.segmented button').map(button => button.textContent), ['All 1', 'New 1', 'Confirmed']);
  assert.ok(!node.querySelectorAll('.qa-learned .qa-group').some(head => head.textContent === 'Eligibility'), 'a section with nothing listed has no header');
});
