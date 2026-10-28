// (saved-list half; the nothing-saved half is question-review-cold-open.test.js) The review drawer after an app restart (owner, 17 Oct 2026: "LOADED VERY SLOW. IN 10S"): with questions saved on this computer it opens on them at once
// (the store's walk of the answers page takes seconds), then takes the store's list; with nothing saved it shows a loading card. One store read, not two.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const saved = [{key: 'salary', question: 'What is your salary expectation? (In USD monthly)', company: 'Colonist', format: {kind: 'text', control: 'text', options: []}}];
const fresh = [{key: 'permit', question: 'Do you have a valid permission to work in Switzerland?', company: 'DeepJudge AG', format: {kind: 'yes_no', control: 'yes_no', options: ['Yes', 'No']}}, ...saved];
const disk = new Map([['questionsCache2', JSON.stringify({details: [], learned: saved, letter: null})]]);
globalThis.localStorage = {getItem: k => disk.get(k) ?? null, setItem: (k, v) => disk.set(k, String(v)), removeItem: k => disk.delete(k)};
for (const id of ['questions', 'questions-count', 'questions-details', 'questions-error', 'questions-retry', 'questions-review', 'questions-manage', 'review-drawer-layer', 'review-drawer-backdrop', 'review-panel']) {
  const node = globalThis.document.createElement('div'); node.id = id; body.append(node);
}
let reads = 0, release = null;
globalThis.window.pilot = new Proxy({
  openQuestions: () => { reads++; return new Promise(resolve => { release = () => resolve({details: [], learned: fresh.map(q => ({...q})), hidden: [], consent: 0}); }); },
}, {get: (all, key) => all[key] || (() => null)});
const {loadQuestions} = await import('../renderer/pages/jobs-questions.js');
const review = await import('../renderer/pages/question-review.js');
const $ = id => globalThis.document.getElementById(id);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('questions saved last time: the drawer shows Question 1 before the store answers, then takes the store\'s list on the same question', async () => {
  const again = {loadQuestions}, drawer = review;
  reads = 0;
  again.loadQuestions();   // Jobs' load at start: shows the saved list, the store read stays open
  await flush();
  const opened = drawer.openQuestionReview({queue: 'learned'});
  await flush();
  assert.match($('review-panel').textContent, /Question 1 of 1/, 'drawn from what is kept, the store has not answered');
  assert.match($('review-panel').textContent, /salary expectation/);
  release();
  await opened;
  assert.equal(reads, 1, 'the drawer joined the read under way');
  assert.match($('review-panel').textContent, /Question 2 of 2/, 'the store\'s list arrived; the question being read stays');
  assert.match($('review-panel').textContent, /salary expectation/);
});
