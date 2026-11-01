// Place answers replay by exact location and places version, independently of batch and persona.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {contextCase, familyTests} from '../ai-answers-engine-fixtures.mjs';
import {answerFor, keepCandidate, keepCandidateBody, loadTable, questionOf, recordCandidate, refusedQuestions, storedAnswer} from '../../lib/ai-answers.mjs';
import {message, responseOf, startAiProxy, streamOf} from '../../lib/ai-proxy.mjs';
import {keep, requestKey} from '../../lib/ai-meter.mjs';
import {modelFetch} from '../../lib/model.mjs';
import {assertNoRealAi, runAiGuards} from '../../lib/no-real-ai.mjs';

// Read literals through AST only: importing the engine would open configuration and data paths.
const source = fileURLToPath(new URL('../../../../src/ai/place_triage.py', import.meta.url));
const {SYSTEM, SCHEMA} = JSON.parse(execFileSync('python3', ['-c', `import ast,json,sys
module=ast.parse(open(sys.argv[1]).read())
print(json.dumps({n.targets[0].id:ast.literal_eval(n.value) for n in module.body if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id in ('SYSTEM','SCHEMA')}))`, source], {encoding: 'utf8'}));
const places = {best_places: ['Zurich'], anywhere_in: ['Switzerland'], cities_abroad: [], remote_jobs: 'yes', remote_limited_to_regions_they_cannot_work_from: ['Americas']};
const zurich = {where: 'Zurich', country: 'Switzerland', nearest: 'Zurich', km: 0, answer: 'best'};
const paris = {where: 'Paris', country: 'France', nearest: 'Zurich', km: 600, answer: 'out'};
const canonical = value => JSON.stringify(value, (_key, part) => part && typeof part === 'object' && !Array.isArray(part) ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]])) : part);
const sha = text => createHash('sha256').update(text).digest('hex');
const keyFor = (text, words = places, persona = 'default') => `${persona}/places-${sha(canonical(words)).slice(0, 12)}/${sha(text)}`;
const entries = () => ({[keyFor('zurich, switzerland')]: {text: 'zurich, switzerland', answer: zurich}, [keyFor('Paris')]: {text: 'Paris', answer: paris}});
function request(texts = ['zurich, switzerland', 'Paris'], shape = 'anthropic', words = places) {
  const content = `Their places (JSON): ${JSON.stringify(words)}\nThe job locations:\n${texts.map((text, i) => `${i + 1}. ${text}`).join('\n')}`;
  return shape === 'anthropic' ? {model: 'test', max_tokens: 4000, system: [{type: 'text', text: SYSTEM}], messages: [{role: 'user', content}], output_config: {format: {type: 'json_schema', schema: structuredClone(SCHEMA)}, effort: 'low'}} :
    {model: 'test', instructions: SYSTEM, prompt_cache_key: 'job-pilotto-place_triage', input: [{role: 'user', content: [{type: 'input_text', text: content}]}], text: {format: {type: 'json_schema', schema: structuredClone(SCHEMA)}}};
}
const init = (body, action = 'place_triage') => ({method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': action}, body: JSON.stringify(body)});
const question = (body, env = {}, action = 'place_triage') => questionOf({headers: {'x-jp-action': action}, body}, env);
const batch = answers => ({locations: answers.map((answer, i) => ({n: i + 1, ...answer}))});
const candidates = dir => fs.readdirSync(dir).filter(name => name.startsWith('ai-answers-item-'));
function fixture(t, items = {}, mode = 'backbone') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'place-answers-')), file = path.join(dir, 'table.json');
  fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, items: {'app.place': items}}));
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

test('real engine request shape keys exact locations and canonical places, with both action labels', () => {
  for (const shape of ['anthropic', 'openai']) for (const action of ['scout', 'place_triage']) {
    const body = request(undefined, shape), found = question(body, {}, action);
    assert.equal(found.operation, 'app.place');
    assert.deepEqual(found.items.map(({n, text, key}) => ({n, text, key})), [
      {n: 1, text: 'zurich, switzerland', key: keyFor('zurich, switzerland')}, {n: 2, text: 'Paris', key: keyFor('Paris')},
    ]);
  }
  const changed = request(); changed.model = 'other'; changed.system[0].text += ' More wording.';
  const words = Object.fromEntries(Object.entries(places).reverse());
  changed.messages[0].content = request(undefined, 'anthropic', words).messages[0].content.replace(JSON.stringify(words), JSON.stringify(words, null, 2));
  assert.equal(question(changed).items[0].key, keyFor('zurich, switzerland'));
  assert.notEqual(question(request(['Zurich, Switzerland'])).items[0].key, keyFor('zurich, switzerland'));
  assert.notEqual(question(request(undefined, 'anthropic', {...places, remote_jobs: 'no'})).items[0].key, keyFor('zurich, switzerland'));
  assert.equal(questionOf({body: request(['Paris'], 'openai')}, {}).items[0].key, keyFor('Paris'));
});

test('other scout asks and malformed place layouts/schema remain unkeyable', () => {
  const changes = [
    b => { b.system[0].text = 'You turn the place words of a job search into places.'; },
    b => { delete b.output_config; },
    b => { b.messages[0].content = b.messages[0].content.replace('Their places (JSON):', 'Places:'); },
    b => { b.messages[0].content = b.messages[0].content.replace('2. Paris', '3. Paris'); },
    b => { b.messages[0].content = b.messages[0].content.replace(JSON.stringify(places), 'null'); },
    b => { b.messages = [null]; }, b => { b.system = [null]; },
    b => { b.messages[0].content = [null]; },
    b => { b.output_config.format.schema.properties.locations.items.properties.km.type = 'string'; },
    b => { b.output_config.format.schema.properties.locations.items.properties.answer.enum.push('unclear'); },
    b => { b.output_config.format.schema.properties.locations.items.required.pop(); },
  ];
  for (const change of changes) { const body = request(); change(body); assert.ok(question(body, {}, 'scout').unkeyable); }
  for (const texts of [[], ['Paris\n1. Ambiguous'], Array(31).fill('Paris')]) assert.ok(question(request(texts)).unkeyable);
});

test('a recognized place SYSTEM preserves the missing-schema refusal before any transport', t => {
  const {env} = fixture(t);
  for (const shape of ['anthropic', 'openai']) {
    const body = request(undefined, shape);
    delete body.output_config; delete body.text;
    for (const action of ['scout', 'place_triage', '']) {
      const ask = {headers: action ? {'x-jp-action': action} : {}, body};
      assert.throws(() => storedAnswer(ask, env), error => {
        assert.equal(error.code, 'E2E_AI_ANSWER_MISSING');
        assert.match(error.message, /app\.place: missing place-triage schema/);
        assert.doesNotMatch(error.message, /question identity is not in the request/);
        return true;
      });
    }
  }
});

test('place item table validates exact answer fields, enum and integer km', t => {
  const {file} = fixture(t);
  const bad = [{answer: zurich}, {text: 2, answer: zurich}, {text: 'Paris', answer: 'out'}, ...[
    {...paris, km: 2.5}, {...paris, answer: 'unclear'}, {...paris, country: null}, {...paris, n: 1},
    Object.fromEntries(Object.entries(paris).filter(([k]) => k !== 'nearest')),
  ].map(answer => ({text: 'Paris', answer}))];
  for (const entry of bad) {
    fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, items: {'app.place': {bad: entry}}}));
    assert.throws(() => loadTable(file), /AI answers/);
  }
  fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, items: {'app.place': entries()}}));
  assert.deepEqual(loadTable(file).items['app.place'], entries());
});

test('batch reply uses request order/numbering and names a missing exact location', () => {
  const table = {answers: {}, items: {'app.place': entries()}};
  for (const [texts, answers] of [[['Paris', 'zurich, switzerland'], [paris, zurich]], [['Paris'], [paris]]]) {
    assert.deepEqual(JSON.parse(answerFor(question(request(texts)), table).reply.content[0].text), batch(answers));
  }
  assert.match(answerFor(question(request(['Rome'])), table).missing, /^app.place location "Rome" .*key /);
  const wrongText = entries(); wrongText[keyFor('Paris')].text = 'paris';
  assert.match(answerFor(question(request(['Paris'])), {answers: {}, items: {'app.place': wrongText}}).missing, /location "Paris"/);
});

for (const shape of ['anthropic', 'openai']) test(`${shape}: proxy and model seam refuse missing location before cache/relay/engine; suite registry retains its name`, async t => {
  const {env, dir} = fixture(t, entries()), body = request(['Paris', 'Rome'], shape);
  const pathname = shape === 'openai' ? '/v1/responses' : '/v1/messages';
  assert.throws(() => storedAnswer({url: pathname, headers: init(body).headers, body}, env), {code: 'E2E_AI_ANSWER_MISSING', message: /app.place location "Rome"/});
  keep(requestKey(pathname, Buffer.from(JSON.stringify(body))), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(message('cached')))});
  const up = await upstream(t, message('must not call')), proxy = await proxyFor(t, {target: up.url, shape, relay: () => { throw new Error('must not relay'); }});
  const response = await fetch(`${proxy.url}${pathname}`, init(body));
  assert.equal(response.status, 503); const error = (await response.json()).error;
  assert.equal(error.code, 'E2E_AI_ANSWER_MISSING'); assert.match(error.message, /app.place location "Rome"/);
  await assert.rejects(modelFetch(`${up.url}${pathname}`, init(body), {env, engine: () => { throw new Error('must not select engine'); }}), /app.place location "Rome"/);
  const ctx = {ARTIFACTS: dir, proxy, openaiProxy: null};
  await runAiGuards({realAi: false}, ctx, async (_name, check) => check());
  assertNoRealAi(ctx); assert.equal(up.calls(), 0); assert.equal(proxy.stats.paid || 0, 0);
  const refused = refusedQuestions(env);
  assert.equal(refused.length, 3); for (const row of refused) assert.match(row.message, /app.place location "Rome"/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'ai-answer-refusals.json'))), refused);
});

for (const shape of ['anthropic', 'openai']) test(`${shape}: stored locations replay through proxy and model without a live call`, async t => {
  const {env, dir} = fixture(t, entries()), up = await upstream(t, message('must not call'));
  const proxy = await proxyFor(t, {target: up.url, shape});
  const body = request(['Paris'], shape), pathname = shape === 'openai' ? '/v1/responses' : '/v1/messages';
  const expected = JSON.stringify(batch([paris]));
  assert.deepEqual(await (await fetch(`${proxy.url}${pathname}`, init(body))).json(), shape === 'openai' ? responseOf(expected) : message(expected));
  assert.deepEqual(await (await modelFetch(`${up.url}${pathname}`, init(body), {env, engine: () => { throw new Error('must not select engine'); }})).json(), message(expected));
  assert.equal(up.calls(), 0); assert.deepEqual(candidates(dir), []);
});

for (const shape of ['anthropic', 'openai']) test(`${shape}: record path writes reviewable per-location candidates from a local fake answer`, async t => {
  const {dir, file} = fixture(t, {}, 'record'), body = request(undefined, shape);
  const data = {locations: [{n: 2, ...paris}, {n: 1, ...zurich}]};
  const reply = shape === 'openai' ? responseOf(JSON.stringify(data)) : message(JSON.stringify(data));
  const up = await upstream(t, reply), proxy = await proxyFor(t, {target: up.url, shape});
  const pathname = shape === 'openai' ? '/v1/responses' : '/v1/messages';
  keep(requestKey(pathname, Buffer.from(JSON.stringify(body))), {status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(message('warm')))});
  assert.deepEqual(await (await fetch(`${proxy.url}${pathname}`, init(body))).json(), reply);
  assert.equal(up.calls(), 1); assert.equal(candidates(dir).length, 2);
  const recorded = Object.assign({}, ...candidates(dir).map(name => loadTable(path.join(dir, name)).items['app.place']));
  assert.deepEqual(recorded, entries()); assert.deepEqual(loadTable(file).items, {'app.place': {}});
  assert.deepEqual(JSON.parse(answerFor(question(request(['Paris'])), {answers: {}, items: {'app.place': recorded}}).reply.content[0].text), batch([paris]));
});

test('model record seam also writes a candidate from a local fake reply', async t => {
  const {dir, file, env} = fixture(t, {}, 'record'), body = request(['Paris']);
  const up = await upstream(t, message(JSON.stringify(batch([paris]))));
  const response = await modelFetch(`${up.url}/v1/messages`, init(body), {env, engine: () => 'api'});
  assert.equal(response.status, 200); assert.equal(up.calls(), 1);
  assert.equal(candidates(dir).length, 1);
  assert.deepEqual(loadTable(path.join(dir, candidates(dir)[0])).items['app.place'], {[keyFor('Paris')]: {text: 'Paris', answer: paris}});
  assert.deepEqual(loadTable(file).items, {'app.place': {}});
});

test('invalid or partial record replies write no candidates; completed streams use the same validation', t => {
  const {dir} = fixture(t), found = question(request());
  const invalid = [
    {locations: [{n: 1, ...zurich}]}, {locations: [{n: 1, ...zurich}, {n: 1, ...paris}]},
    {locations: [{n: 1, ...zurich}, {n: 3, ...paris}]}, {locations: [{n: 1, ...zurich}, {n: '2', ...paris}]},
    {locations: [{n: 1, ...zurich}, {n: 2, ...paris, km: 0.1}]},
    {locations: [{n: 1, ...zurich}, {n: 2, ...paris, answer: 'unclear'}]},
    {...batch([zurich, paris]), extra: true},
  ];
  for (const bad of invalid) recordCandidate(dir, found, message(JSON.stringify(bad)));
  recordCandidate(dir, found, {...message(JSON.stringify(batch([zurich, paris]))), stop_reason: 'max_tokens'});
  assert.deepEqual(candidates(dir), []);
  const state = {mode: 'record', question: found, dir};
  keepCandidateBody(state, streamOf(JSON.stringify(batch([zurich, paris]))));
  assert.equal(candidates(dir).length, 2);
});

test('persona and changed places cannot borrow default answers; candidates preserve their own keys', t => {
  const {env, dir} = fixture(t, entries());
  for (const [body, scoped] of [[request(['Paris']), {...env, E2E_QUALITY_PERSONA: 'photographer'}], [request(['Paris'], 'anthropic', {...places, remote_jobs: 'no'}), env]]) {
    assert.throws(() => storedAnswer({headers: init(body).headers, body}, scoped), /app.place location "Paris"/);
    const state = storedAnswer({headers: init(body).headers, body}, {...scoped, E2E_AI_ANSWERS: 'record'});
    keepCandidate(state, message(JSON.stringify(batch([paris]))));
  }
  const all = Object.assign({}, ...candidates(dir).map(name => loadTable(path.join(dir, name)).items['app.place']));
  assert.deepEqual(Object.keys(all).sort(), [keyFor('Paris', places, 'photographer'), keyFor('Paris', {...places, remote_jobs: 'no'})].sort());
});

test('print distinct golden truth locations and current reviewed app.place row count for the supervisor', () => {
  const table = loadTable(), truth = JSON.parse(fs.readFileSync(new URL('../../fixtures/golden/truth.json', import.meta.url)));
  const locations = [...new Set(truth.map(row => row.location).filter(text => typeof text === 'string'))].sort();
  const sent = [...new Set(locations.map(text => text.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 120)))];
  console.log(`Golden location strings (${locations.length}): ${JSON.stringify(locations)}; normalized request strings (${sent.length}): ${JSON.stringify(sent)}; committed app.place rows: ${Object.keys(table.items?.['app.place'] || {}).length}`);
});

familyTests(['visa', 'vague', 'reading']);

contextCase('visa', body => { body.messages[0].content = body.messages[0].content.replace('Swiss citizenship', 'EU citizenship'); });
contextCase('vague', body => { body.messages[0].content = body.messages[0].content.replace('zurich', 'geneva'); });
contextCase('reading', body => { body.messages[0].content = body.messages[0].content.replace('zurich', 'geneva'); });
