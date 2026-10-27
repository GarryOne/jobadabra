// The writing cases for the interview, patterns, form-textarea and CV-tailoring steps (tools/free-ai-writing-cases-interview.mjs, -forms.mjs): five each, built from the app's own prompts, each with a trap for the judge.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {answersCases, tailorCases} from '../../tools/free-ai-writing-cases-forms.mjs';
import {interviewCases, patternsCases} from '../../tools/free-ai-writing-cases-interview.mjs';

const check = (cases, feature) => {
  assert.equal(cases.length, 5);
  assert.equal(new Set(cases.map(item => item.id)).size, 5, 'ids are unique');
  for (const item of cases) {
    assert.equal(item.feature, feature);
    assert.ok(item.trap.length > 60, `${item.id} names what a careless model gets wrong`);
    assert.ok(item.params.system.every(part => typeof part.text === 'string' && part.text.length > 100), `${item.id}: the system prompt is a list of text parts`);
    assert.ok(item.params.messages[0].content.length > 50 && item.params.output_config.format.schema.type === 'object');
  }
};

test('the interview review cases carry the app\'s own prompt and an invented transcript each', () => {
  const cases = interviewCases();
  check(cases, 'interview');
  assert.ok(cases.every(item => item.params.system[0].text.includes('You review job interviews')), 'the real prompt, not a copy');
  assert.ok(cases.every(item => item.params.system[0].text.includes('Alex Morgan')), 'with the demo profile');
});

test('the patterns cases are the app\'s own request over valid reviewed-interview JSON', () => {
  const cases = patternsCases();
  check(cases, 'patterns');
  for (const item of cases) {
    const input = JSON.parse(item.params.messages[0].content.replace('Reviewed interviews (JSON):\n', ''));
    assert.equal(input.interviews_reviewed, Object.values(input.by_round_type).flat().length);
  }
});

// Why (27 Oct 2026, #2277): the form answers come from worker/src, whose package the desktop CI job does not install; that half runs where the worker's packages are.
const workerInstalled = fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../worker/node_modules'));

test('the textarea-form and tailoring cases are captured from the app\'s own calls, never copied', {skip: !workerInstalled && 'worker packages are not installed'}, async () => {
  const answers = await answersCases(), tailors = await tailorCases();
  check(answers, 'answers'); check(tailors, 'tailor');
  assert.ok(answers.every(item => item.params.system[0].text.startsWith('You fill in a job application form')));
  assert.ok(answers.every(item => /textarea/.test(item.params.messages[0].content)), 'every form has a textarea');
  assert.ok(tailors.every(item => item.params.system[0].text.startsWith("You tailor a candidate's CV")));
  assert.ok(tailors.every(item => !('model' in item.params)), 'the eval chooses the model');
});
