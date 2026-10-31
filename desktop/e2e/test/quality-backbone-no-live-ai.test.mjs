// Prove the reviewed quality fixture reaches every real answer seam without selecting a live transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {loadTable, questionOf, storedAnswer} from '../lib/ai-answers.mjs';
import {startAiProxy} from '../lib/ai-proxy.mjs';
import {modelFetch} from '../lib/model.mjs';
import {requestKey} from '../lib/ai-meter.mjs';
import {hash} from '../lib/ai-answers-engine-items.mjs';
import {backboneHarness} from '../lib/backbone-harness.mjs';
import {buildRequest} from '../lib/factjudge.mjs';
import {checkAiMisses} from '../lib/no-real-ai.mjs';
import {engineCases} from './ai-answers-engine-fixtures.mjs';

const tableFile = fileURLToPath(new URL('../fixtures/golden/ai-answers.json', import.meta.url));
const truth = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/truth.json', import.meta.url), 'utf8'));
const company = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/sources.json', import.meta.url), 'utf8'))[0].company;

// Same temp-artifacts, environment restoration and localhost proxy pattern as ai-answers.test.mjs;
// these integration cases use the committed reviewed table rather than that file's synthetic answers.
async function harness(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-backbone-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const env = {E2E_AI_ANSWERS: 'backbone', E2E_AI_ANSWERS_FILE: tableFile, E2E_ARTIFACTS: dir, E2E_SUITE: 'quality',
    E2E_AI_REPLAY: '0', E2E_AI_CACHE: dir, E2E_QUALITY_PERSONA: '', E2E_JUDGE_FAMILY: 'claude', E2E_AI_PROVIDER: 'claude'};
  const saved = {...process.env};
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  let networkCalls = 0, engines = 0;
  const forbidden = () => { networkCalls++; assert.fail('backbone must never call a live transport'); };
  const localFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', forbidden);
  const upstream = http.createServer((_req, res) => { networkCalls++; res.writeHead(500); res.end('unexpected upstream request'); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => { upstream.closeAllConnections(); return new Promise(resolve => upstream.close(resolve)); });
  const target = `http://127.0.0.1:${upstream.address().port}`;
  const proxy = await startAiProxy({target, relay: forbidden});
  t.after(() => proxy.close());
  return {env, proxy, target, localFetch, options: {env, engine: () => { engines++; return 'api'; }},
    assertNoLive: () => { assert.equal(networkCalls, 0); assert.equal(engines, 0); assert.equal(proxy.stats.paid || 0, 0); }};
}

function request(id) {
  const item = truth.find(item => String(item.id) === id);
  const body = {model: 'test', messages: [{role: 'user', content: `Title: ${item.title}\nCompany: ${company}\nLocation: ${item.location}\nPosting:\n${item.description}`}]};
  return {method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': 'score'}, body: JSON.stringify(body)};
}

test('quality backbone refuses an unstored golden question at every seam with zero live calls', async t => {
  const h = await harness(t), init = request('3007');
  const missing = {code: 'E2E_AI_ANSWER_MISSING', message: /quality: app.score\/3007.*has no stored answer/};
  assert.throws(() => storedAnswer({url: '/v1/messages', ...init}, h.env), missing);
  await assert.rejects(modelFetch(`${h.target}/v1/messages`, init, h.options), missing);
  const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
  assert.equal(response.status, 503);
  const {error} = await response.json();
  assert.equal(error.code, missing.code);
  assert.match(error.message, missing.message);
  h.assertNoLive();
});

test('quality backbone serves reviewed app.score/3001 at every seam with zero live calls', async t => {
  const h = await harness(t), init = request('3001');
  const expected = loadTable(tableFile).answers['app.score']['3001'].reply;
  assert.deepEqual(storedAnswer({url: '/v1/messages', ...init}, h.env), {reply: expected});
  const model = await modelFetch(`${h.target}/v1/messages`, init, h.options);
  assert.equal(model.status, 200);
  assert.deepEqual(await model.json(), expected);
  const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), expected);
  h.assertNoLive();
});


// Why (30 Oct 2026, qu): the same five Swiss alias patterns are asked under BOTH place topics; a refusal stops at the first missing item, so the country miss hid the metro one (CI 41003648273, ap #2565). One loop over every captured topic.
const aliasAsks = [['country', 'quality-country-ask.json', ['ch', 'ch', 'ch', 'ch', 'ch']], ['metro', 'quality-metro-ask.json', ['ch-zurich', 'ch-geneva', 'none', 'ch-basel', 'ch-bern']]];
for (const [topic, ask, answers] of aliasAsks) test(`quality serves the captured Swiss alias ${topic} batch without live AI`, async t => {
  const h = await harness(t);
  const {question} = JSON.parse(fs.readFileSync(new URL(`../fixtures/golden/${ask}`, import.meta.url), 'utf8'));
  const {context, items} = question;
  const body = {
    model: 'test', system: engineCases.find(item => item.name === 'decide').system,
    messages: [{role: 'user', content: `Task: ${context.task}\nAllowed answers: ${context.allowedAnswers}\n\n${items.map(({index, text}) => `### Item ${index}\n${text}`).join('\n\n')}`}],
    output_config: {format: {type: 'json_schema', schema: context.schema}},
  };
  const init = {method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': 'decide'}, body: JSON.stringify(body)};
  assert.deepEqual(questionOf(init, h.env, loadTable(tableFile)), question);
  const expected = {results: answers.map((answer, index) => ({index, answer}))};
  assert.deepEqual(JSON.parse(storedAnswer(init, h.env).reply.content[0].text), expected);
  const direct = await modelFetch(`${h.target}/v1/messages`, init, h.options);
  assert.deepEqual(JSON.parse((await direct.json()).content[0].text), expected);
  const proxied = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
  assert.equal(proxied.status, 200);
  assert.deepEqual(JSON.parse((await proxied.json()).content[0].text), expected);
  h.assertNoLive();
});

// Recorded verdicts are bound to all of the judge's inputs, never just a posting id or a favourable flag.
for (const operation of ['judge.facts', 'judge.cv-match']) test(`qualityai replays each exact recorded ${operation} request at stored, direct and proxy seams`, async t => {
  const h = await harness(t), table = loadTable(tableFile);
  const requests = Object.entries(table.requests[operation]);
  assert.equal(requests.length, operation === 'judge.facts' ? 10 : 3);
  for (const [id, ask] of requests) {
    const init = {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(ask.body)};
    assert.deepEqual(questionOf(init, h.env, table), {operation, id});
    assert.equal(requestKey('judge codex /v1/messages', Buffer.from(init.body)), ask.recorded.cacheKey, ask.evidence);
    assert.equal(hash(init.body), ask.recorded.requestSha256);
    const expected = table.answers[operation][id].reply;
    assert.equal(hash(JSON.stringify(expected)), ask.recorded.replySha256, 'reply bytes stay those of the recorded judge');
    assert.deepEqual(storedAnswer(init, h.env), {reply: expected});
    assert.deepEqual(await (await modelFetch(`${h.target}/v1/messages`, init, h.options)).json(), expected);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), expected);
    const changed = structuredClone(ask.body);
    changed.messages[0].content += '\nA different candidate or claim.';
    assert.notEqual(questionOf({body: changed}, h.env, table).id, id, 'changed judge inputs cannot borrow a verdict');
    assert.throws(() => storedAnswer({body: changed}, h.env), {code: 'E2E_AI_ANSWER_MISSING'});
    const hinted = {...init, hint: {operation: 'judge.facts', id: '3001/first'}};
    assert.deepEqual(questionOf(hinted, h.env, table), {operation, id}, 'a hint cannot override the actual judge inputs');
  }
  h.assertNoLive();
});

test('qualityai declares stored gate replies without changing its rate assertions', () => {
  const source = fs.readFileSync(new URL('../suites/qualityai.mjs', import.meta.url), 'utf8');
  for (const declaration of ['offlineAi = true', 'realAi = false', "aiAnswers = 'backbone'"]) assert.ok(source.includes(`export const ${declaration};`), declaration);
});

test('qualityai recorded facts judge the current saved scores and fixture postings', () => {
  const table = loadTable(tableFile), seen = new Set();
  for (const ask of Object.values(table.requests['judge.facts'])) {
    const text = ask.body.messages[0].content;
    const posting = truth.find(item => text.startsWith(`POSTING\nTitle: ${item.title}\nCompany: ${item.company || company}\nLocation: ${item.location}\n${item.description}\n`));
    assert.ok(posting, 'recorded posting is still the suite fixture');
    const score = JSON.parse(table.answers['app.score'][posting.id].reply.content[0].text);
    const profile = text.split('\n\nCANDIDATE\n')[1].split('\n\nTEXT THE TOOL WROTE\n')[0];
    const extracted = text.split('\n\nEXTRACTED FACTS (stage 1)\n')[1].split('\n\nCANDIDATE\n')[0];
    const facts = Object.fromEntries(extracted.split('\n').map(line => line.split(/: (.*)/s).slice(0, 2)));
    assert.deepEqual(buildRequest({posting: {...posting, company: posting.company || company}, profile,
      produced: [score.reason, null, `Gaps: ${score.gaps.join('; ')}`], facts}), ask.body);
    seen.add(posting.id);
  }
  assert.equal(seen.size, 10);
});

test('qualityai recorded judges also resolve through the OpenAI proxy without live AI or hash cache', async t => {
  const h = await backboneHarness(t, 'qualityai', 'openai');
  t.after(() => h.assertNoLive());
  Object.assign(h.env, {E2E_AI_REPLAY: '0', E2E_AI_CACHE: ''});
  Object.assign(process.env, h.env);
  const table = loadTable(tableFile);
  for (const operation of ['judge.facts', 'judge.cv-match']) for (const ask of Object.values(table.requests[operation])) {
    const body = {model: ask.body.model, instructions: ask.body.system, input: ask.body.messages,
      ...(ask.body.output_config ? {text: {format: ask.body.output_config.format}} : {})};
    const init = {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)};
    const expected = storedAnswer(init, h.env).reply;
    const response = await h.localFetch(`${h.openaiProxy.url}/v1/responses`, init);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse((await response.json()).output[0].content[0].text), JSON.parse(expected.content[0].text));
  }
  assert.equal(checkAiMisses(h.env.E2E_ARTIFACTS, {aiMissesMax: 0}).misses, 0);
});
