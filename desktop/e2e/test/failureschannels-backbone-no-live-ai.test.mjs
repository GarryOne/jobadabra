// Prove failureschannels setup asks use stored answers/refusals and unknown asks never reach live AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {loadTable, questionOf, storedAnswer} from '../lib/ai-answers.mjs';
import {FAILURES, OPENAI_FAILURES} from '../lib/ai-proxy.mjs';
import {backboneHarness} from '../lib/backbone-harness.mjs';
import {modelFetch} from '../lib/model.mjs';

// runParts(channels) starts searches for telegram digest/blocked postings and fake Google mail.
// Those can ask title_triage, enrich, score, visit_relevant, place_triage, decide and mail;
// semantic place/geo/visit items already exist, but channel-specific posting/mail items are not captured.
// CI is the proof of which of those paths run; missing items must fail, never fall through to live AI.
// Shared ensureSetUp saves the applicant strategy and reloads Focus: role/place decide,
// profile organization, list meanings and the missing-fact/reuse queue are background reads.
const captured = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/activityfailures-decide.json', import.meta.url), 'utf8'));
const refused = ['contact_asks', 'covered_facts', 'reuse_verdict', 'field_redraft', 'missing_facts_wording', 'question_formats', 'places'];
const empty = {answer_home: {items: []}, organize_lines: {items: []}, list_meanings: {lists: []}};
const table = loadTable(new URL('../fixtures/golden/ai-answers.json', import.meta.url));
const request = (action, body = {model: 'test', messages: [{role: 'user', content: 'Setup background read'}]}) => ({
  method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': action}, body: JSON.stringify(body),
});

for (const family of ['claude', 'openai']) test(`failureschannels setup answers and named refusals stop before live ${family} AI`, async t => {
  const h = await backboneHarness(t, 'failureschannels', family);
  t.after(() => h.assertNoLive());
  for (const kind of [...refused, ...Object.keys(empty)]) {
    const init = request(kind);
    assert.deepEqual(questionOf(init, h.env, table), {operation: 'app.kind', id: kind});
    const found = storedAnswer(init, h.env);
    if (refused.includes(kind)) {
      assert.deepEqual(found, {refuse: 'invalid-key'});
      await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), /invalid-key/);
    } else {
      assert.deepEqual(JSON.parse(found.reply.content[0].text), empty[kind]);
      assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), found.reply);
    }
    const url = family === 'openai' ? `${h.openaiProxy.url}/v1/responses` : `${h.proxy.url}/v1/messages`;
    const body = family === 'openai' ? {model: 'test', input: 'Setup background read', prompt_cache_key: `job-pilotto-${kind}`} : undefined;
    const response = await h.localFetch(url, request(kind, body));
    assert.equal(response.status, found.refuse ? 401 : 200, kind);
    const data = await response.json();
    if (found.refuse) assert.equal(data.error.type, (family === 'openai' ? OPENAI_FAILURES : FAILURES)['invalid-key'].type);
    else assert.deepEqual(JSON.parse(family === 'openai' ? data.output[0].content[0].text : data.content[0].text), empty[kind]);
  }
});

test('failureschannels seeded metro and role decisions retain the existing stored item answers', async t => {
  const h = await backboneHarness(t, 'failureschannels');
  t.after(() => h.assertNoLive());
  for (const body of [captured.request, ...captured.requests]) {
    const init = request('decide', body), question = questionOf(init, h.env, table);
    assert.equal(question.operation, 'app.decide');
    assert.ok(question.items.length);
    const expected = {results: question.items.map(item => {
      const row = table.items['app.decide'][item.key];
      assert.equal(row.text, item.text);
      return {index: item.index, answer: row.answer};
    })};
    assert.deepEqual(JSON.parse(storedAnswer(init, h.env).reply.content[0].text), expected);
    assert.deepEqual(JSON.parse((await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json()).content[0].text), expected);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse((await response.json()).content[0].text), expected);
  }
});

for (const family of ['claude', 'openai']) test(`failureschannels names an undeclared ask before any live ${family} transport`, async t => {
  const h = await backboneHarness(t, 'failureschannels', family), init = request('undeclared_failureschannels_kind');
  t.after(() => h.assertNoLive());
  const missing = {code: 'E2E_AI_ANSWER_MISSING', message: /failureschannels: undeclared_failureschannels_kind.*is unkeyable/};
  assert.throws(() => storedAnswer(init, h.env), missing);
  await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), missing);
  const url = family === 'openai' ? `${h.openaiProxy.url}/v1/responses` : `${h.proxy.url}/v1/messages`;
  const response = await h.localFetch(url, init);
  assert.equal(response.status, 503);
  const {error} = await response.json();
  assert.equal(error.code, missing.code); assert.match(error.message, missing.message);
});

test('failureschannels opts into stored answers and the real-AI guard on both workflow attempts', () => {
  const source = fs.readFileSync(new URL('../suites/failureschannels.mjs', import.meta.url), 'utf8');
  assert.match(source, /^export const offlineAi = true;/m);
  assert.match(source, /^export const realAi = false;/m);
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
  const attempts = [...workflow.matchAll(/E2E_AI_ANSWERS: .*contains\(fromJSON\('([^']+)'\), matrix\.suite\)/g)];
  assert.equal(attempts.length, 2);
  for (const [, suites] of attempts) assert.ok(JSON.parse(suites).includes('failureschannels'));
});
