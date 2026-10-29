// Stored question answers precede every transport and hash cache, with localhost-only upstreams.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {answersMode, loadTable, questionOf, answerFor, refusal, recordCandidate, refusedQuestions} from '../lib/ai-answers.mjs';
import {message, startAiProxy} from '../lib/ai-proxy.mjs';
import {fresh, keep, requestKey} from '../lib/ai-meter.mjs';
import {modelFetch} from '../lib/model.mjs';
import {judge} from '../lib/factjudge.mjs';

const golden = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/truth.json', import.meta.url)));
const company = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/sources.json', import.meta.url)))[0].company;
const stored = message('{"score":82}'), live = message('{"score":61}');
const score = (item = golden[0], extra = '') => ({model: 'test', messages: [{role: 'user', content: `Title: ${item.title}\nCompany: ${company}\nLocation: ${item.location}\nPosting:\n${extra || item.description}`} ]});
const init = body => ({method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': 'score'}, body: JSON.stringify(body)});
const keyed = {operation: 'app.score', id: '3001'};

function fixture(t, answers = {'app.score': {'3001': {reply: stored}}}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-answers-'));
  const file = path.join(dir, 'table.json');
  fs.writeFileSync(file, JSON.stringify({v: 1, about: 'Test answers.', answers}));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return {dir, file, env: {E2E_AI_ANSWERS_FILE: file, E2E_ARTIFACTS: dir, E2E_SUITE: 'quality', E2E_JUDGE_FAMILY: 'claude', E2E_AI_PROVIDER: 'claude'}};
}

function environment(t, env) {
  const saved = {...process.env};
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
}

async function upstream(t) {
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    calls++;
    res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(live));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return {url: `http://127.0.0.1:${server.address().port}`, calls: () => calls};
}

async function proxyFor(t, options) {
  const proxy = await startAiProxy(options);
  t.after(() => proxy.close());
  return proxy;
}

test('mode, table validation, lookup and diagnostic contracts', t => {
  assert.equal(answersMode({}), 'off');
  for (const mode of ['off', 'backbone', 'record']) assert.equal(answersMode({E2E_AI_ANSWERS: mode}), mode);
  assert.throws(() => answersMode({E2E_AI_ANSWERS: 'typo'}), /E2E_AI_ANSWERS/);
  const {file} = fixture(t);
  assert.deepEqual(answerFor(keyed, loadTable(file)), {reply: stored});
  assert.deepEqual(answerFor({...keyed, id: 'absent'}, loadTable(file)), {missing: 'app.score/absent'});
  for (const bad of [{v: 2, answers: {}}, {v: 1, answers: {x: {y: {reply: null}}}}, {v: 1, answers: {x: {y: {reply: []}}}}]) {
    fs.writeFileSync(file, JSON.stringify(bad)); assert.throws(() => loadTable(file));
  }
  const error = refusal('quality', keyed, 'has no stored answer');
  assert.equal(error.code, 'E2E_AI_ANSWER_MISSING');
  assert.match(error.message, /quality: app.score\/3001.*E2E_AI_ANSWERS=backbone.*E2E_AI_ANSWERS=record/);
});

test('score identity uses exact posting triples, not wording, model, schemas or unrelated headers', () => {
  for (const item of golden.slice(0, 2)) {
    const body = score(item, 'A completely different instruction.'); body.model = 'changed';
    body.output_config = {format: {schema: {required: ['score'], properties: {score: {type: 'number'}}, type: 'object'}}};
    assert.deepEqual(questionOf({url: '/v1/messages', headers: new Headers({'X-JP-Action': 'score', arbitrary: 'changed'}), body: JSON.stringify(body)}), {operation: 'app.score', id: String(item.id)});
    assert.deepEqual(questionOf({url: '/v1/responses', body: {prompt_cache_key: 'job-pilotto-score', input: body.messages}}), {operation: 'app.score', id: String(item.id)});
  }
  const a = score(), b = score(golden[1]);
  assert.match(questionOf({headers: {'x-jp-action': 'score'}, body: {...a, messages: [...a.messages, ...b.messages]}}).unkeyable, /app.score/);
  assert.match(questionOf({headers: {'x-jp-action': 'score'}, body: score({title: 'Unknown', location: 'Nowhere'})}).unkeyable, /app.score/);
  assert.match(questionOf({headers: {'x-jp-action': 'score'}, body: {...a, messages: [{role: 'user', content: a.messages[0].content.replace(company, 'Other employer')}]}}).unkeyable, /app.score/);
  assert.deepEqual(questionOf({body: a, hint: {operation: 'judge.facts', id: '3001/first'}}), {operation: 'judge.facts', id: '3001/first'});
  assert.deepEqual(questionOf({headers: {'x-jp-action': 'decide'}, body: a}), {unkeyable: 'decide: topic and item keys are not in the request'});
});

for (const mode of ['off', 'backbone', 'record']) test(`table hit in ${mode} bypasses upstream, relay and hash cache`, async t => {
  const {env, dir} = fixture(t); environment(t, {...env, E2E_AI_ANSWERS: mode, E2E_AI_REPLAY: '1', E2E_AI_CACHE: dir});
  const up = await upstream(t);
  const body = score(); keep(requestKey('/v1/messages', Buffer.from(JSON.stringify(body))), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(live))});
  let relays = 0;
  const proxy = await proxyFor(t, {target: up.url, relay: async () => { relays++; throw new Error('must not relay'); }});
  assert.deepEqual(await (await fetch(`${proxy.url}/v1/messages`, init(body))).json(), stored);
  const changed = {...score(golden[0], 'Reworded prompt.'), model: 'another-model', output_config: {format: {schema: {properties: {b: {}, a: {}}, type: 'object'}}}};
  assert.deepEqual(await fresh(async () => (await fetch(`${proxy.url}/v1/messages`, init(changed))).json()), stored);
  assert.equal(up.calls(), 0); assert.equal(relays, 0); assert.equal(proxy.stats.paid || 0, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'ai-answers-candidates.json')));
});

test('OpenAI JSON and stream replies use the existing normal response wrappers', async t => {
  const {env} = fixture(t); environment(t, {...env, E2E_AI_ANSWERS: 'backbone'});
  const up = await upstream(t), proxy = await proxyFor(t, {target: up.url, shape: 'openai'});
  for (const stream of [false, true]) {
    const response = await fetch(`${proxy.url}/v1/responses`, init({prompt_cache_key: 'job-pilotto-score', input: score().messages, stream}));
    const text = await response.text(); assert.match(text, /score/);
    if (stream) assert.match(text, /response.completed/); else assert.equal(JSON.parse(text).output_text, stored.content[0].text);
  }
  assert.equal(up.calls(), 0);
});

test('backbone refuses decide and keyed misses despite warm cache, replay off and fresh; harness remembers each', async t => {
  const {env, dir} = fixture(t, {}); environment(t, {...env, E2E_AI_ANSWERS: 'backbone', E2E_AI_REPLAY: '1', E2E_AI_CACHE: dir});
  const up = await upstream(t); let relays = 0;
  const proxy = await proxyFor(t, {target: up.url, relay: async () => { relays++; throw new Error('must not relay'); }});
  const body = score(); keep(requestKey('/v1/messages', Buffer.from(JSON.stringify(body))), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(live))});
  const ask = async options => { const r = await fetch(`${proxy.url}/v1/messages`, options); assert.equal(r.status, 503); const data = await r.json(); assert.equal(data.error.code, 'E2E_AI_ANSWER_MISSING'); return data.error.message; };
  assert.match(await ask({...init(body), headers: {'x-jp-action': 'decide'}}), /decide: topic and item keys/);
  assert.match(await ask(init(body)), /app.score\/3001/);
  await fresh(() => ask(init(body)));
  process.env.E2E_AI_REPLAY = '0'; await ask(init(body));
  assert.equal(up.calls(), 0); assert.equal(relays, 0);
  const refused = refusedQuestions(); assert.equal(refused.length, 4); assert.match(refused[0].message, /decide/);
  assert.equal(refusedQuestions({...env, E2E_ARTIFACTS: `${dir}${path.sep}`}).length, 4);
});

for (const mode of ['off', 'record']) test(`${mode} miss uses localhost upstream${mode === 'record' ? ' and records loadable merged candidates' : ''}`, async t => {
  const {env, dir} = fixture(t, {}); environment(t, {...env, E2E_AI_ANSWERS: mode, E2E_AI_REPLAY: mode === 'record' ? '1' : '0', E2E_AI_CACHE: dir, E2E_AI_CANDIDATES: dir});
  keep(requestKey('/v1/messages', Buffer.from(JSON.stringify(score()))), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(stored))});
  const up = await upstream(t), proxy = await proxyFor(t, {target: up.url});
  assert.deepEqual(await (await fetch(`${proxy.url}/v1/messages`, init(score()))).json(), live); assert.equal(up.calls(), 1);
  const candidates = path.join(dir, 'ai-answers-candidates.json');
  if (mode === 'record') {
    recordCandidate(dir, {operation: 'judge.facts', id: '3002/first'}, stored);
    assert.deepEqual(answerFor(keyed, loadTable(candidates)), {reply: live});
    assert.deepEqual(answerFor({operation: 'judge.facts', id: '3002/first'}, loadTable(candidates)), {reply: stored});
    assert.deepEqual(loadTable(env.E2E_AI_ANSWERS_FILE).answers, {});
  } else assert.ok(!fs.existsSync(candidates));
});

test('modelFetch hints replay before engine selection and refuse before API, broker or CLI', async t => {
  const hint = {operation: 'judge.facts', id: '3001/first'};
  const {env} = fixture(t, {'judge.facts': {[hint.id]: {reply: stored}}});
  const up = await upstream(t); let engines = 0, executions = 0;
  const options = {env: {...env, E2E_AI_ANSWERS: 'backbone'}, engine: () => { engines++; return 'cli'; }, exec: async () => { executions++; throw new Error('must not execute'); }};
  assert.deepEqual(await (await modelFetch(up.url, {...init({}), hint}, options)).json(), stored);
  await assert.rejects(modelFetch(up.url, {...init({}), hint: {...hint, id: 'missing'}}, options), {code: 'E2E_AI_ANSWER_MISSING'});
  await assert.rejects(modelFetch(up.url, {...init({}), hint: {...hint, id: 'missing'}}, {...options, engine: () => 'api', env: {...options.env, CI: 'true', E2E_AI_PROVIDER: 'codex'}}), /judge.facts\/missing/);
  assert.equal(engines, 0); assert.equal(executions, 0); assert.equal(up.calls(), 0); assert.equal(refusedQuestions(options.env).length, 2);
});

test('modelFetch off and record misses reach localhost API; record also captures CLI replies', async t => {
  const {env, dir} = fixture(t, {}), up = await upstream(t), hint = {operation: 'judge.facts', id: '3001/first'};
  for (const mode of ['off', 'record']) {
    const response = await modelFetch(`${up.url}/v1/messages`, {...init({}), hint}, {engine: () => 'api', env: {...env, E2E_AI_ANSWERS: mode, E2E_AI_CANDIDATES: dir}});
    assert.deepEqual(await response.json(), live);
  }
  assert.equal(up.calls(), 2);
  const cliHint = {...hint, id: '3001/second'};
  const response = await modelFetch(up.url, {...init({model: 'test', messages: []}), hint: cliHint}, {engine: () => 'cli', exec: async () => ({code: 0, stdout: '{"result":"cli answer"}'}), env: {...env, E2E_AI_ANSWERS: 'record'}});
  assert.deepEqual(answerFor(cliHint, loadTable(path.join(dir, 'ai-answers-candidates.json'))), {reply: await response.json()});
});

test('factjudge passes its explicit question as the transport hint', async () => {
  const question = {operation: 'judge.facts', id: '3001/second'};
  const verdict = {grounded: true, contradicts_posting: false, invents_facts: false, useful: true, why: 'Grounded.'};
  let hint;
  assert.deepEqual(await judge({key: '', posting: golden[0], profile: 'Synthetic', produced: 'Text', question, fetchImpl: async (_url, options) => { hint = options.hint; return new Response(JSON.stringify(message(JSON.stringify(verdict)))); }}), verdict);
  assert.deepEqual(hint, question);
});

for (const mode of ['off', 'backbone', 'record']) test(`modelFetch table hit in ${mode} bypasses engine selection`, async t => {
  const hint = {operation: 'judge.facts', id: '3001/first'};
  const {env} = fixture(t, {'judge.facts': {[hint.id]: {reply: stored}}});
  const response = await fresh(() => modelFetch('http://127.0.0.1:1/v1/messages', {...init({}), hint}, {env: {...env, E2E_AI_ANSWERS: mode}, engine: () => { throw new Error('must not choose an engine'); }}));
  assert.deepEqual(await response.json(), stored);
});

test('modelFetch backbone refuses warm hash replays both normally and inside fresh', async t => {
  const hint = {operation: 'judge.facts', id: '3001/first'};
  const {env, dir} = fixture(t, {}), up = await upstream(t);
  const request = init({model: 'test', messages: []});
  Object.assign(env, {E2E_AI_ANSWERS: 'backbone', E2E_AI_CACHE: dir, E2E_AI_REPLAY: '1'});
  keep(requestKey('judge claude /v1/messages', Buffer.from(request.body)), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(stored))}, env);
  const ask = () => modelFetch(`${up.url}/v1/messages`, {...request, hint}, {env, engine: () => 'api'});
  await assert.rejects(ask(), {code: 'E2E_AI_ANSWER_MISSING'});
  await fresh(() => assert.rejects(ask(), {code: 'E2E_AI_ANSWER_MISSING'}), env);
  assert.equal(up.calls(), 0); assert.equal(refusedQuestions(env).length, 2);
});

test('modelFetch record miss bypasses a warm judge hash cache', async t => {
  const hint = {operation: 'judge.facts', id: '3001/first'};
  const {env, dir} = fixture(t, {}), up = await upstream(t);
  const request = init({model: 'test', messages: []});
  Object.assign(env, {E2E_AI_ANSWERS: 'record', E2E_AI_CACHE: dir, E2E_AI_REPLAY: '1'});
  keep(requestKey('judge claude /v1/messages', Buffer.from(request.body)), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(stored))}, env);
  const response = await modelFetch(`${up.url}/v1/messages`, {...request, hint}, {env, engine: () => 'api'});
  assert.deepEqual(await response.json(), live); assert.equal(up.calls(), 1);
  assert.deepEqual(answerFor(hint, loadTable(path.join(dir, 'ai-answers-candidates.json'))), {reply: live});
});

test('native OpenAI replies without output_text replay as Messages and as a stream', async t => {
  const native = {object: 'response', id: 'resp_native', output: [{type: 'message', content: [{type: 'output_text', text: '{"score":82}'}]}]};
  const {env} = fixture(t, {'app.score': {'3001': {reply: native}}}); environment(t, {...env, E2E_AI_ANSWERS: 'backbone'});
  const up = await upstream(t), anthropic = await proxyFor(t, {target: up.url}), openai = await proxyFor(t, {target: up.url, shape: 'openai'});
  assert.equal((await (await fetch(`${anthropic.url}/v1/messages`, init(score()))).json()).content[0].text, '{"score":82}');
  const request = {prompt_cache_key: 'job-pilotto-score', input: score().messages};
  assert.deepEqual(await (await fetch(`${openai.url}/v1/responses`, init(request))).json(), native);
  assert.match(await (await fetch(`${openai.url}/v1/responses`, init({...request, stream: true}))).text(), /score/);
  assert.equal(up.calls(), 0);
});
