// A saved answer leaves Needs review immediately, shows Set briefly, and cannot clear a different row or survive its transient lifetime.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';

const body = install();
globalThis.window.pilot = {state: async () => ({settings: {}, secrets: {}})};
const answersBody = globalThis.document.createElement('div');
answersBody.id = 'answers-body';
body.append(answersBody);
const {loadApplicationAnswers} = await import('../renderer/pages/application-answers.js');
const {questionsNow} = await import('../renderer/pages/jobs-questions.js');
const DETAILS = [
  {key: 'contact:first-name', question: 'First name', details: {kind: 'contact', where: 'Your details → Contact details'}},
  {key: 'contact:location', question: 'Current location', details: {kind: 'contact', where: 'Your details → Contact details'}},
];
const saved = (question, key, value = 'Ana') => {
  const event = new Event('question-saved');
  event.detail = {question, key, value, homeName: 'Your details → Contact details', persisted: true};
  globalThis.document.dispatchEvent(event);
};

test('a failed save result never earns Set', async () => {
  globalThis.window.pilot = {textOutline: async () => ({ok: true, items: [{id: 'h', type: 'heading_2', text: 'Saved answers'}], store: 'SQLite'}),
    questionVerdicts: async () => ({ok: true, verdicts: {}})};
  Object.assign(questionsNow(), {list: [...DETAILS], hidden: [], read: true, error: ''});
  await loadApplicationAnswers();
  answersBody.querySelectorAll('.segmented button').find(button => button.dataset.view === 'review').click();
  const event = new Event('question-saved');
  event.detail = {question: 'Current location', key: 'contact:location', value: '', persisted: false};
  globalThis.document.dispatchEvent(event);
  assert.match(answersBody.querySelector('.is-review').textContent, /Current location[\s\S]*Needed by every form/);
  assert.doesNotMatch(answersBody.querySelector('.is-review').textContent, /Set/);
});

test('a persisted Your details answer leaves Needs review immediately, stays Set through refresh and filters, then fades without removing its neighbor', async () => {
  globalThis.window.pilot = {textOutline: async () => ({ok: true, items: [{id: 'h', type: 'heading_2', text: 'Saved answers'}], store: 'SQLite'}),
    questionVerdicts: async () => ({ok: true, verdicts: {}})};
  Object.assign(questionsNow(), {list: [...DETAILS], hidden: [], fromDetails: 0, read: true, error: ''});
  await loadApplicationAnswers();
  answersBody.querySelectorAll('.segmented button').find(button => button.dataset.view === 'review').click();
  assert.equal(answersBody.querySelector('.is-review').textContent.includes('2 to review'), true);

  saved('First name', 'contact:first-name');
  const review = answersBody.querySelector('.is-review');
  assert.match(review.textContent, /1 to review/, 'the count drops before the queue reread');
  assert.match(review.textContent, /First name[\s\S]*Set/, 'the completed row gives immediate confirmation');
  assert.match(review.textContent, /Current location[\s\S]*Needed by every form/, 'the neighboring question remains open');

  answersBody.querySelectorAll('.segmented button').find(button => button.dataset.view === 'saved').click();
  answersBody.querySelectorAll('.segmented button').find(button => button.dataset.view === 'review').click();
  Object.assign(questionsNow(), {list: [DETAILS[1]]});
  globalThis.document.dispatchEvent(new Event('questions-read'));
  assert.match(answersBody.querySelector('.is-review').textContent, /First name[\s\S]*Set/, 'a slow queue refresh cannot erase the acknowledgement');

  await new Promise(resolve => setTimeout(resolve, 800));
  saved('Current location', 'contact:location', 'Zurich');
  assert.match(answersBody.querySelector('.is-review').textContent, /0 to review/, 'the second successful save updates progress without waiting');
  await new Promise(resolve => setTimeout(resolve, 700));
  const afterFade = answersBody.querySelector('.is-review').textContent;
  assert.doesNotMatch(afterFade, /First name/);
  assert.match(afterFade, /Current location[\s\S]*Set/, 'the first save timer cannot remove the next completed question');
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.doesNotMatch(answersBody.querySelector('.is-review').textContent, /Current location/);
});
