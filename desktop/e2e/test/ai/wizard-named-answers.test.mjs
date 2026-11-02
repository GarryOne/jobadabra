// Wizard answers its AI asks by name or by their schema, never by the request's exact text: beta 18's organize ask, the same ask with moved headings, the CV's transcription.
import Anthropic from '@anthropic-ai/sdk';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {anthropicApi} from '../../../lib/ai/anthropic-api.js';
import {transcribePdf} from '../../../lib/cv.js';
import {storedAnswer} from '../../lib/ai-answers.mjs';
import {startAiProxy} from '../../lib/ai-proxy.mjs';
import {setupBackgroundAnswer} from '../../lib/wizard.mjs';

// Beta 18 (run 41385751055, 2 Nov 2026): #2963 answered the draft with the demo draft, its headings moved, and this ask's destination ids
// (section:profile:L15, heading line numbers) changed; the exact-text cache had never seen it, so wizard went red on its third beta in a row.
const captured = JSON.parse(fs.readFileSync(new URL('../../fixtures/golden/wizard-organize-ask.json', import.meta.url), 'utf8'));
const ask = (body, action = captured.action) => ({url: captured.url, headers: {'content-type': 'application/json', 'x-jp-action': action}, body: JSON.stringify(body)});
// The same ask as a draft one line longer writes it: every heading and line id one line further down.
const shifted = body => JSON.parse(JSON.stringify(body).replace(/:L(\d+)/g, (_, line) => `:L${Number(line) + 1}`));

async function wizardEnv(t) {
  const suite = await import('../../suites/wizard.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-answers-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  // The mode every workflow gives the suite (plan-run.mjs puts aiAnswers in its matrix entry; off when it declares none).
  return {E2E_AI_ANSWERS: suite.aiAnswers || 'off', E2E_SUITE: 'wizard', E2E_ARTIFACTS: dir};
}

test('wizard answers beta 18 organize ask from the stored table, and the same ask with moved headings gets the same answer', async t => {
  const env = await wizardEnv(t);
  assert.notEqual(JSON.stringify(shifted(captured.request)), JSON.stringify(captured.request));
  const first = storedAnswer(ask(captured.request), env);
  assert.ok(first.reply, 'wizard: the organize ask must be answered by its name, before the exact-text cache (beta 18, run 41385751055)');
  assert.deepEqual(JSON.parse(first.reply.content[0].text), {items: []});
  assert.deepEqual(storedAnswer(ask(shifted(captured.request)), env), first);
});

test('wizard names an ask the table has no answer for, before any cache or model', async t => {
  const env = await wizardEnv(t);
  assert.throws(() => storedAnswer(ask(captured.request, 'undeclared_wizard_kind'), env), {code: 'E2E_AI_ANSWER_MISSING', message: /^wizard: undeclared_wizard_kind.*is unkeyable/});
});

// PR-branch run 41388540884 (2 Nov 2026): with the exact-text replay gone, the CV's transcription (x-jp-action tailor, no stored answer) was refused 3 times
// and the first search hung. The app's own call, through a stand-in that may not reach a model, gets the fictional applicant's CV.
test('wizard answers the CV transcription by its schema, through the app\'s own call, with no model reached', async t => {
  const env = await wizardEnv(t), saved = {...process.env};
  Object.assign(process.env, env);
  t.after(() => { for (const name of Object.keys(env)) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; });
  const proxy = await startAiProxy({target: 'http://127.0.0.1:1'}); t.after(() => proxy.close());
  const client = anthropicApi('test', {sdk: new Anthropic({apiKey: 'test', baseURL: proxy.url, maxRetries: 0})});
  await assert.rejects(transcribePdf(Buffer.from('%PDF-1.4'), 'test', client), /E2E_AI_ANSWER_MISSING|503/, 'without the wizard stand-in the ask is refused, never sent on');
  proxy.setCanned(body => setupBackgroundAnswer(body, null));
  const {cv} = await transcribePdf(Buffer.from('%PDF-1.4'), 'test', client);
  const fixture = JSON.parse(fs.readFileSync(new URL('../../fixtures/cv.json', import.meta.url), 'utf8'));
  assert.equal(cv.name, fixture.name);
  assert.deepEqual(cv.jobs.map(job => job.company), fixture.jobs.map(job => job.company));
});
