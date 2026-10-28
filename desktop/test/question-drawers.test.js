// The two drawers on screen (owner, 28 Oct 2026; spec docs/superpowers/specs/2026-10-28-what-we-learned-design.md): one count per drawer everywhere (its Jobs
// card, its Profile tab, the drawer's header), each card hidden at zero, the cover letter its own card and never a question, and each drawer's own buttons
// (Fill your details: Skip · Save; What we learned: Later · Confirm / Save change).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
const text = {kind: 'text', control: 'text', options: []};
const DETAILS = [
  {key: 'details:contact:{"field":"email"}', question: 'What is your email address?', format: text, details: {kind: 'contact', where: 'Your details → Contact details', fact: 'Email'}},
  {key: 'details:missing:{"id":"notice"}', question: 'What is your current notice period?', format: text, details: {kind: 'missing', where: 'Your details → Availability', fact: 'Notice period'}},
];
const LEARNED = [
  {key: 'travel', question: 'Willing to travel?', company: 'Helvetia Labs', proposal: 'Yes, up to 20%', coveredBy: 'Travel', format: text},
  {key: 'pronouns', question: 'Pronouns', company: 'Acme Robotics', format: text},
  {key: 'relocate', question: 'Willing to relocate', company: 'Northwind Bank', format: text},
];
const LETTER = {key: 'setup:cover-letter', question: 'Set up your cover letter', priority: 'HIGH PRIORITY', hint: 'Your cover letter is a draft and needs your review and approval.',
  setup: {kind: 'cover-letter', state: 'draft', action: 'Review cover letter'}};
let reply = {details: DETAILS, learned: LEARNED, letter: LETTER, hidden: [], consent: 0};
const ids = ['questions', 'questions-count', 'questions-details', 'questions-error', 'questions-retry', 'questions-review', 'learned', 'learned-count', 'learned-review',
  'letter-setup', 'letter-setup-hint', 'letter-setup-go', 'tab-count-details', 'tab-count-answers', 'review-drawer-layer', 'review-drawer-backdrop', 'review-panel'];
for (const id of ids) { const node = globalThis.document.createElement('div'); node.id = id; body.append(node); }
globalThis.localStorage = {getItem: () => null, setItem: () => {}};
globalThis.window.pilot = new Proxy({
  openQuestions: async () => structuredClone(reply),
  answerQuestion: async () => ({ok: true, homeName: 'What we learned'}),
}, {get: (all, key) => all[key] || (() => null)});
const {loadQuestions} = await import('../renderer/pages/jobs-questions.js');
const review = await import('../renderer/pages/question-review.js');
const $ = id => globalThis.document.getElementById(id);
const count = id => Number(($(id).textContent.match(/\d+/) || ['0'])[0]);

test('one count per drawer: its Jobs card, its Profile tab and the drawer header say the same number', async () => {
  await loadQuestions({force: true});
  assert.equal($('questions-count').textContent, '2 missing');
  assert.equal($('learned-count').textContent, '3 to check');
  assert.equal(count('tab-count-details'), 2);
  assert.equal(count('tab-count-answers'), 3);
  await review.openQuestionReview({queue: 'details'});
  assert.match($('review-panel').textContent, /Fill your details/);
  assert.match($('review-panel').textContent, /Question 1 of 2/);
  await review.openQuestionReview({queue: 'learned'});
  assert.match($('review-panel').textContent, /What we learned/);
  assert.match($('review-panel').textContent, /Question 1 of 3/);
  review.closeQuestionReview();
});

test('the cover letter is its own card, never a row of either drawer', async () => {
  await loadQuestions({force: true});
  assert.equal($('letter-setup').hidden, false);
  assert.equal($('letter-setup-go').textContent, 'Review cover letter');
  assert.match($('letter-setup-hint').textContent, /draft/);
  for (const queue of ['details', 'learned']) {
    await review.openQuestionReview({queue});
    assert.doesNotMatch($('review-panel').textContent, /cover letter/i, queue);
  }
  review.closeQuestionReview();
});

test('each drawer\'s own buttons: Skip · Save for your details; Later · Confirm, then Save change once edited, for what we learned', async () => {
  await review.openQuestionReview({queue: 'details'});
  assert.equal($('review-panel').querySelector('#qr-skip').textContent, 'Skip');
  assert.match($('review-panel').querySelector('#qr-confirm').textContent, /^Save/);
  await review.openQuestionReview({queue: 'learned'});
  assert.equal($('review-panel').querySelector('#qr-skip').textContent, 'Later');
  assert.match($('review-panel').querySelector('#qr-confirm').textContent, /^Confirm/);
  const field = $('review-panel').querySelector('#qr-control');
  field.value = 'Yes, up to 10%';
  field.dispatch('input');
  assert.match($('review-panel').querySelector('#qr-confirm').textContent, /^Save change/);
  review.closeQuestionReview();
});

test('What we learned writes a free-text answer in a textarea, asking for the cases; Your details keeps its field (owner, 28 Oct 2026)', async () => {
  await review.openQuestionReview({queue: 'learned'});
  assert.equal($('review-panel').querySelector('#qr-control').tagName, 'TEXTAREA');
  assert.match($('review-panel').querySelector('.qr-cases').textContent, /different cases.*specific/);
  await review.openQuestionReview({queue: 'details'});
  assert.equal($('review-panel').querySelector('#qr-control').tagName, 'INPUT');
  assert.equal($('review-panel').querySelector('.qr-cases'), null);
  review.closeQuestionReview();
});

// Gitar on #2325: Retry (and the overlay slot's reopen) called the opener with no queue, so What we learned came back as Fill your details.
test('Retry after a failed read reopens the drawer that was open', async () => {
  const good = reply;
  reply = {error: 'The store did not answer', details: [], learned: [], hidden: []};
  await review.openQuestionReview({queue: 'learned', force: true});
  const retry = $('review-panel').querySelectorAll('button').find(button => button.textContent === 'Retry');
  assert.ok(retry, 'the failed read offers Retry');
  reply = good;
  retry.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match($('review-panel').textContent, /What we learned/);
  assert.doesNotMatch($('review-panel').textContent, /Fill your details/);
  review.closeQuestionReview();
});

test('a start key opens the drawer that holds it', async () => {
  await review.openQuestionReview({start: 'pronouns'});
  assert.match($('review-panel').textContent, /What we learned/);
  assert.match($('review-panel').textContent, /Pronouns/);
  review.closeQuestionReview();
});

test('each card hides at zero, and its tab count with it', async () => {
  reply = {details: [], learned: LEARNED.slice(0, 1), letter: null, hidden: [], consent: 0};
  await loadQuestions({force: true});
  assert.equal($('questions').hidden, true);
  assert.equal($('tab-count-details').hidden, true);
  assert.equal($('learned').hidden, false);
  assert.equal($('letter-setup').hidden, true);
  reply = {details: [], learned: [], letter: null, hidden: [], consent: 0};
  await loadQuestions({force: true});
  assert.equal($('learned').hidden, true);
  assert.equal($('tab-count-answers').hidden, true);
});
