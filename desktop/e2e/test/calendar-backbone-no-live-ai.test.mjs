// Prove Calendar's captured and setup asks stop at stored answers without a live key or AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {classify} from '../../lib/question-reuse.js';
import {applicantDraft} from '../lib/applicant-seed.mjs';
import {loadTable, questionOf, storedAnswer} from '../lib/ai-answers.mjs';
import {FAILURES, OPENAI_FAILURES} from '../lib/ai-proxy.mjs';
import {backboneHarness} from '../lib/backbone-harness.mjs';
import {modelFetch} from '../lib/model.mjs';

const captured = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/calendar-asks.json', import.meta.url), 'utf8'));
const role = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/wander-decide.json', import.meta.url), 'utf8')).request;
const table = loadTable(new URL('../fixtures/golden/ai-answers.json', import.meta.url));
const refused = ['contact_asks', 'covered_facts', 'reuse_verdict', 'field_redraft', 'missing_facts_wording', 'question_formats', 'places'];
const empty = {answer_home: {items: []}, organize_lines: {items: []}, list_meanings: {lists: []}};
const request = (action, body = {model: 'test', messages: [{role: 'user', content: 'Setup background read'}]}) => ({
  method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': action}, body: JSON.stringify(body),
});
const env = {E2E_AI_ANSWERS: 'backbone', E2E_SUITE: 'calendar'};

test('calendar captured request comes from the real desktop classifier and has a stable declared kind', async () => {
  const content = captured.request.messages[0].content;
  const labels = JSON.parse(content.split('<questions>\n')[1].split('\n</questions>')[0]);
  const facts = JSON.parse(content.split('<facts>\n')[1].split('\n</facts>')[0]).map(label => ({label}));
  const asks = [];
  for (const at of [null, '2026-10-30T01:00:00Z', '2026-11-02T23:59:00Z']) {
    const client = {messages: {create: async (body, {headers}) => {
      asks.push({headers, body});
      assert.deepEqual(questionOf({headers, body}, env, table), {operation: 'app.kind', id: 'reuse_verdict'});
      assert.deepEqual(storedAnswer({headers, body}, env), {refuse: 'invalid-key'});
      return {content: [{type: 'text', text: '{"verdicts":[]}'}]};
    }}};
    // Why (30 Oct 2026, ap): clock-built saved text must not enter the existing kind-only background identity.
    const answered = at ? [{question: 'Next interview', answer: at}] : [];
    assert.equal((await classify({labels, facts, answered, client})).size, 0);
  }
  assert.equal(asks[0].headers['x-jp-action'], captured.action);
  assert.deepEqual(asks[0].body, captured.request);
  assert.notEqual(asks[1].body.messages[0].content, asks[2].body.messages[0].content);
});

for (const family of ['claude', 'openai']) test(`calendar captured and setup kinds resolve at every ${family} seam`, async t => {
  const h = await backboneHarness(t, 'calendar', family);
  const url = family === 'openai' ? `${h.openaiProxy.url}/v1/responses` : `${h.proxy.url}/v1/messages`;
  const asks = [[captured.action, captured.request], ...[...refused, ...Object.keys(empty)].map(kind => [kind])];
  for (const [kind, body] of asks) {
    const init = request(kind, body);
    assert.deepEqual(questionOf(init, h.env, table), {operation: 'app.kind', id: kind});
    const found = storedAnswer(init, h.env);
    if (refused.includes(kind)) {
      assert.deepEqual(found, {refuse: 'invalid-key'});
      await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), /invalid-key/);
    } else {
      assert.deepEqual(JSON.parse(found.reply.content[0].text), empty[kind]);
      assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), found.reply);
    }
    const providerBody = family === 'openai' ? {model: 'test', instructions: body?.system, input: body?.messages || 'Setup read',
      prompt_cache_key: `job-pilotto-${kind}`} : body;
    const proxied = await h.localFetch(url, request(kind, providerBody));
    assert.equal(proxied.status, found.refuse ? 401 : 200, kind);
    const data = await proxied.json();
    if (found.refuse) assert.equal(data.error.message, (family === 'openai' ? OPENAI_FAILURES : FAILURES)['invalid-key'].message);
    else assert.deepEqual(JSON.parse(family === 'openai' ? data.output[0].content[0].text : data.content[0].text), empty[kind]);
  }
  h.assertNoLive();
});

test('calendar setup roles retain their software verdicts at every seam', async t => {
  const h = await backboneHarness(t, 'calendar');
  const titles = applicantDraft().search.target_roles;
  assert.equal(titles.length, 6);
  for (const title of titles) {
    const body = structuredClone(role);
    body.messages[0].content = body.messages[0].content.replace(/### Item 0\n[\s\S]+$/, `### Item 0\n${title}`);
    const init = request('decide', body), question = questionOf(init, h.env, table);
    assert.equal(question.operation, 'app.decide');
    assert.deepEqual(question.items.map(({text}) => text), [title]);
    const expected = {results: [{index: 0, answer: 'software'}]};
    assert.deepEqual(JSON.parse(storedAnswer(init, h.env).reply.content[0].text), expected);
    assert.deepEqual(JSON.parse((await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json()).content[0].text), expected);
    const proxied = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(proxied.status, 200);
    assert.deepEqual(JSON.parse((await proxied.json()).content[0].text), expected);
  }
  h.assertNoLive();
});

test('calendar names an undeclared ask before any live transport', async t => {
  const h = await backboneHarness(t, 'calendar'), init = request('undeclared_calendar_kind');
  const missing = {code: 'E2E_AI_ANSWER_MISSING', message: /calendar: undeclared_calendar_kind.*is unkeyable/};
  assert.throws(() => storedAnswer(init, h.env), missing);
  await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), missing);
  const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
  assert.equal(response.status, 503);
  const {error} = await response.json();
  assert.equal(error.code, missing.code); assert.match(error.message, missing.message);
  h.assertNoLive();
});

test('calendar opts into stored answers and the real-AI guard on both workflow attempts', () => {
  const source = fs.readFileSync(new URL('../suites/calendar.mjs', import.meta.url), 'utf8');
  assert.match(source, /^export const offlineAi = true;/m);
  assert.match(source, /^export const realAi = false;/m);
  // The suite declares it; every workflow reads it from the matrix (plan-run.mjs, tests/test_workflow_ai_answers.py; beta 41078746088: a hand-kept list drifted).
  assert.match(fs.readFileSync(new URL('../suites/calendar.mjs', import.meta.url), 'utf8'), /^export const aiAnswers = 'backbone';/m);
});
