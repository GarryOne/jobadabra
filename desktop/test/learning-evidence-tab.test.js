// What we learned draws each learning's evidence (owner, 28 Oct 2026: "Acme · 26 Oct", max 3 then +N, each opens that Form fill): the fills come from
// Reports' Form fills, the label → learning pairs from the verdict cache (IPC learnedLabels). Fictional fills; no store, no AI.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const fill = (id, company, day, label) => ({id, fields: {company, started: `${day}T09:00:00Z`, data: {fields: [{label}]}}});
const RUNS = [fill('r1', 'Acme', '2026-10-21', 'Travel?'), fill('r2', 'Northwind', '2026-10-26', 'Travel?'), fill('r3', 'Bluefin', '2026-10-24', 'Travel?'),
  fill('r4', 'Lumen', '2026-10-22', 'Travel?'), fill('r5', 'Contoso', '2026-10-27', 'Pets')];
const ITEMS = [{id: 'h', type: 'heading_2', text: 'Learned from forms'}, {id: 'a', type: 'bulleted_list_item', text: 'Willing to travel: Yes, up to 20%'},
  {id: 'b', type: 'bulleted_list_item', text: 'Notice period: 3 months'}];

test('a learning shows its three newest fills as chips, then +N; a learning no fill taught shows its state only', async () => {
  globalThis.window.pilot = new Proxy({textOutline: async name => ({ok: true, items: name === 'answers' ? ITEMS : [], store: 'sqlite', link: null}),
    formFills: async () => ({runs: RUNS}), learnedLabels: async () => ({'travel': 'Willing to travel'})}, {get: (all, key) => all[key] || (() => null)});
  const node = globalThis.document.createElement('div');
  node.id = 'answers-body';
  body.replaceChildren(node);
  await (await import('../renderer/pages/application-answers.js')).loadApplicationAnswers();
  await new Promise(resolve => setTimeout(resolve, 20));   // the fills are read after the page draws
  const rowOf = words => node.querySelectorAll('.qa-learned .qa-row').find(each => each.textContent.includes(words));
  const travel = rowOf('Willing to travel');
  assert.deepEqual(travel.querySelectorAll('.qa-evidence .chip-button').map(each => each.textContent), ['Northwind · 26 Oct', 'Bluefin · 24 Oct', 'Lumen · 22 Oct']);
  assert.match(travel.querySelector('.qa-evidence .chip-tag').textContent, /^\+1$/);
  assert.match(travel.textContent, /Confirmed/, 'the state stays first');
  assert.equal(rowOf('Notice period').querySelectorAll('.qa-evidence').length, 0);
});
