// An answer given for ONE job only (owner, 17 Oct 2026: "Job-specific details stay with this application"): kept as a section of that job's record, on every
// store, one "- question — answer" line each; the shared sample tests/fixtures/stores/job-answers.md reads the same here and in Python (tests/store_contract.py).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { JOB_ANSWERS_SECTION, jobAnswersOf, withJobAnswer, withoutJobAnswer, asKitAnswers } from '../src/job-answers.js';

const SAMPLE = fs.readFileSync(new URL('../../tests/fixtures/stores/job-answers.md', import.meta.url), 'utf8');

test('the shared sample reads into question and answer, however many dashes the text holds', () => {
  const list = jobAnswersOf(SAMPLE);
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { question: 'What is your earliest start date, and are there any constraints we should be aware of?', answer: '1 December 2026; no constraints' });
  assert.deepEqual(list[1], { question: 'Expected annual salary', answer: '95000 CHF' });
  assert.equal(list[2].answer, 'Because the platform team owns reliability end to end — the work I want.', 'only the first dash splits');
});

test('writing keeps the other answers, replaces the same question, and survives a read back', () => {
  let text = withJobAnswer('', 'Notice period', '3 months');
  text = withJobAnswer(text, 'Salary — monthly', '8000 CHF');
  assert.deepEqual(jobAnswersOf(text), [{ question: 'Notice period', answer: '3 months' }, { question: 'Salary - monthly', answer: '8000 CHF' }], 'a dash in a question is kept readable');
  text = withJobAnswer(text, 'notice period', '1 month');
  assert.deepEqual(jobAnswersOf(text).map((each) => each.answer), ['1 month', '8000 CHF']);
  assert.deepEqual(jobAnswersOf(withoutJobAnswer(text, 'Notice period')).map((each) => each.question), ['Salary - monthly']);
  assert.equal(withJobAnswer('', 'A', 'two\nlines'), '- A — two lines', 'an answer is one line');
});

test('what Notion hands back (plain lines, no dash bullet, no bold) reads the same', () => {
  assert.deepEqual(jobAnswersOf('Notice period — 3 months\n\nExpected annual salary — 95000 CHF'), [{ question: 'Notice period', answer: '3 months' }, { question: 'Expected annual salary', answer: '95000 CHF' }]);
  assert.deepEqual(jobAnswersOf('no answers here'), []);
  assert.deepEqual(jobAnswersOf(null), []);
});

test('the fill reads them as drafted answers for this job, ahead of the kit\'s own', () => {
  const kit = asKitAnswers({ answers: [{ field: 'x', question: 'Notice period', answer: 'from the kit' }], cover_letter: 'Hi' }, [{ question: 'Notice period', answer: '1 month' }]);
  assert.equal(kit.answers[0].answer, '1 month');
  assert.equal(kit.answers.length, 1, 'the same question: this job\'s answer replaces the kit\'s');
  assert.equal(kit.cover_letter, 'Hi');
  assert.deepEqual(asKitAnswers(null, [{ question: 'Q', answer: 'A' }]).answers, [{ question: 'Q', answer: 'A' }]);
  assert.equal(asKitAnswers(null, []), null, 'no job answers: nothing changes');
  assert.ok(JOB_ANSWERS_SECTION.includes('this job'));
});
