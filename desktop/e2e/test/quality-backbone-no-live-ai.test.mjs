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
