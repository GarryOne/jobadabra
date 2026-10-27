// Profile → Application answers counts ONE review queue (owner, 18 Oct 2026, UI review fix 4: the filter said 6, the banner 5): the banner, the
// "Needs review" filter and the rows under it agree; a Your details item is one of those rows; a website rule with no value is listed apart, under its
// own count; an unanswered row never sits under Saved as "Not set"; an empty optional answer is folded apart, not in the queue (pages/application-answers.js).
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
  openQuestions: async () => ({list: [{key: 'q1', question: 'Will you need sponsorship?'}, DETAIL], hidden: [], consent: 0}),
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

test('the banner, the Needs review filter and its rows count the same queue; website rules are apart', () => {
  press('all');
  const banner = Number(node.querySelector('.qa-banner').textContent.match(/(\d+) question/)[1]);
  const filter = Number(view('review').textContent.match(/\d+/)[0]);
  press('review');
  const review = node.querySelector('.is-review');
  const rows = review.querySelectorAll('.qa-row').filter(row => !/Website rule/.test(row.textContent));
  assert.equal(banner, 2, 'one form question + one Your details item');
  assert.equal(filter, banner);
  assert.equal(rows.length, banner);
  assert.match(review.textContent, /Make it sure/);
  assert.match(review.textContent, /Missing answer/);
  assert.match(review.textContent, /Website rules without an answer · 1/);
  assert.match(review.textContent, /Salutation/);
});

test('Saved never lists an unanswered row; an empty optional answer is folded apart, outside the queue', () => {
  press('all');
  const saved = node.querySelector('.qa-saved');
  const titles = saved.querySelectorAll('.qa-row').filter(row => !row.closest?.('.qa-optional')).map(row => row.querySelector('b').textContent);
  assert.ok(!titles.includes('Will you need sponsorship?'), 'not "Not set" under Saved');
  assert.match(saved.querySelector('.qa-optional summary').textContent, /Optional fields · 1 unanswered/);
  assert.ok(!/Not set/.test(saved.textContent));
});
