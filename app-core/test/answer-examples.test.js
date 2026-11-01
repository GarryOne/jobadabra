// The worked examples in the form-answer ask (app-core/src/answer-examples.js) and the real-sized form set that measures them (tools/free-ai-form-asks.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANSWER_EXAMPLES } from '../src/answer-examples.js';
import { answerForm, ANSWER_SCHEMA_FOR_TESTS as schema } from '../src/extension.js';
import { FORMS } from '../../tools/free-ai-form-asks.mjs';
import { realForms } from '../../tools/free-ai-form-cases.mjs';
import { answerProblems } from '../../tools/free-ai-eval-metrics.mjs';

test('the ask carries the examples, and every example answer uses values the schema allows', async () => {
  let seen;
  const client = { messages: { create: async (request) => { seen = request; return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers: [] }) }] }; } } };
  await answerForm({ PROFILE_TEXT: 'x', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '' }, { url: 'https://example.com/j', fields: [{ field: 'a', label: 'Name', type: 'text', required: true }], page_text: '' }, client);
  assert.ok(JSON.stringify(seen.system).includes('Decline to self-identify'));
  const item = schema.properties.answers.items.properties;
  for (const line of ANSWER_EXAMPLES.split('\n').filter((l) => l.includes('{"value"'))) {
    const answer = JSON.parse(line.slice(line.indexOf('{"value"'), line.indexOf('}', line.indexOf('{"value"')) + 1));
    assert.ok(item.category.enum.includes(answer.category), line);
    assert.ok(item.use.enum.includes(answer.use), line);
  }
});

test('every form of the real-sized set is well formed: expected values are options, ids are unique, one field per id', () => {
  assert.ok(FORMS.length >= 50);
  assert.equal(new Set(FORMS.map(([id]) => id)).size, FORMS.length);
  for (const [id, fields] of FORMS) for (const [label, type, options, want] of fields) {
    assert.ok(label && type, id);
    if (options && want.v && !want.within) assert.ok(want.v.some((v) => options.includes(v)), `${id}: no expected value is among the options`);
  }
  const cases = realForms();
  assert.equal(cases.length, FORMS.length);
});

test('scoring follows what reaches the page: a proposal on a legal question is floored, an unchecked box is no answer, a proposal is never "typed"', () => {
  const reply = (...answers) => ({ answers });
  assert.deepEqual(answerProblems(reply({ field: 'f1', value: 'Yes', category: 'legal', use: 'propose' }), { f1: { empty: true, category: 'legal' } }), []);
  assert.deepEqual(answerProblems(reply({ field: 'f1', value: 'unchecked', category: 'legal', use: 'fill' }), { f1: { empty: true, category: 'legal' } }), []);
  assert.equal(answerProblems(reply({ field: 'f1', value: 'Yes', category: 'legal', use: 'fill' }), { f1: { empty: true, category: 'legal' } }).length, 1);
  assert.deepEqual(answerProblems(reply({ field: 'f1', value: 'No', category: 'knockout', use: 'propose' }), { f1: { empty: true } }), []);
  assert.equal(answerProblems(reply({ field: 'f1', value: '', category: 'demographic', use: 'fill' }), { f1: { value: ['Decline'], category: 'demographic' } }).length, 1);
  assert.deepEqual(answerProblems(reply({ field: 'f1', value: 'English && Spanish', category: 'normal', use: 'fill' }), { f1: { value: ['English', 'Spanish'], within: ['English', 'Spanish', 'French'] } }), []);
});

test('the ask says an experience or skill claim the facts do not state is proposed, never typed (17 Oct 2026: "4 years of AWS", "built CI/CD for polyglot pipelines")', async () => {
  let seen;
  const client = { messages: { create: async (request) => { seen = request; return { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify({ eligible: true, eligibility_note: '', answers: [] }) }] }; } } };
  await answerForm({ PROFILE_TEXT: 'x', ANSWERS_TEXT: '', KNOWLEDGE_TEXT: '' }, { url: 'https://example.com/j', fields: [{ field: 'a', label: 'Name', type: 'text', required: true }], page_text: '' }, client);
  const system = JSON.stringify(seen.system);
  assert.ok(system.includes('experience or skill claim that'));
  assert.ok(system.includes('multi-language build pipelines'));
});
