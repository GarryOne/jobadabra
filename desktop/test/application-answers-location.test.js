// Application answer locations name the canonical home and take the person to its editable row or details card without changing stored answers.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const answerItems = [
  {id: 'language-question', type: 'heading_2', text: 'Languages'},
  {id: 'language-line', type: 'bulleted_list_item', text: 'Which languages do you speak?: English'},
];
globalThis.window.pilot = new Proxy({textOutline: async name => ({ok: true, items: name === 'answers' ? answerItems : [], store: 'sqlite', link: null}),
  questionVerdicts: async () => ({ok: true, verdicts: {} }), state: async () => ({settings: {}, secrets: {}})}, {get: (all, key) => all[key] || (() => null)});
const {questionsNow} = await import('../renderer/pages/jobs-questions.js');
questionsNow().read = true;
questionsNow().list = [];
const {loadApplicationAnswers} = await import('../renderer/pages/application-answers.js');

function tab(name, label) {
  const node = globalThis.document.createElement('button');
  node.dataset.profileTab = name;
  node.append(label);
  node.addEventListener('click', () => { node.dataset.active = 'true'; });
  body.append(node);
  return node;
}
const detailsTab = tab('details', 'Your details');
tab('answers', 'Application answers');
const letterTab = tab('letter', 'Cover letter');
const detailsCard = globalThis.document.createElement('section');
detailsCard.id = 'setting-languages';
detailsCard.dataset.profilePanel = 'details';
const heading = globalThis.document.createElement('h3');
heading.append('Languages');
const words = globalThis.document.createElement('div');
words.className = 'card-words';
words.append(heading);
const edit = globalThis.document.createElement('button');
edit.className = 'card-edit';
edit.addEventListener('click', () => { detailsCard.dataset.editing = 'true'; });
const fact = globalThis.document.createElement('label');
fact.className = 'fact-line';
const factLabel = globalThis.document.createElement('span');
factLabel.append('English');
const field = globalThis.document.createElement('input');
field.dataset.factValue = 'languages';
field.focus = () => { field.dataset.focused = 'true'; };
fact.append(factLabel, field);
detailsCard.append(words, edit, fact);
body.append(detailsCard);

const node = globalThis.document.createElement('div');
node.id = 'answers-body';
body.append(node);
await loadApplicationAnswers();
const activeView = key => node.querySelectorAll('.segmented button').find(button => button.dataset.view === key);
const answerRow = () => node.querySelectorAll('.qa-saved .qa-row').find(row => row.dataset.answerKey === 'language-line');

test('All and Saved keep the source breadcrumb; its link opens the editable row without bubbling into the row toggle', () => {
  for (const view of ['all', 'saved']) {
    activeView(view).click();
    const row = answerRow();
    assert.match(row.querySelector('.qa-location-link').textContent, /^Application answers → Languages$/);
    const link = row.querySelector('.qa-location-link');
    let stopped = false, prevented = false;
    link.listeners.click[0]({preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }});
    assert.ok(prevented && stopped, 'the location link handles navigation without activating the parent row');
    assert.ok(node.querySelectorAll('.qa-edit').length, 'the canonical answer editor is open');
  }
});

test('Needs review links to the matching Your details card and focuses its existing field', async () => {
  questionsNow().list = [{key: 'details:open:{"home":"languages","label":"English"}', question: 'Language level',
    details: {where: 'Your details → 🗣️ Languages', fact: 'English'}}];
  node.querySelectorAll('.segmented button').find(button => button.dataset.view === 'review').click();
  const row = node.querySelectorAll('.qa-section.is-review .qa-row').find(each => each.dataset.answerKey?.startsWith('details:'));
  assert.ok(row.querySelector('.qa-location-link'), node.textContent); assert.match(row.querySelector('.qa-location-link').textContent, /^Your details → Languages$/);
  assert.equal(row.querySelector('.qa-words .muted.small'), null, 'the home appears once in the Location column, not again in the subtitle');
  row.querySelector('.qa-location-link').listeners.click[0]({preventDefault() {}, stopPropagation() {}});
  assert.equal(detailsTab.dataset.active, 'true', 'the existing Profile tab route opens Your details');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(detailsCard.dataset.editing, 'true', 'the canonical details card opens its existing editor');
  assert.equal(field.dataset.focused, 'true', 'the matching fact is focused when it exists');
  assert.equal(field.value, '', 'navigation did not write an answer');
});

test('known Cover letter homes link to that tab; a generic Profile label stays unlinked', () => {
  questionsNow().list = [{key: 'letter-style', question: 'Writing style', details: {where: 'Cover letter', fact: 'Writing preferences'}}];
  activeView('review').click();
  let row = node.querySelectorAll('.qa-section.is-review .qa-row').find(each => each.dataset.answerKey?.startsWith('details:'));
  assert.equal(row.querySelector('.qa-location-link').textContent, 'Cover letter');
  row.querySelector('.qa-location-link').listeners.click[0]({preventDefault() {}, stopPropagation() {}});
  assert.equal(letterTab.dataset.active, 'true', 'the canonical Cover letter tab opens');

  questionsNow().list = [{key: 'unknown-home', question: 'Unknown home', details: {where: 'Profile', fact: 'Unknown'}}];
  activeView('review').click();
  row = node.querySelectorAll('.qa-section.is-review .qa-row').find(each => each.dataset.answerKey?.startsWith('details:'));
  assert.equal(row.querySelector('.qa-location-link'), null, 'a broad, unmatched Profile label is not a dead link');
  assert.equal(row.querySelector('.qa-location').textContent, 'Profile');
});
