// Applyflows fixture questions are explicit; unknown questions fail before any cache or model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {installApplyAnswers} from '../lib/apply-answers.mjs';
import {backboneHarness} from '../lib/backbone-harness.mjs';
import {refusedQuestions} from '../lib/ai-answers.mjs';
import {INSTRUCTIONS as KIND_RULES} from '../../lib/ladder/rung2-sketch.js';
import {DIGEST_INSTRUCTIONS} from '../../lib/ladder/rung3-digest.js';
import {LATE, MISLABELLED} from '../lib/forms.mjs';
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
