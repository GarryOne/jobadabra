// A question an older build cut at 120 characters (#1281) reads as cut on every row that shows it (coordinator check of mockup 04, 18 Oct 2026):
// its title ends in "…", never mid-word with nothing after, and its line says "Cut short by an older version", confirmed and New alike (What we learned, 28 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const CUT = 'Are you able to provide professional references and criminal record checks? As a regulated bank, we need to ask for it p';
const ANSWERS = [
  {id: 'h1', type: 'heading_2', text: 'Form-filling time'},
  {id: 'q1', type: 'bulleted_list_item', text: `${CUT.replace('references', 'reference')}: Yes`},
  {id: 'q2', type: 'bulleted_list_item', text: `${CUT}: ❓`},
];

async function open() {
  globalThis.localStorage = {getItem: () => null, setItem: () => {}};
  globalThis.window.pilot = new Proxy({textOutline: async name => ({ok: true, items: name === 'answers' ? ANSWERS : [], store: 'sqlite', link: null}),
    openQuestions: async () => ({details: [], learned: [{key: 'q2', question: CUT}], letter: null, hidden: []})}, {get: (all, key) => all[key] || (() => null)});
  const node = globalThis.document.createElement('div');
  node.id = 'answers-body';
  body.replaceChildren(node, ...['questions', 'questions-count', 'questions-details', 'questions-error', 'questions-retry', 'questions-review'].map(id => Object.assign(globalThis.document.createElement('div'), {id})));
  await (await import('../renderer/pages/application-answers.js')).loadApplicationAnswers();
  await new Promise(resolve => setTimeout(resolve, 20));   // the drawer's read, then the redraw
  return node;
}
const rows = node => node.querySelectorAll('.qa-row').map(row => ({title: row.querySelector('.qa-title').textContent, under: row.querySelector('.qa-words .muted')?.textContent || ''}));

test('class: a cut question ends in "…" and says why, on a confirmed row and on a New row', async () => {
  const node = await open();
  const saved = rows(node).find(row => /reference and/.test(row.title));
  assert.ok(saved, 'the saved row');
  assert.match(saved.title, / it p…$/);
  assert.match(saved.under, /Cut short by an older version/);
  node.querySelectorAll('.segmented button').find(button => button.dataset.view === 'new').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  const queued = rows(globalThis.document.getElementById('answers-body')).find(row => /references and/.test(row.title));
  assert.ok(queued, 'the New row');
  assert.match(queued.title, / it p…$/);
  assert.match(queued.under, /Cut short by an older version/);
});
