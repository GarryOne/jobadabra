// Profile → Cover letter → Writing preferences (pages/letter-style.js; owner, 17 Oct 2026: the Cover letter tab is the one home for letters; 28 Oct 2026:
// "Beside the letter"): the rules come from cover-letter/style.json through letterStyle and are saved whole through letterStyleSave, from Profile's one
// save bar; What we learned never lists them.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pressSave} from './page-bar.js';
import {install} from './tiny-dom.js';

const body = install();
const RULES = ['Length: 130–170 words', 'Never mention: salary'];

async function open(rules, sent = []) {
  globalThis.window.pilot = new Proxy({letterStyle: async () => ({ok: true, lines: [...rules]}),
    letterStyleSave: async lines => { sent.push(lines); return {ok: true, lines}; }}, {get: (all, key) => all[key] || (() => null)});
  const card = globalThis.document.createElement('div'), edit = globalThis.document.createElement('button'), node = globalThis.document.createElement('div');
  card.id = 'setting-letter-style'; edit.id = 'letter-style-edit'; node.id = 'letter-style-body';
  card.append(edit, node);
  body.replaceChildren(card);
  await (await import('../renderer/pages/letter-style.js')).loadLetterStyle();
  return {card, node};
}

test('the card reads first: each rule as a column, label over value; the inputs live in the editor', async () => {
  const {node} = await open(RULES);
  const read = node.querySelector('.card-read');
  assert.deepEqual(read.querySelectorAll('.fact-col-label').map(term => term.textContent), ['Length', 'Never mention'], 'one column per rule, label over value (mockup 07)');
  assert.deepEqual(read.querySelectorAll('.fact-col-value').map(value => value.textContent), ['130–170 words', 'salary']);
  assert.deepEqual(node.querySelectorAll('.card-editor input').map(input => input.value), ['130–170 words', 'salary', '']);
  const empty = await open([]);
  assert.match(empty.node.querySelector('.card-read').textContent, /No preferences yet: letters use a short, direct default/);
});

test('an edited rule and a new one are saved whole, beside the letter, from the save bar', async () => {
  const sent = [];
  const {node} = await open(RULES, sent);
  const field = node.querySelectorAll('input').find(input => input.value === 'salary');
  field.value = 'salary, notice period';
  field.dispatch('input');
  const add = node.querySelectorAll('input').find(input => input.ariaLabel === 'Add a style rule');
  add.value = 'Tone: direct';
  add.dispatch('input');
  await pressSave(node);
  assert.deepEqual(sent, [['Length: 130–170 words', 'Never mention: salary, notice period', 'Tone: direct']]);
  assert.deepEqual(node.querySelectorAll('.card-read .fact-col-label').map(term => term.textContent), ['Length', 'Never mention', 'Tone'], 'the card reads what was saved');
});

test('Done closes an unchanged editor; once a rule changes, only the save bar closes it', async () => {
  const {card, node} = await open(RULES);
  card.classList.add('is-editing');
  const done = node.querySelector('.card-done');
  assert.equal(done.hidden, false);
  done.listeners.click[0]();
  assert.ok(!card.classList.contains('is-editing'), 'Done reads again');
  const field = node.querySelectorAll('input')[0];
  field.value = 'short';
  field.dispatch('input');
  assert.equal(node.querySelector('.card-done').hidden, true);
});

test('What we learned never lists the style, even while an old section is still on the answers page', async () => {
  const ANSWERS = [{id: 'h1', type: 'heading_2', text: 'Common questions'}, {id: 'q1', type: 'bulleted_list_item', text: 'Why us? Your mission'},
    {id: 'h2', type: 'heading_2', text: 'Cover letter style'}, {id: 's1', type: 'bulleted_list_item', text: 'Never mention: salary'}];
  globalThis.window.pilot = new Proxy({textOutline: async name => ({ok: true, items: name === 'answers' ? ANSWERS : [], store: 'Notion'})}, {get: (all, key) => all[key] || (() => null)});
  const node = globalThis.document.createElement('div');
  node.id = 'answers-body';
  body.replaceChildren(node);
  await (await import('../renderer/pages/application-answers.js')).loadApplicationAnswers();
  assert.ok(!node.textContent.includes('Cover letter style') && !node.textContent.includes('Never mention'), node.textContent);
});
