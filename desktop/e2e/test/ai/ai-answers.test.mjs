// Stored question answers precede every transport and hash cache, with localhost-only upstreams.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {answersMode, loadTable, questionOf, answerFor, refusal, recordCandidate, refusedQuestions, storedAnswer} from '../../lib/ai-answers.mjs';
import {FAILURES, message, startAiProxy} from '../../lib/ai-proxy.mjs';
import {fresh, keep, requestKey} from '../../lib/ai-meter.mjs';
import {modelFetch} from '../../lib/model.mjs';
import {judge} from '../../lib/factjudge.mjs';

const golden = JSON.parse(fs.readFileSync(new URL('../../fixtures/golden/truth.json', import.meta.url)));
const company = JSON.parse(fs.readFileSync(new URL('../../fixtures/golden/sources.json', import.meta.url)))[0].company;
const stored = message('{"score":82}'), live = message('{"score":61}');
const score = (item = golden[0], extra = '') => ({model: 'test', messages: [{role: 'user', content: `Title: ${item.title}\nCompany: ${item.company ?? company}\nLocation: ${item.location}\nPosting:\n${extra || item.description}`} ]});
const init = body => ({method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': 'score'}, body: JSON.stringify(body)});
const keyed = {operation: 'app.score', id: '3001'};
const feedPosting = {company: 'Acme', location: 'Zurich', title: 'Site Reliability Engineer'};
const feedId = `feed/${createHash('sha256').update(JSON.stringify({company: 'Acme', location: 'Zurich', title: 'Site Reliability Engineer'})).digest('hex')}`;
const scoreReason = 'app.score: request must carry exactly one posting identity matching at most one golden row';

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
    assert.deepEqual(questionOf({url: '/v1/responses', body: {prompt_cache_key: 'jobadabra-score', input: body.messages}}), {operation: 'app.score', id: String(item.id)});
  }
  const a = score(), b = score(golden[1]);
  assert.match(questionOf({headers: {'x-jp-action': 'score'}, body: {...a, messages: [...a.messages, ...b.messages]}}).unkeyable, /app.score/);
  assert.deepEqual(questionOf({body: a, hint: {operation: 'judge.facts', id: '3001/first'}}), {operation: 'judge.facts', id: '3001/first'});
  assert.deepEqual(questionOf({headers: {'x-jp-action': 'decide'}, body: a}), {unkeyable: 'decide: missing recognised system prefix'});
});

test('non-golden score identity hashes sorted trimmed fields and keeps persona isolation', () => {
  for (const posting of [feedPosting, {title: '  Site Reliability Engineer  ', company: ' Acme ', location: ' Zurich  '}]) {
    const body = score(posting, 'Unrelated posting text.');
    for (const persona of ['', 'photographer']) {
      const expected = {operation: 'app.score', id: persona ? `${persona}/${feedId}` : feedId};
      const env = {E2E_QUALITY_PERSONA: persona};
      assert.deepEqual(questionOf({headers: {'x-jp-action': 'score'}, body}, env), expected);
      assert.deepEqual(questionOf({body: {prompt_cache_key: 'jobadabra-score', input: body.messages}}, env), expected);
    }
  }
});

test('score refuses zero or multiple identities and multiple golden matches with the same reason', t => {
  const request = body => questionOf({headers: {'x-jp-action': 'score'}, body}, {});
  assert.deepEqual(request({messages: []}), {unkeyable: scoreReason});
  const a = score(feedPosting), b = score(golden[0]);
  for (const messages of [[...a.messages, ...a.messages], [...a.messages, ...b.messages]]) {
    assert.deepEqual(request({messages}), {unkeyable: scoreReason});
  }
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => String(file) === String(new URL('../../fixtures/golden/truth.json', import.meta.url)) ?
    JSON.stringify([...golden, {...golden[0], id: 9999}]) : read(file, ...args));
  assert.deepEqual(request(b), {unkeyable: scoreReason});
});

test('feed score entries use the same reply-object validation as golden entries', t => {
  const {file} = fixture(t, {'app.score': {[feedId]: {reply: stored}}});
  assert.deepEqual(answerFor({operation: 'app.score', id: feedId}, loadTable(file)), {reply: stored});
  for (const id of ['3001', feedId]) for (const entry of [{}, {reply: null}, {reply: []}, {reply: 'text'}]) {
    fs.writeFileSync(file, JSON.stringify({v: 1, answers: {'app.score': {[id]: entry}}}));
    assert.throws(() => loadTable(file), error => error.message === `AI answers: app.score/${id} reply must be an object`);
  }
});

for (const shape of ['anthropic', 'openai']) for (const mode of ['off', 'backbone', 'record']) test(`feed score ${shape} ${mode}: stored replies at all three seams; backbone misses refuse by name`, async t => {
  const {file, env, dir} = fixture(t, {});
  Object.assign(env, {E2E_AI_ANSWERS: 'backbone', E2E_AI_CACHE: dir, E2E_AI_CANDIDATES: dir, E2E_AI_REPLAY: '1', E2E_QUALITY_PERSONA: ''});
  environment(t, env);
  const up = await upstream(t); let engines = 0, relays = 0;
  const proxy = await proxyFor(t, {target: up.url, shape, relay: () => { relays++; throw new Error('must not relay'); }});
  const body = shape === 'anthropic' ? score(feedPosting) : {prompt_cache_key: 'jobadabra-score', input: score(feedPosting).messages};
  const pathname = shape === 'anthropic' ? '/v1/messages' : '/v1/responses', request = init(body);
  const ask = {url: pathname, headers: request.headers, body};
  const options = {env, engine: () => { engines++; throw new Error('must not choose an engine'); }};
  keep(requestKey(pathname, Buffer.from(request.body)), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(live))}, env);
  const named = error => { assert.equal(error.code, 'E2E_AI_ANSWER_MISSING'); assert.ok(error.message.includes(`app.score/${feedId} has no stored answer`)); return true; };
  assert.throws(() => storedAnswer(ask, env), named);
  await assert.rejects(modelFetch(`${up.url}${pathname}`, request, options), named);
  const missing = await fetch(`${proxy.url}${pathname}`, request);
  assert.equal(missing.status, 503); named((await missing.json()).error);
  assert.equal(refusedQuestions(env).length, 3);
  fs.writeFileSync(file, JSON.stringify({v: 1, answers: {'app.score': {[feedId]: {reply: stored}}}}));
  env.E2E_AI_ANSWERS = process.env.E2E_AI_ANSWERS = mode;
  assert.deepEqual(storedAnswer(ask, env), {reply: stored});
  assert.deepEqual(await (await modelFetch(`${up.url}${pathname}`, request, options)).json(), stored);
  const response = await fetch(`${proxy.url}${pathname}`, request);
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert.equal(shape === 'openai' ? reply.output_text : reply.content[0].text, stored.content[0].text);
  assert.equal(up.calls(), 0); assert.equal(engines, 0); assert.equal(relays, 0); assert.equal(proxy.stats.paid || 0, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'ai-answers-candidates.json')));
});

test('feed score record misses write loadable keyed candidates through modelFetch and the proxy', async t => {
  const {env, dir} = fixture(t, {}), up = await upstream(t);
  Object.assign(env, {E2E_AI_ANSWERS: 'record', E2E_AI_CANDIDATES: dir, E2E_AI_CACHE: dir, E2E_AI_REPLAY: '1', E2E_QUALITY_PERSONA: ''});
  environment(t, env);
  const proxy = await proxyFor(t, {target: up.url}), request = init(score(feedPosting));
  const candidates = path.join(dir, 'ai-answers-candidates.json');
  for (const ask of [() => modelFetch(`${up.url}/v1/messages`, request, {env, engine: () => 'api'}),
    () => fetch(`${proxy.url}/v1/messages`, request)]) {
    assert.deepEqual(await (await ask()).json(), live);
    assert.deepEqual(loadTable(candidates).answers, {'app.score': {[feedId]: {reply: live}}});
    fs.rmSync(candidates);
  }
  assert.equal(up.calls(), 2);
  assert.deepEqual(loadTable(env.E2E_AI_ANSWERS_FILE).answers, {});
});

test('kind declarations validate exactly one known refusal or object reply', t => {
  const {file} = fixture(t);
  const write = kinds => fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, kinds}));
  for (const answer of [...Object.keys(FAILURES).map(refuse => ({refuse})), {reply: stored}]) {
    write({answer_home: {answer}});
    assert.deepEqual(loadTable(file).kinds.answer_home.answer, answer);
  }
  for (const kinds of [null, [], {answer_home: {}}, {answer_home: {answer: {}}},
    {answer_home: {answer: {refuse: 'unknown'}}}, {answer_home: {answer: {reply: []}}},
    {answer_home: {answer: {refuse: 'invalid-key', reply: stored}}}]) {
    write(kinds);
    assert.throws(() => loadTable(file), /AI answers:.*kinds|AI answers:.*answer_home/);
  }
});

test('kind identity and answers depend only on the declared action name', t => {
  const fixed = fixture(t), {file} = fixed, env = {...fixed.env, E2E_AI_ANSWERS: 'backbone'};
  const kinds = {answer_home: {answer: {refuse: 'invalid-key'}}, field_redraft: {answer: {reply: stored}}};
  fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, kinds}));
  const table = loadTable(file);
  for (const [kind, {answer}] of Object.entries(kinds)) {
    for (const body of [{messages: [{role: 'user', content: 'first item'}]}, {input: 'another item'}]) {
      const question = questionOf({headers: {'x-jp-action': kind}, body}, env);
      assert.deepEqual(question, {operation: 'app.kind', id: kind});
      assert.deepEqual(answerFor(question, table), answer);
    }
    assert.deepEqual(questionOf({body: {prompt_cache_key: `jobadabra-${kind}`}}, env), {operation: 'app.kind', id: kind});
    assert.deepEqual(questionOf({headers: {'x-jp-action': kind}}, {...env, E2E_QUALITY_PERSONA: 'photographer'}, table), {operation: 'app.kind', id: kind});
  }
  for (const mode of ['off', 'record']) {
    const live = questionOf({headers: {'x-jp-action': 'answer_home'}}, {...env, E2E_AI_ANSWERS: mode}, table);
    assert.match(live.unkeyable, /answer_home: question identity is not in the request/, `${mode}: live suites keep their replay and live path`);
  }
  assert.deepEqual(answerFor({operation: 'app.kind', id: 'undeclared_kind'}, table), {missing: 'app.kind/undeclared_kind'});
  assert.match(questionOf({headers: {'x-jp-action': 'undeclared_kind'}}, env).unkeyable, /undeclared_kind/);
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
    const response = await fetch(`${proxy.url}/v1/responses`, init({prompt_cache_key: 'jobadabra-score', input: score().messages, stream}));
    const text = await response.text(); assert.match(text, /score/);
    if (stream) assert.match(text, /response.completed/); else assert.equal(JSON.parse(text).output_text, stored.content[0].text);
  }
  assert.equal(up.calls(), 0);
});

test('backbone refuses unparseable decide and keyed misses despite warm cache, replay off and fresh; harness remembers each', async t => {
  const {env, dir} = fixture(t, {}); environment(t, {...env, E2E_AI_ANSWERS: 'backbone', E2E_AI_REPLAY: '1', E2E_AI_CACHE: dir});
  const up = await upstream(t); let relays = 0;
  const proxy = await proxyFor(t, {target: up.url, relay: async () => { relays++; throw new Error('must not relay'); }});
  const body = score(); keep(requestKey('/v1/messages', Buffer.from(JSON.stringify(body))), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(live))});
  const ask = async options => { const r = await fetch(`${proxy.url}/v1/messages`, options); assert.equal(r.status, 503); const data = await r.json(); assert.equal(data.error.code, 'E2E_AI_ANSWER_MISSING'); return data.error.message; };
  assert.match(await ask({...init(body), headers: {'x-jp-action': 'decide'}}), /decide: missing recognised system prefix/);
  assert.match(await ask(init(body)), /app.score\/3001/);
  await fresh(() => ask(init(body)));
  process.env.E2E_AI_REPLAY = '0'; await ask(init(body));
  assert.equal(up.calls(), 0); assert.equal(relays, 0);
  const refused = refusedQuestions(); assert.equal(refused.length, 4); assert.match(refused[0].message, /decide/);
  assert.equal(refusedQuestions({...env, E2E_ARTIFACTS: `${dir}${path.sep}`}).length, 4);
});

// off: a live measurement suite's stand-in (realAi = true; test/ai/one-answer-rule.test.mjs): only a live caller or a record run sends a miss on.
for (const mode of ['off', 'record']) test(`${mode} miss uses localhost upstream${mode === 'record' ? ' and records loadable merged candidates' : ''}`, async t => {
  const {env, dir} = fixture(t, {}); environment(t, {...env, E2E_AI_ANSWERS: mode, E2E_AI_REPLAY: mode === 'record' ? '1' : '0', E2E_AI_CACHE: dir, E2E_AI_CANDIDATES: dir});
  keep(requestKey('/v1/messages', Buffer.from(JSON.stringify(score()))), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(stored))});
  const up = await upstream(t), proxy = await proxyFor(t, {target: up.url, ...(mode === 'off' ? {live: true} : {})});
  assert.deepEqual(await (await fetch(`${proxy.url}/v1/messages`, init(score()))).json(), live); assert.equal(up.calls(), 1);
  const candidates = path.join(dir, 'ai-answers-candidates.json');
  if (mode === 'record') {
    assert.deepEqual(loadTable(candidates).answers, {'app.score': {'3001': {reply: live}}}, 'one keyed live reply writes one candidate');
    recordCandidate(dir, {operation: 'judge.facts', id: '3002/first'}, stored);
    assert.deepEqual(answerFor(keyed, loadTable(candidates)), {reply: live});
    assert.deepEqual(answerFor({operation: 'judge.facts', id: '3002/first'}, loadTable(candidates)), {reply: stored});
    assert.deepEqual(loadTable(env.E2E_AI_ANSWERS_FILE).answers, {});
  } else assert.ok(!fs.existsSync(candidates));
});

// Why (2 Nov 2026, owner: "A: remove exact matching"): this asserted the opposite (a warm answer replayed by the request's text); a record run asks the model instead.
for (const action of ['decide', 'strategy', 'places', 'saved-answers']) test(`record proxy never answers an unkeyable ${action} ask by its text: it asks the model and records nothing`, async t => {
  const {env, dir} = fixture(t, {});
  environment(t, {...env, E2E_AI_ANSWERS: 'record', E2E_AI_REPLAY: '1', E2E_AI_CACHE: dir});
  const body = {model: 'test', messages: [{role: 'user', content: `An unkeyable ${action} question.`}]};
  keep(requestKey('/v1/messages', Buffer.from(JSON.stringify(body))), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(stored))});
  const up = await upstream(t), proxy = await proxyFor(t, {target: up.url});
  const response = await fetch(`${proxy.url}/v1/messages`, {...init(body), headers: {'content-type': 'application/json', 'x-jp-action': action}});
  assert.equal(up.calls(), 1);
  assert.deepEqual(await response.json(), live);
  assert.equal(proxy.stats.paid, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'ai-answers-candidates.json')));
});

test('record modelFetch replays a warm unkeyable answer without paying or recording', async t => {
  const {env, dir} = fixture(t, {}), up = await upstream(t);
  Object.assign(env, {E2E_AI_ANSWERS: 'record', E2E_AI_REPLAY: '1', E2E_AI_CACHE: dir});
  const request = {...init({model: 'test', messages: []}), headers: {'x-jp-action': 'strategy'}};
  keep(requestKey('judge claude /v1/messages', Buffer.from(request.body)), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(stored))}, env);
  const response = await modelFetch(`${up.url}/v1/messages`, request, {env, engine: () => 'api'});
  assert.equal(up.calls(), 0);
  assert.deepEqual(await response.json(), stored);
  assert.ok(!fs.existsSync(path.join(dir, 'ai-answers-candidates.json')));
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

for (const mode of ['off', 'backbone', 'record']) test(`photographer judge in ${mode} never replays the default persona's verdict`, async t => {
  const hint = {operation: 'judge.facts', id: '3001/second'};
  const {env, dir} = fixture(t, {'judge.facts': {[hint.id]: {reply: stored}}}), up = await upstream(t);
  Object.assign(env, {E2E_AI_ANSWERS: mode, E2E_QUALITY_PERSONA: 'photographer'});
  const ask = () => modelFetch(`${up.url}/v1/messages`, {...init({}), hint}, {env, engine: () => 'api'});
  if (mode === 'backbone') {
    await assert.rejects(ask(), /judge.facts\/photographer\/3001\/second.*has no stored answer/);
    assert.equal(up.calls(), 0);
  } else {
    assert.deepEqual(await (await ask()).json(), live);
    assert.equal(up.calls(), 1);
    if (mode === 'record') {
      const table = loadTable(path.join(dir, 'ai-answers-candidates.json'));
      assert.deepEqual(Object.keys(table.answers['judge.facts']), ['photographer/3001/second']);
      assert.deepEqual(answerFor({operation: 'judge.facts', id: 'photographer/3001/second'}, table), {reply: live});
    }
  }
});

for (const mode of ['off', 'backbone', 'record']) test(`photographer score in ${mode} uses its own golden posting and stored answer`, async t => {
  const posting = JSON.parse(fs.readFileSync(new URL('../../fixtures/golden-photographer/truth.json', import.meta.url)))[0];
  const employer = JSON.parse(fs.readFileSync(new URL('../../fixtures/golden-photographer/sources.json', import.meta.url)))[0].company;
  const body = {model: 'test', messages: [{role: 'user', content: `Title: ${posting.title}\nCompany: ${employer}\nLocation: ${posting.location}\nPosting:\n${posting.description}`} ]};
  const {env} = fixture(t, {'app.score': {'3001': {reply: stored}, 'photographer/3001': {reply: live}}});
  environment(t, {...env, E2E_AI_ANSWERS: mode, E2E_QUALITY_PERSONA: 'photographer'});
  const up = await upstream(t), proxy = await proxyFor(t, {target: up.url});
  const response = await fetch(`${proxy.url}/v1/messages`, init(body));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), live);
  assert.equal(up.calls(), 0, 'the photographer entry must be served before any live transport');
  assert.deepEqual(questionOf({headers: {'x-jp-action': 'score'}, body}), {operation: 'app.score', id: 'photographer/3001'});
});

for (const mode of ['off', 'backbone', 'record']) test(`photographer score in ${mode} cannot match a default-only posting`, async t => {
  const {env} = fixture(t);
  environment(t, {...env, E2E_AI_ANSWERS: mode, E2E_QUALITY_PERSONA: 'photographer'});
  const up = await upstream(t), proxy = await proxyFor(t, {target: up.url, ...(mode === 'off' ? {live: true} : {})});
  const response = await fetch(`${proxy.url}/v1/messages`, init(score()));
  if (mode === 'backbone') {
    assert.equal(response.status, 503);
    assert.match((await response.json()).error.message, /app.score\/photographer\/feed\/[a-f0-9]{64}.*has no stored answer/);
    assert.equal(up.calls(), 0);
  } else {
    assert.deepEqual(await response.json(), live);
    assert.equal(up.calls(), 1);
  }
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
  const request = {prompt_cache_key: 'jobadabra-score', input: score().messages};
  assert.deepEqual(await (await fetch(`${openai.url}/v1/responses`, init(request))).json(), native);
  assert.match(await (await fetch(`${openai.url}/v1/responses`, init({...request, stream: true}))).text(), /score/);
  assert.equal(up.calls(), 0);
});


test('declared caption identities survive prompt and application-list changes without reading the disk', () => {
  const backbone = {E2E_AI_ANSWERS: 'backbone'};
  const table = {v: 1, kinds: {interview: {identity: 'caption'}}, answers: {'app.interview': {
    'recruiter-call-gamma': {reply: stored}, 'E2E Acme · Round 1': {reply: live}
  }}};
  for (const [caption, entry] of Object.entries(table.answers['app.interview'])) {
    for (const content of [`Applications:\n0. Example\n\nCaption: ${caption}\n\nTranscript or notes:\nnotes`,
      `Applications:\n9. Reordered\n\nCaption: ${caption}\n\nTranscript or notes:\nchanged\nCaption: spoof`]) {
      const question = questionOf({headers: {'x-jp-action': 'interview'}, body: {messages: [
        {role: 'system', content: 'Caption: wrong'}, {role: 'user', content: [{type: 'text', text: content}]}]}}, backbone, table);
      assert.deepEqual(question, {operation: 'app.interview', id: caption});
      assert.deepEqual(answerFor(question, table), {reply: entry.reply});
      assert.deepEqual(questionOf({body: {prompt_cache_key: 'jobadabra-interview', input: content}}, backbone, table), question);
    }
  }
  for (const content of ['no caption', 'Caption: (none)\n\nTranscript or notes:\nCaption: recruiter-call-gamma',
    'Caption: recruiter-call-gamma\nCaption: E2E Acme · Round 1']) {
    assert.match(questionOf({headers: {'x-jp-action': 'interview'}, body: {messages: [{role: 'user', content}]}}, backbone, table).unkeyable, /interview.*caption/);
  }
  assert.deepEqual(answerFor({operation: 'app.interview', id: 'new-round'}, table), {missing: 'app.interview/new-round'});
});

test('caption kind declarations validate without permitting a fallback answer or unknown identity', t => {
  const {file} = fixture(t);
  const write = entry => fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, kinds: {interview: entry}}));
  write({identity: 'caption'});
  assert.deepEqual(loadTable(file).kinds.interview, {identity: 'caption'});
  for (const entry of [{identity: 'unknown'}, {identity: 'caption', answer: {refuse: 'invalid-key'}}]) {
    write(entry);
    assert.throws(() => loadTable(file), /AI answers:.*interview/);
  }
});
