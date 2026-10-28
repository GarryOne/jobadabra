// Every jump into Profile → What we learned lands on the view it names (owner, 19 Oct 2026: "Manage saved answers doesn't focus the Saved tab"; Saved is
// Confirmed since 28 Oct 2026): the drawer's Saved answers and a question's "covered by" → Confirmed; a plain open → All. One loop over the jumps, asserting the selected tab.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const ITEMS = [{id: 'h1', type: 'heading_2', text: 'Availability'}, {id: 'a1', type: 'bulleted_list_item', text: 'Notice period: 1 month'}, {id: 'a2', type: 'bulleted_list_item', text: 'Start date: ❓'}];
globalThis.window.pilot = new Proxy({textOutline: async () => ({ok: true, items: ITEMS, store: 'sqlite', link: null})}, {get: (all, key) => all[key] || (() => null)});
const answers = await import('../renderer/pages/application-answers.js');

// jump → the tab it must land on (the same calls manageAnswers makes: searchAnswers(query, view), then the tab loads)
const JUMPS = [
  ['Saved answers (drawer header, done state)', () => answers.searchAnswers('', 'confirmed'), 'confirmed'],
  ['a question\'s covered-by link', () => answers.searchAnswers('Notice period', 'confirmed'), 'confirmed'],
  ['a jump naming New', () => answers.searchAnswers('', 'new'), 'new'],
  ['a plain open of the tab', () => answers.searchAnswers(''), 'all'],
];

for (const [name, jump, want] of JUMPS) {
  test(`${name} lands on ${want}`, async () => {
    const node = globalThis.document.createElement('div');
    node.id = 'answers-body';
    body.replaceChildren(node);
    jump();
    await answers.loadApplicationAnswers();
    await answers.loadApplicationAnswers();   // the page loads the tab again right after opening it: the jump still stands
    const active = node.querySelectorAll('.segmented button').find(button => button.classList.contains('is-active'));
    assert.equal(active?.dataset.view, want);
  });
}

test('manageAnswers names the Confirmed view by default', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../renderer/pages/question-review.js', import.meta.url), 'utf8');
  assert.match(src, /manageAnswers\(query = '', view = 'confirmed'\)/);
});
