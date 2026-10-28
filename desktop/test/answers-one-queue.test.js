// Profile → What we learned counts What we learned's drawer, ONE list (owner, 28 Oct 2026: "one count per drawer everywhere"; 18 Oct 2026, UI review fix 4: the filter
// said 6, the banner 5): the banner, the New filter and the New rows are the drawer's list, never a count of the tab's own; a website rule is never a row here
// (owner, 28 Oct 2026: "It's getting dropped"); an unanswered line never sits under Confirmed as "Not set", nor an empty optional one (pages/application-answers.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
for (const id of ['questions', 'questions-count', 'questions-details', 'questions-error', 'questions-retry', 'questions-review', 'questions-manage']) {
  const node = globalThis.document.createElement('div');
  node.id = id;
  body.append(node);
}
const ANSWERS = [
  {id: 'h1', type: 'heading_2', text: 'Eligibility'},
  {id: 'e1', type: 'bulleted_list_item', text: 'Authorised to work in Switzerland?: Yes, B permit'},
  {id: 'e2', type: 'bulleted_list_item', text: 'Will you need sponsorship?: ❓'},
  {id: 'h2', type: 'heading_2', text: 'Links'},
  {id: 'l1', type: 'bulleted_list_item', text: 'GitHub: ❓ optional'},
];
const KNOWLEDGE = [{id: 'k1', type: 'bulleted_list_item', text: '[careers.example.test · answer] Salutation: by hand'}];
const DETAIL = {key: 'details:notice', question: 'Notice period', details: {kind: 'unclear', where: 'Availability', fact: 'Notice period'}};

globalThis.localStorage = {getItem: () => null, setItem: () => {}};
globalThis.window.pilot = new Proxy({
  textOutline: async name => ({ok: true, items: name === 'answers' ? ANSWERS : KNOWLEDGE, store: 'sqlite', link: null}),
  openQuestions: async () => ({details: [], learned: [{key: 'q1', question: 'Will you need sponsorship?'}, DETAIL], letter: null, hidden: [], consent: 0}),
}, {get: (all, key) => all[key] || (() => null)});

const node = globalThis.document.createElement('div');
node.id = 'answers-body';
body.append(node);
const answers = await import('../renderer/pages/application-answers.js');
await answers.loadApplicationAnswers();
await new Promise(resolve => setTimeout(resolve, 20));   // the queue's own read (jobs-questions.js), then the redraw it triggers
answers.searchAnswers('');
const view = key => node.querySelectorAll('.segmented button').find(button => button.dataset.view === key);
const press = key => view(key).listeners.click[0]();

test('the banner, the New filter and its rows count the drawer\'s list; no website rule is a row', () => {
  press('all');
  const banner = Number(node.querySelector('.qa-banner').textContent.match(/(\d+) to check/)[1]);
  const filter = Number(view('new').textContent.match(/\d+/)[0]);
  press('new');
  const rows = node.querySelectorAll('.qa-learned .qa-row');
  assert.equal(banner, 2, 'one form question + one saved answer to check, as the drawer walks them');
  assert.equal(filter, banner);
  assert.equal(rows.length, banner);
  assert.match(node.textContent, /Make it sure/);
  assert.match(node.textContent, /Missing answer/);
  assert.doesNotMatch(node.textContent, /Website rule|Salutation/);
});

test('Confirmed never lists an unanswered row, nor an empty optional one', () => {
  press('confirmed');
  const titles = node.querySelectorAll('.qa-learned .qa-row').map(row => row.querySelector('b').textContent);
  assert.deepEqual(titles, ['Authorised to work in Switzerland?']);
  assert.ok(!/Not set|GitHub/.test(node.textContent));
});
