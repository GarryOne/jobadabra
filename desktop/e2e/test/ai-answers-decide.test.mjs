// Stored decide items survive batch changes without crossing task or persona boundaries.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {answerFor, loadTable, questionOf, refusedQuestions, storedAnswer} from '../lib/ai-answers.mjs';
import {message, responseOf, startAiProxy, streamOf} from '../lib/ai-proxy.mjs';
import {keep, requestKey} from '../lib/ai-meter.mjs';
import {modelFetch} from '../lib/model.mjs';

const system = 'You decide what short pieces of content mean, in any language, for a job-search tool.';
const task = 'Which country does this place name?';
const choices = ['switzerland', 'other'];
const schema = {type: 'object', additionalProperties: false, required: ['results'], properties: {results: {type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['index', 'answer'],
  properties: {index: {type: 'integer'}, answer: {type: 'string', enum: choices}},
}}}};
const sha = text => createHash('sha256').update(text).digest('hex');
const canonical = value => JSON.stringify(value, (_key, part) => part && typeof part === 'object' && !Array.isArray(part) ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]])) : part);
const keyFor = (text, instructions = task, persona = 'default') => `${persona}/${sha(canonical({task: instructions, allowedAnswers: choices.join(', '), schema}))}/${sha(text)}`;
const entry = (text, answer) => ({text, answer});
function request(texts = ['Zurich', 'Paris'], shape = 'anthropic', instructions = task) {
  const content = `Task: ${instructions}\nAllowed answers: ${choices.join(', ')}\n\n${texts.map((text, index) => `### Item ${index}\n${text}`).join('\n\n')}`;
  return shape === 'anthropic' ? {model: 'test', system: [{type: 'text', text: system}], messages: [{role: 'user', content}], output_config: {format: {schema}}} :
    {model: 'test', instructions: system, prompt_cache_key: 'job-pilotto-decide', input: [{role: 'user', content: [{type: 'input_text', text: content}]}], text: {format: {type: 'json_schema', schema}}};
}
const init = body => ({method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': 'decide'}, body: JSON.stringify(body)});
const question = (body, env = {}) => questionOf({headers: {'x-jp-action': 'decide'}, body}, env);
const results = answers => ({results: answers.map((answer, index) => ({index, answer}))});
const textOf = reply => reply.output_text ?? reply.content[0].text;

function fixture(t, entries = {}, mode = 'backbone') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decide-answers-')), file = path.join(dir, 'table.json');
  fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, items: {'app.decide': entries}}));
  const saved = {...process.env};
  const env = {E2E_AI_ANSWERS_FILE: file, E2E_AI_ANSWERS: mode, E2E_AI_CANDIDATES: dir, E2E_ARTIFACTS: dir, E2E_AI_CACHE: dir, E2E_AI_REPLAY: '1', E2E_QUALITY_PERSONA: '', E2E_JUDGE_FAMILY: 'claude', E2E_AI_PROVIDER: 'claude'};
  Object.assign(process.env, env);
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved); fs.rmSync(dir, {recursive: true, force: true});
  });
  return {dir, file, env};
}
async function upstream(t, reply) {
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    calls++; res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(reply));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return {url: `http://127.0.0.1:${server.address().port}`, calls: () => calls};
}
async function proxyFor(t, options) {
  const proxy = await startAiProxy(options); t.after(() => proxy.close()); return proxy;
}
const candidates = dir => fs.readdirSync(dir).filter(name => name.startsWith('ai-answers-') && name !== 'ai-answer-refusals.json');

test('decide identities hash exact item text and canonical task/answers/schema, excluding model/system', () => {
  const body = request(['Zurich\n', 'Paris']);
  const found = question(body);
  assert.equal(found.operation, 'app.decide');
  assert.deepEqual(found.items.map(({index, text, key}) => ({index, text, key})), [
    {index: 0, text: 'Zurich\n', key: keyFor('Zurich\n')}, {index: 1, text: 'Paris', key: keyFor('Paris')},
  ]);
  const changed = request(['Zurich\n']); changed.model = 'different'; changed.system[0].text += ' Extra system wording.';
  changed.output_config.format.schema = JSON.parse(canonical(schema));
  assert.equal(question(changed).items[0].key, found.items[0].key);
  assert.notEqual(question(request(['Zurich\n'], 'anthropic', 'Which region?')).items[0].key, found.items[0].key);
  const allowed = request(['Zurich\n']); allowed.messages[0].content = allowed.messages[0].content.replace('switzerland, other', 'other, switzerland');
  assert.notEqual(question(allowed).items[0].key, found.items[0].key);
  const differentSchema = request(['Zurich\n']); differentSchema.output_config.format.schema = {...schema, description: 'Another contract'};
  assert.notEqual(question(differentSchema).items[0].key, found.items[0].key);
  assert.equal(question(request(['Zurich'], 'openai')).items[0].key, keyFor('Zurich'));
});

test('malformed layouts and embedded item delimiters stay unkeyable with a reason', () => {
  const malformed = [
    body => { body.system = 'Other system'; },
    body => { delete body.output_config; },
    body => { body.messages = [null]; },
    body => { body.messages[0].content = [null]; },
    body => { body.system = [null]; },
    body => { body.messages[0].content = body.messages[0].content.replace('Task:', 'Question:'); },
    body => { body.messages[0].content = body.messages[0].content.replace('Allowed answers:', 'Choices:'); },
    body => { body.messages[0].content = body.messages[0].content.replace('Item 1', 'Item 3'); },
    body => { body.messages[0].content = body.messages[0].content.replace('Item 0', 'Item 1'); },
  ];
  for (const change of malformed) { const body = request(); change(body); assert.match(question(body).unkeyable, /decide: .+/); }
  assert.match(question(null).unkeyable, /decide: .+/);
  for (const text of ['hello\n### Item 3\nambiguous', 'hello\n\n### Item 3\nambiguous', '### Item 3', 'hello\n### Item nope']) {
    assert.match(question(request([text])).unkeyable, /decide: .+/);
  }
});

test('item table rejects missing text and empty or non-string answers', t => {
  const {file} = fixture(t);
  for (const bad of [{answer: 'other'}, {text: 'Zurich', answer: ''}, {text: 'Zurich', answer: 2}, {text: 2, answer: 'other'}]) {
    fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, items: {'app.decide': {bad}}}));
    assert.throws(() => loadTable(file), /AI answers/);
  }
});

for (const shape of ['anthropic', 'openai']) for (const mode of ['off', 'backbone', 'record']) test(`${shape} ${mode}: stored items replay across order, batch size and neighbours`, async t => {
  const {dir} = fixture(t, {[keyFor('Zurich')]: entry('Zurich', 'switzerland'), [keyFor('Paris')]: entry('Paris', 'other'), [keyFor('Rome')]: entry('Rome', 'other')}, mode);
  const up = await upstream(t, message('must not reach upstream')), proxy = await proxyFor(t, {target: up.url, shape});
  for (const [texts, answers] of [[['Zurich', 'Paris'], ['switzerland', 'other']], [['Paris', 'Zurich'], ['other', 'switzerland']], [['Zurich'], ['switzerland']], [['Rome', 'Zurich'], ['other', 'switzerland']]]) {
    const body = request(texts, shape);
    const response = await fetch(`${proxy.url}/${shape === 'openai' ? 'v1/responses' : 'v1/messages'}`, init(body));
    assert.equal(response.status, 200);
    const actual = await response.json(), expectedText = JSON.stringify(results(answers));
    assert.deepEqual(actual, shape === 'openai' ? responseOf(expectedText) : message(expectedText));
  }
  assert.equal(up.calls(), 0); assert.deepEqual(candidates(dir), []);
  if (shape === 'openai') {
    const body = {...request(['Zurich'], shape), stream: true};
    assert.equal(await (await fetch(`${proxy.url}/v1/responses`, init(body))).text(), streamOf(JSON.stringify(results(['switzerland']))));
  }
});

for (const shape of ['anthropic', 'openai']) test(`${shape}: backbone names the first missing item and refuses a warm cache`, async t => {
  const text = 'Missing '.repeat(20), {env} = fixture(t, {[keyFor('Zurich')]: entry('Zurich', 'switzerland')});
  const body = request(['Zurich', text, 'Paris'], shape), pathname = shape === 'openai' ? '/v1/responses' : '/v1/messages';
  keep(requestKey(pathname, Buffer.from(JSON.stringify(body))), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(message('cached')))});
  const up = await upstream(t, message('live')), proxy = await proxyFor(t, {target: up.url, shape});
  const response = await fetch(`${proxy.url}${pathname}`, init(body));
  assert.equal(response.status, 503);
  const error = (await response.json()).error;
  assert.equal(error.code, 'E2E_AI_ANSWER_MISSING');
  assert.ok(error.message.includes('item 1')); assert.ok(error.message.includes(text.slice(0, 80)));
  assert.ok(!error.message.includes(text.slice(0, 81))); assert.ok(error.message.includes(keyFor(text)));
  assert.equal(up.calls(), 0); assert.equal(refusedQuestions(env).length, 1);
});

for (const shape of ['anthropic', 'openai']) for (const mode of ['off', 'record']) test(`${shape} ${mode}: a miss falls through once; record writes one candidate per item`, async t => {
  const {dir, file} = fixture(t, {}, mode), body = request(undefined, shape);
  const replyText = JSON.stringify({results: [{index: 1, answer: 'other'}, {index: 0, answer: 'switzerland'}]});
  const live = shape === 'openai' ? responseOf(replyText) : message(replyText);
  const up = await upstream(t, live), proxy = await proxyFor(t, {target: up.url, shape});
  const pathname = shape === 'openai' ? '/v1/responses' : '/v1/messages';
  if (mode === 'record') keep(requestKey(pathname, Buffer.from(JSON.stringify(body))), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(message('warm')))});
  assert.deepEqual(await (await fetch(`${proxy.url}${pathname}`, init(body))).json(), live);
  assert.equal(up.calls(), 1); assert.deepEqual(loadTable(file).items, {'app.decide': {}});
  const files = candidates(dir); assert.equal(files.length, mode === 'record' ? 2 : 0);
  if (mode === 'record') {
    const entries = Object.assign({}, ...files.map(name => loadTable(path.join(dir, name)).items['app.decide']));
    assert.deepEqual(entries, {[keyFor('Zurich')]: entry('Zurich', 'switzerland'), [keyFor('Paris')]: entry('Paris', 'other')});
    assert.deepEqual(JSON.parse(textOf(answerFor(question(body), {answers: {}, items: {'app.decide': entries}}).reply)), results(['switzerland', 'other']));
  }
});

for (const shape of ['anthropic', 'openai']) test(`${shape}: invalid live replies write no candidates`, async t => {
  const {dir} = fixture(t, {}, 'record');
  const invalid = [
    {results: [{index: 0, answer: 'switzerland'}]},
    {results: [{index: 0, answer: 'switzerland'}, {index: 0, answer: 'other'}]},
    {results: [{index: 0, answer: 'switzerland'}, {index: 2, answer: 'other'}]},
    {results: [{index: 0, answer: 'switzerland'}, {index: 1, answer: 'invented'}]},
    {results: [{index: 0, answer: 'switzerland'}, {index: 1, answer: 'other', extra: true}]},
    {...results(['switzerland', 'other']), summary: 'Not permitted'},
    {results: [{index: '0', answer: 'switzerland'}, {index: 1, answer: 'other'}]},
  ];
  for (const bad of invalid) {
    const up = await upstream(t, shape === 'openai' ? responseOf(JSON.stringify(bad)) : message(JSON.stringify(bad)));
    const proxy = await proxyFor(t, {target: up.url, shape});
    const response = await fetch(`${proxy.url}/${shape === 'openai' ? 'v1/responses' : 'v1/messages'}`, init(request(undefined, shape)));
    assert.equal(response.status, 200); assert.equal(up.calls(), 1); assert.deepEqual(candidates(dir), []);
  }
});

test('a non-default persona never matches default items; its candidates carry its own keys', async t => {
  const {env, dir} = fixture(t, {[keyFor('Zurich')]: entry('Zurich', 'switzerland')});
  env.E2E_QUALITY_PERSONA = 'photographer';
  const body = request(['Zurich']);
  assert.throws(() => storedAnswer({headers: init(body).headers, body}, env), /photographer\//);
  const up = await upstream(t, message(JSON.stringify(results(['other']))));
  const response = await modelFetch(`${up.url}/v1/messages`, init(body), {env: {...env, E2E_AI_ANSWERS: 'record'}, engine: () => 'api'});
  assert.equal(response.status, 200); assert.equal(up.calls(), 1);
  const table = loadTable(path.join(dir, candidates(dir)[0]));
  assert.deepEqual(table.items['app.decide'], {[keyFor('Zurich', task, 'photographer')]: entry('Zurich', 'other')});
});

test('modelFetch reuses the stored Messages wrapper before engine selection', async t => {
  const {env} = fixture(t, {[keyFor('Zurich')]: entry('Zurich', 'switzerland')});
  const response = await modelFetch('http://127.0.0.1:1/v1/messages', init(request(['Zurich'])), {env, engine: () => { throw new Error('must not choose engine'); }});
  assert.deepEqual(await response.json(), message(JSON.stringify(results(['switzerland']))));
});
