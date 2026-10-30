// Replay failuresnotion's captured asks and fault/save feed identities without a live AI or key.
import {loadAppModule} from '../lib/app-module.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {answerFor, loadTable, questionOf, storedAnswer} from '../lib/ai-answers.mjs';
import {backboneHarness} from '../lib/backbone-harness.mjs';
import {modelFetch} from '../lib/model.mjs';
import {requestKey} from '../lib/ai-meter.mjs';
const {judge, planOf} = await loadAppModule('profile-move.js');

const answersTableFile = new URL('../fixtures/golden/ai-answers.json', import.meta.url);
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/failuresnotion-asks.json', import.meta.url)));
const captured = fixture.asks;
const request = (action, body) => ({method: 'POST', headers: {'content-type': 'application/json', ...(action ? {'x-jp-action': action} : {})}, body: JSON.stringify(body)});
const score = captured.find(ask => ask.action === 'score').request;
const titles = ['notion rate-limit', 'notion html', 'notion offline', 'save seed'];
const extraScores = titles.map(suffix => {
  const body = structuredClone(score);
  const title = `Senior Site Reliability Engineer, ${suffix} (Site Reliability / Data Analyst)`;
  const location = suffix === 'save seed' ? 'Zurich, Switzerland' : 'Zurich, Switzerland or Amsterdam, Netherlands';
  body.messages[0].content = `Title: ${title}\nCompany: E2E Acme\nLocation: ${location}\nExtracted facts (stage 1): {}\n\nPosting:\n${title}: run production on Kubernetes and AWS with Terraform, SLOs and on-call. Senior level, hybrid in Zurich, English working language.`;
  return {action: 'score', request: body};
});
const asks = [...captured, ...extraScores];
const dataOf = reply => JSON.parse(reply.content[0].text);
const validates = (schema, value) => {
  if (Array.isArray(schema.type)) return schema.type.some(type => validates({...schema, type}, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (schema.required || []).every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key =>
      Object.hasOwn(schema.properties, key) && validates(schema.properties[key], value[key]));
  if (schema.type === 'array') return Array.isArray(value) && value.every(item => validates(schema.items, item));
  return schema.type === 'integer' ? Number.isInteger(value) : typeof value === schema.type;
};

test('failuresnotion authored scores satisfy captured product schemas and preserve a saveable job', () => {
  const table = loadTable(answersTableFile);
  assert.equal(captured.length, 5);
  const keys = asks.filter(ask => ask.action === 'score').map(ask => questionOf(request('', ask.request), {}, table).id);
  assert.deepEqual([...new Set(keys)].sort(), fixture.feedPostings.map(post => post.key).sort());
  for (const ask of asks) {
    const question = questionOf(request(ask.action === 'score' ? '' : ask.action, ask.request), {E2E_AI_ANSWERS: 'backbone'}, table);
    const reply = answerFor(question, table).reply;
    assert.ok(reply, JSON.stringify(question));
    const data = dataOf(reply);
    assert.ok(validates(ask.request.output_config.format.schema, data), JSON.stringify(question));
    if (ask.action !== 'score') { assert.deepEqual(data, {items: []}); continue; }
    assert.ok(data.score >= 70 && data.score <= 100);
    assert.equal(data.components.compensation, null);
    assert.deepEqual(data.basis, {salary_stated: false, level_stated: true, one_job: true});
    assert.equal(data.search.career_change, false);
    assert.ok(data.reason.length <= 90 && data.search.cv_gap.length <= 90);
    for (const value of [data.search.fit, ...Object.values(data.components).filter(value => value !== null)]) assert.ok(value >= 0 && value <= 100);
    assert.ok(data.strengths.length <= 3 && data.gaps.length <= 3);
  }
});

for (const family of ['claude', 'openai']) test(`failuresnotion every captured/fault/save ask resolves at every ${family} seam`, async t => {
  const h = await backboneHarness(t, 'failuresnotion', family);
  for (const ask of asks) {
    const init = request(ask.action === 'score' ? '' : ask.action, ask.request), expected = storedAnswer(init, h.env).reply;
    assert.ok(expected, ask.file || ask.request.messages[0].content);
    assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), expected);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
    if (family === 'openai') {
      const body = {model: 'test', instructions: ask.request.system, input: ask.request.messages,
        text: {format: ask.request.output_config.format}, prompt_cache_key: `job-pilotto-${ask.action}`};
      const response = await h.localFetch(`${h.openaiProxy.url}/v1/responses`, request('', body));
      assert.equal(response.status, 200);
      assert.deepEqual(JSON.parse((await response.json()).output[0].content[0].text), dataOf(expected));
    }
  }
  h.assertNoLive();
});

// Why (30 Oct 2026, ap): af's 3f37144 made feed ids a per-context counter, no longer the clock; a second batch from one context still gets new ids and URLs, which is what score keys must ignore.
test('failuresnotion actual feed fixture has the same score keys in two batches despite new ids and URLs', () => {
  const source = fs.readFileSync(new URL('../lib/activity-steps.mjs', import.meta.url), 'utf8');
  const feedSource = source.slice(source.indexOf('const feedIds ='), source.indexOf('// What a person is told'));
  const ctx = {feeds: '/fixture-only'};
  const setFeed = runInNewContext(`${feedSource.replace('export function', 'function')}; setFeed`,
    {path, fs: {writeFileSync: () => {}}});
  const batch = () => titles.flatMap(suffix => setFeed(ctx, [`Senior Site Reliability Engineer, ${suffix}`],
    suffix === 'save seed' ? {location: 'Zurich, Switzerland'} : {}));
  const earlier = batch(), later = batch();
  const table = loadTable(answersTableFile);
  for (let i = 0; i < earlier.length; i++) {
    assert.notEqual(earlier[i].id, later[i].id);
    assert.notEqual(earlier[i].absolute_url, later[i].absolute_url);
    const question = job => questionOf(request('score', {...score, messages: [{role: 'user',
      content: `Title: ${job.title}\nCompany: E2E Acme\nLocation: ${job.location.name}\n\nPosting:\n${job.content}`}]}), {}, table);
    assert.deepEqual(question(earlier[i]), question(later[i]));
    assert.ok(answerFor(question(earlier[i]), table).reply);
  }
});

test('failuresnotion random profile ids do not change its declared reply or move applicant facts', async t => {
  const h = await backboneHarness(t, 'failuresnotion');
  const ask = captured.find(ask => ask.action === 'organize_lines'), byteKeys = new Set();
  for (const salt of ['first', 'second']) {
    const body = JSON.parse(JSON.stringify(ask.request).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, salt));
    byteKeys.add(requestKey(ask.url, Buffer.from(JSON.stringify(body))));
    assert.deepEqual(questionOf(request(ask.action, body), h.env), {operation: 'app.kind', id: 'organize_lines'});
    const {items, destinations} = JSON.parse(body.messages[0].content);
    const lines = items.map(item => ({id: item.id, page: item.context[0], context: item.context.slice(1), value: item.line}));
    const client = {messages: {create: async (body, options) => storedAnswer(request(options.headers['x-jp-action'], body), h.env).reply}};
    const judged = await judge(lines, {client}, {destinations});
    assert.equal(judged.size, 0);
    assert.deepEqual(planOf(lines, judged), {moves: [], conflicts: []});
  }
  assert.equal(byteKeys.size, 2, 'random ids miss the old byte cache while the declared kind stays stable');
  h.assertNoLive();
});

test('failuresnotion declares background kinds and fails an undeclared ask by suite and kind', async t => {
  const h = await backboneHarness(t, 'failuresnotion');
  for (const kind of ['contact_asks', 'covered_facts', 'reuse_verdict', 'field_redraft', 'places']) {
    const init = request(kind, {messages: [{role: 'user', content: 'Background read'}]});
    assert.deepEqual(storedAnswer(init, h.env), {refuse: 'invalid-key'});
    await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), /invalid-key/);
    assert.equal((await h.localFetch(`${h.proxy.url}/v1/messages`, init)).status, 401);
  }
  const init = request('undeclared_failuresnotion_kind', {});
  const missing = {code: 'E2E_AI_ANSWER_MISSING', message: /failuresnotion: undeclared_failuresnotion_kind.*is unkeyable/};
  assert.throws(() => storedAnswer(init, h.env), missing);
  await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), missing);
  const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
  assert.equal(response.status, 503);
  const {error} = await response.json();
  assert.equal(error.code, missing.code); assert.match(error.message, missing.message);
  h.assertNoLive();
});

test('failuresnotion declares offline AI and backbone in both workflow attempts', () => {
  const source = fs.readFileSync(new URL('../suites/failuresnotion.mjs', import.meta.url), 'utf8');
  assert.match(source, /^export const offlineAi = true;/m);
  assert.match(source, /^export const realAi = false;/m);
  // The suite declares it; every workflow reads it from the matrix (plan-run.mjs, tests/test_workflow_ai_answers.py; beta 41078746088: a hand-kept list drifted).
  assert.match(fs.readFileSync(new URL('../suites/failuresnotion.mjs', import.meta.url), 'utf8'), /^export const aiAnswers = 'backbone';/m);
});
