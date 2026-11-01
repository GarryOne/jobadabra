// The job drawer's Application tab lists this job's questions (renderer/job-drawer/application-questions.js) and now the answers kept for this job only; every state it drew
// before (asked by this job only, asked once, remembered with Undo) stays.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {install} from './tiny-dom.js';
import {JOB_ANSWERS_SECTION} from '../shared/app-core/job-answers.js';
import * as lists from '../lib/question-lists.js';
import {keyOf} from '../renderer/question-filter.js';

install();
const URL_ = 'https://jobs.example.test/acme/1';
const Q = 'Earliest start date';
const settings = {questionVerdicts: {
  [keyOf(Q)]: {question: Q, reuse: 'one_job', jobs: [{url: URL_, company: 'Acme AG'}]},
  [keyOf('Notice period')]: {question: 'Notice period', reuse: 'reusable', jobs: [{url: URL_, company: 'Acme AG'}]},
}};
const storage = {settings: () => settings};
const call = async (_, entity, method, kwargs) => {
  if (method === 'get') return kwargs.url === URL_ ? {id: 'a1', url: URL_} : null;
  if (method === 'section') return kwargs.name === JOB_ANSWERS_SECTION && kwargs.app_id === 'a1' ? `- ${Q} — 1 December 2026\n- Why us? — The platform team.` : null;
  throw new Error(method);
};

test('the job\'s list carries its own answers, also for a question only this answer knows; another job gets none', async () => {
  const list = await lists.jobQuestions(storage, URL_, {call});
  assert.deepEqual(list.map(item => [item.question, item.state, item.answer]), [[Q, 'one_job', '1 December 2026'], ['Notice period', 'once', undefined], ['Why us?', 'one_job', 'The platform team.']]);
  assert.deepEqual(await lists.jobQuestions(storage, 'https://jobs.example.test/other', {call}), []);
});

test('the Application tab shows each answer under its question and keeps the notes and Undo it had', async () => {
  globalThis.window.pilot = {jobQuestions: async () => [
    {question: Q, state: 'one_job', answer: '1 December 2026'}, {question: 'Notice period', state: 'once'}, {question: 'Kündigungsfrist', state: 'remembered'}], jobQuestionOnly: async () => ({ok: true})};
  const {jobQuestionsView} = await import('../renderer/job-drawer/application-questions.js');
  const [box] = jobQuestionsView({url: URL_});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(box.hidden, false);
  assert.match(box.textContent, /Your answer: 1 December 2026/);
  assert.match(box.textContent, /Asked by this job only/);
  assert.match(box.textContent, /Asked once so far/);
  assert.equal(box.querySelectorAll('button').filter(button => button.textContent === 'Undo').length, 1, 'Undo stays on a remembered question');
});
