// Applyflows fixture questions are explicit; unknown questions fail before any cache or model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {installApplyAnswers} from '../lib/apply-answers.mjs';
import {backboneHarness} from '../lib/backbone-harness.mjs';
import {answerFor, loadTable, questionOf, refusedQuestions, storedAnswer} from '../lib/ai-answers.mjs';
import {INSTRUCTIONS as KIND_RULES} from '../../lib/ladder/rung2-sketch.js';
import {INSTRUCTIONS as FORM_RULES, STEP_RULE, SUBMIT_RULE, BLOCKED_RULE, BOT_RULE} from '../../lib/form-judge.js';
import {DIGEST_INSTRUCTIONS} from '../../lib/ladder/rung3-digest.js';
import {CHAIN, FORMS, LATE, MISLABELLED} from '../lib/forms.mjs';
import {judge as judgeLearnings} from '../../lib/learnings.js';
import * as suite from '../suites/applyflows.mjs';

const body = (system, text) => ({model: 'fixture', system, messages: [{role: 'user', content: text}]});
const sketch = where => `Address path: ${where}\nControls (type · label):\n(none)`;
const digest = where => `Address path: ${where}\nCandidates (number · kind · position · host · text):\n(none)`;

function handler() {
  let canned = null;
  const ctx = {proxy: {canned: () => canned, setCanned: value => { canned = value; }}};
  installApplyAnswers(ctx);
  return {ctx, answer: request => canned(request)};
}

test('an unknown fixture page is never silently classified as a form', () => {
  const {answer} = handler();
  assert.equal(answer(body(KIND_RULES, sketch('/undeclared-fixture'))), null);
  assert.equal(answer(body('An undeclared question', sketch(MISLABELLED.path))), null);
  assert.equal(JSON.parse(answer(body(KIND_RULES, sketch(MISLABELLED.path)))).kind, 'posting', 'the wrong-kind plant remains explicit');
});

test('every declared journey path has its authored page kind', () => {
  const {answer} = handler();
  for (const [where, kind] of [[CHAIN.stepPath, 'posting'], [FORMS.submitter.autoPath, 'form']]) {
    assert.equal(JSON.parse(answer(body(KIND_RULES, sketch(where))))?.kind, kind, where);
    assert.equal(JSON.parse(answer(body(FORM_RULES + STEP_RULE + SUBMIT_RULE + BLOCKED_RULE + BOT_RULE, sketch(where))))?.answer, 'unsure', where);
  }
});

test('the late empty form has an authored no-control digest answer', () => {
  const {answer} = handler();
  assert.deepEqual(JSON.parse(answer(body(DIGEST_INSTRUCTIONS, digest(LATE.formPath)))),
    {outcome: 'other', verb: 'none', numbers: [], press_kind: '', form_frame: -1, confidence: 1});
  assert.equal(answer(body(DIGEST_INSTRUCTIONS, digest('/undeclared-fixture'))), null);
});

test('fixture journeys refuse to start in off mode before taking any app action', async t => {
  const before = process.env.E2E_AI_ANSWERS;
  process.env.E2E_AI_ANSWERS = 'off';
  t.after(() => { if (before === undefined) delete process.env.E2E_AI_ANSWERS; else process.env.E2E_AI_ANSWERS = before; });
  assert.throws(() => suite.run({}), /applyflows is a backbone suite/);
});

for (const family of ['claude', 'openai']) test(`${family}: unknown page fails at the real proxy seam, before cache or transport`, async t => {
  const h = await backboneHarness(t, 'applyflows', family);
  installApplyAnswers(h);
  const proxy = h.openaiProxy || h.proxy, request = body(KIND_RULES, sketch('/undeclared-fixture'));
  const response = await h.localFetch(`${proxy.url}${family === 'openai' ? '/v1/responses' : '/v1/messages'}`, {
    method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': 'page_kind'},
    body: JSON.stringify(family === 'openai' ? {model: 'fixture', instructions: request.system, input: request.messages} : request)});
  const reply = await response.json();
  assert.equal(response.status, 503);
  assert.equal(reply.error.code, 'E2E_AI_ANSWER_MISSING');
  assert.match(reply.error.message, /undeclared-fixture/);
  assert.equal(refusedQuestions(h.env).length, 1);
  h.assertNoLive();
});

test('both workflow attempts run applyflows with semantic backbone answers', () => {
  const source = fs.readFileSync(new URL('../../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
  const attempts = [...source.matchAll(/E2E_AI_ANSWERS: .*contains\(fromJSON\('([^']+)'\), matrix\.suite\)/g)];
  assert.equal(attempts.length, 2);
  for (const [, suites] of attempts) assert.ok(JSON.parse(suites).includes('applyflows'));
});

// Capture the product's own request: no app, store, account or model is started.
async function learningRequest() {
  let request;
  await judgeLearnings({messages: {create: async body => {
    request = body;
    return {content: [{type: 'text', text: '{"verdicts":[]}'}]};
  }}}, {answers: [{label: 'Why this company?', value: 'Fixture motivation'}]});
  return request;
}

test('the background learning ask has a declared kind answer, not an unknown-question escape', async () => {
  const request = await learningRequest(), table = loadTable();
  const question = questionOf({body: request}, {E2E_AI_ANSWERS: 'backbone'}, table);
  assert.deepEqual(question, {operation: 'app.kind', id: 'learn_from_form'});
  assert.deepEqual(answerFor(question, table), {refuse: 'invalid-key'});
  for (const mode of ['off', 'record']) assert.ok(questionOf({body: request}, {E2E_AI_ANSWERS: mode}, table).unkeyable);
  const missing = structuredClone(table);
  delete missing.kinds.learn_from_form;
  assert.ok(answerFor(question, missing).missing, 'removing the authored refusal must fail');
  assert.ok(questionOf({body: {...request, system: 'An undeclared background question'}}, {}, table).unkeyable);
});

for (const family of ['claude', 'openai']) test(`${family}: known journey and learning asks leave no stored-answer guard failures`, async t => {
  const h = await backboneHarness(t, 'applyflows', family);
  installApplyAnswers(h);
  const proxy = h.openaiProxy || h.proxy, learning = await learningRequest();
  for (const [request, status] of [
    [body(KIND_RULES, sketch(CHAIN.stepPath)), 200],
    [body(KIND_RULES, sketch(FORMS.submitter.autoPath)), 200],
    [learning, 401],
  ]) {
    const payload = family === 'openai' ? {model: 'fixture', instructions: request.system, input: request.messages} : request;
    const response = await h.localFetch(`${proxy.url}${family === 'openai' ? '/v1/responses' : '/v1/messages'}`, {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)});
    assert.equal(response.status, status, await response.text());
  }
  assert.deepEqual(refusedQuestions(h.env), []);
  const table = loadTable();
  delete table.kinds.learn_from_form;
  const file = path.join(h.env.E2E_ARTIFACTS, 'missing-learning.json');
  fs.writeFileSync(file, JSON.stringify(table));
  assert.throws(() => storedAnswer({body: learning}, {...h.env, E2E_AI_ANSWERS_FILE: file}), /E2E_AI_ANSWERS=backbone/);
  h.assertNoLive();
});
