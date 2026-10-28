// The review drawer and a date question that also asks about constraints (owner's spec, 17 Oct 2026: "Don't count a date alone as a complete answer to a
// question that also asks about constraints; let the user add constraints or explicitly confirm none"): Confirm waits for one of the two.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {formatFor} from '../renderer/question-kind.js';

const body = install();
const asked = [];
for (const id of ['questions', 'questions-count', 'questions-details', 'questions-error', 'questions-retry', 'questions-review', 'questions-manage', 'review-drawer-layer', 'review-drawer-backdrop', 'review-panel']) {
  const node = globalThis.document.createElement('div'); node.id = id; body.append(node);
}
const START = {key: 'start', question: 'What is your earliest start date, and are there any constraints we should be aware of?', company: 'Acme AG', proposal: '1 December 2026',
  format: formatFor({marked: {kind: 'date', constraints: true}})};
globalThis.window.pilot = new Proxy({
  openQuestions: async () => ({details: [], learned: [{...START}], hidden: []}),
  answerQuestion: async (key, value, mark) => { asked.push([key, value, mark]); return {ok: true, homeName: ''}; },
}, {get: (all, key) => all[key] || (() => null)});
const review = await import('../renderer/pages/question-review.js');
const panel = () => globalThis.document.getElementById('review-panel');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('a suggested date alone cannot be confirmed; "No constraints" completes it and the mark keeps the constraints flag', async () => {
  await review.openQuestionReview({queue: 'learned'});
  const confirm = () => panel().querySelector('#qr-confirm');
  assert.equal(panel().querySelector('#qr-control').dataset.answerKind, 'date');
  assert.equal(confirm().disabled, true, 'a date alone is not complete');
  const [none] = panel().querySelector('#qr-control .segmented').children;
  none.click();
  assert.equal(confirm().disabled, false);
  confirm().click();
  await flush();
  assert.deepEqual(asked, [['start', '1 December 2026; no constraints', {kind: 'date', options: [], constraints: true}]]);
});

test('a date question without the constraints flag is complete with the date alone', async () => {
  const {answerControl} = await import('../renderer/question-control.js');
  const node = answerControl(formatFor({marked: {kind: 'date'}}), '1 December 2026', () => {});
  assert.equal(node.complete, true);
  assert.equal(node.querySelectorAll('.segmented').length, 0);
});
