// The review drawer after an app restart (owner, 17 Oct 2026: "LOADED VERY SLOW. IN 10S"): with questions saved on this computer it opens on them at once
// (the store's walk of the answers page takes seconds), then takes the store's list; with nothing saved it shows a loading card. One store read, not two.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const saved = [{key: 'salary', question: 'What is your salary expectation? (In USD monthly)', company: 'Colonist', format: {kind: 'text', control: 'text', options: []}}];
const fresh = [{key: 'permit', question: 'Do you have a valid permission to work in Switzerland?', company: 'DeepJudge AG', format: {kind: 'yes_no', control: 'yes_no', options: ['Yes', 'No']}}, ...saved];
const disk = new Map();
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

test('no questions saved yet: a loading card until the store answers; the Jobs card and the drawer share one read', async () => {
  const jobs = loadQuestions();
  const opened = review.openQuestionReview({queue: 'learned'});
  await flush();
  assert.equal(reads, 1, 'one store read for both');
  assert.ok($('review-panel').querySelector('.skeleton'), 'a loading card, no question yet');
  release();
  await Promise.all([jobs, opened]);
  assert.match($('review-panel').textContent, /Question 1 of 2/);
  review.closeQuestionReview();
});

