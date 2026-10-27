// Profile → Application answers from the owner's mockup (pages/application-answers.js; 17 Oct 2026: "too overwhelming/crowded… Make it look like
// this"): All · Needs review (n) · Saved; a banner instead of the review list; one Saved answers card with a header per section and one line per
// answer; the page's intro never as answers; a row opens in place ("Editing", "Answer as" under Advanced options); the save bar counts changes.
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

async function open(sent = []) {
  globalThis.window.pilot = new Proxy({textOutline: async name => ({ok: true, items: name === 'answers' ? ANSWERS : [], store: 'sqlite', link: null}),
    textEdit: async (name, changes) => { sent.push([name, changes]); return {ok: true, items: ANSWERS}; }}, {get: (all, key) => all[key] || (() => null)});
  const node = globalThis.document.createElement('div');
  node.id = 'answers-body';
  body.replaceChildren(node);
  await (await import('../renderer/pages/application-answers.js')).loadApplicationAnswers();
  return node;
}
const view = (node, key) => node.querySelectorAll('.segmented button').find(button => button.dataset.view === key);
const rowTitles = node => node.querySelectorAll('.qa-saved .qa-row').map(row => row.querySelector('b').textContent);

test('All: the banner, one Saved answers card with a header per section, the intro and notes as small text, never as rows', async () => {
  const node = await open();
  assert.deepEqual(node.querySelectorAll('.segmented button').map(button => button.textContent), ['All', 'Needs review 1', 'Saved']);
  assert.match(node.querySelector('.qa-banner').textContent, /1 question needs your review/);
  assert.deepEqual(node.querySelectorAll('.qa-saved .qa-group').map(head => head.textContent), ['Eligibility', 'Availability and pay']);
  assert.deepEqual(rowTitles(node), ['Authorised to work in Switzerland?', 'Notice period'], 'an unanswered row is in the queue, never "Not set" under Saved (18 Oct 2026)');
  assert.equal(node.querySelectorAll('.qa-saved .qa-intro').length, 2, 'the page intro: small text');
  assert.match(node.querySelector('.qa-saved .qa-note').textContent, /Use the expectation from Your details/);
  assert.equal(node.querySelectorAll('.qa-saved button.qa-add').length, 0, 'no per-row button');
  assert.ok(!node.textContent.includes('❓'));
});

test('Saved shows only set answers; Needs review shows the rows to answer; data refresh retains Needs review', async () => {
  let node = await open();
  view(node, 'saved').listeners.click[0]();
  assert.deepEqual(rowTitles(node), ['Authorised to work in Switzerland?', 'Notice period']);
  view(node, 'review').listeners.click[0]();
  assert.match(node.querySelector('.is-review').textContent, /Will you need sponsorship\?/);
  assert.equal(node.querySelector('.qa-saved'), null);
  node = await open();
  assert.ok(view(node, 'review').classList.contains('is-active'));
  view(node, 'all').click();   // explicitly reset the next scenario's starting view
});

test('a row opens in place: "Editing", Your answer, Answer as under Advanced options; the save bar counts the change', async () => {
  const sent = [];
  const node = await open(sent);
  const row = node.querySelectorAll('.qa-saved .qa-row').find(each => /Notice period/.test(each.textContent));
  row.querySelector('.qa-chevron').listeners.click[0]();
  const opened = node.querySelectorAll('.qa-saved .qa-row').find(each => /Notice period/.test(each.textContent));
  assert.match(opened.textContent, /Editing/);
  const edit = node.querySelector('.qa-edit');
  assert.match(edit.textContent, /Your answer/);
  assert.ok(edit.querySelector('details.qa-advanced select'), 'Answer as is under Advanced options');
  const field = edit.querySelector('input');
  field.value = '2 months';
  field.dispatch('input');
  assert.match((await pageBar(node)).querySelector('.save-bar-title').textContent, /^1 unsaved change in Application answers/);
  assert.equal((await pageBar(node)).querySelector('button.secondary').textContent, 'Discard all');
  await pressSave(node);
  assert.deepEqual(sent.map(([name, changes]) => [name, changes[0].id]), [['answers', 'a1']]);
});
