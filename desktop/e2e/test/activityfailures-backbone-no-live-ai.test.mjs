// Prove activityfailures uses stored decide answers and declared refusals without a live key or AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {answerFor, loadTable, questionOf, storedAnswer} from '../lib/ai-answers.mjs';
import {canonical, hash, valid} from '../lib/ai-answers-engine-items.mjs';
import {FAILURES} from '../lib/ai-proxy.mjs';
import {answersTableFile, backboneHarness} from '../lib/backbone-harness.mjs';
import {modelFetch} from '../lib/model.mjs';
import {bodyOf, engineCases} from './ai-answers-engine-fixtures.mjs';

const {request: captured, requests: capturedMore} = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/activityfailures-decide.json', import.meta.url), 'utf8'));
// organize_lines is authored (empty items) since wander (30 Oct 2026); activityfailures asks it too and gets that reply.
const kinds = ['contact_asks', 'covered_facts', 'reuse_verdict', 'field_redraft', 'places'];
const expected = [['z[uü]rich', 'ch-zurich'], ['switzerland', 'none'], ['schweiz', 'none']];
const results = {results: [{index: 0, answer: 'ch-zurich'}, {index: 1, answer: 'none'}, {index: 2, answer: 'none'}]};
const request = (action, body = {model: 'test', messages: [{role: 'user', content: 'Background read'}]}) => ({
  method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': action}, body: JSON.stringify(body),
});

const harness = (t, family) => backboneHarness(t, 'activityfailures', family);
const feedAsks = JSON.parse(fs.readFileSync(new URL('../fixtures/golden/activityfailures-feed-asks.json', import.meta.url), 'utf8'));
// Read only Python literal schema assignments: never import the engine, its configuration or its data.
const scoreSchema = JSON.parse(execFileSync('python3', ['-c', `import ast,json,sys
from pathlib import Path
root=Path(sys.argv[1]); env={}
for file,names in [('src/ai/score.py',{'_component','_open_component','SCHEMA'}),('src/ai/score_search.py',{'PART'})]:
 for n in ast.parse((root/file).read_text()).body:
  if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id in names and not isinstance(n.value,ast.Call):
   exec(compile(ast.Module(body=[n],type_ignores=[]),file,'exec'),env)
schema=env['SCHEMA']; schema['required'].append('search'); schema['properties']['search']=env['PART']
print(json.dumps(schema))`, fileURLToPath(new URL('../../../', import.meta.url))], {encoding: 'utf8'}));
const validScore = (schema, value) => {
  if (Array.isArray(schema.type)) return value === null ? schema.type.includes('null') : validScore({...schema, type: schema.type.find(type => type !== 'null')}, value);
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value) && schema.required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => Object.hasOwn(schema.properties, key) && validScore(schema.properties[key], value[key]));
  return schema.type === 'array' ? Array.isArray(value) && value.every(item => validScore(schema.items, item)) : valid(schema, value);
};

const semanticCases = () => {
  const visit = engineCases.find(item => item.name === 'visit'), place = engineCases.find(item => item.name === 'place');
  const {roles, places, unsure} = feedAsks.visit.context;
  assert.equal(unsure, 'keep');
  const sites = feedAsks.visit.question.items.map(item => JSON.parse(item.text));
  return [
    {...visit, user: `Their roles: ${JSON.stringify(roles)}\nTheir places: ${JSON.stringify(places)}\nThe sites:\n${sites.map((site, i) => `${i + 1}. ${site.name} (${site.url}) [${site.kind}]`).join('\n')}`, question: feedAsks.visit.question},
    {...engineCases.find(item => item.name === 'geo'), user: 'Strings:\n1. zürich', question: feedAsks.geo.question},
    {...place, user: `Their places (JSON): ${JSON.stringify(feedAsks.place.context)}\nThe job locations:\n1. ${feedAsks.place.question.items[0].text}`, question: feedAsks.place.question},
    ...feedAsks.feedPostings.map(post => ({...engineCases.find(item => item.name === 'score'),
      name: post.title, user: `Title: ${post.title}\nCompany: ${post.company}\nLocation: ${post.location}\n\nPosting:\n${post.description}`,
      question: {operation: 'app.score', id: post.key}})),
  ];
};

test('activityfailures authored feed rows use qu hashing and the product score schema', () => {
  assert.equal(hash(canonical({title: 'Site Reliability Engineer', company: 'Acme', location: 'Zurich'})), '6d727aecf774959fcd5cd277fd77ff0725faeb664fcae7212bbb083271b024f2');
  const table = loadTable(answersTableFile);
  assert.equal(feedAsks.feedPostings.length, 6);
  assert.equal(feedAsks.feedPostings.filter(post => post.captured).length, 3);
  for (const {title, company, location, key} of feedAsks.feedPostings) {
    assert.equal(key, `feed/${hash(canonical({title: title.trim(), company: company.trim(), location: location.trim()}))}`);
    const {reply} = answerFor({operation: 'app.score', id: key}, table);
    assert.ok(reply, `missing pre-authored row ${key}`);
    const data = JSON.parse(reply.content[0].text);
    assert.ok(validScore(scoreSchema, data), `product score schema: ${key}`);
    assert.equal(data.components.compensation, null);
    assert.deepEqual(data.basis, {salary_stated: false, level_stated: true, one_job: true});
    assert.equal(data.search.career_change, false);
    assert.ok(data.reason.length <= 90);
    assert.ok(data.search.cv_gap.length <= 90);
    for (const number of [data.score, data.search.fit, ...Object.values(data.components).filter(value => value !== null)]) assert.ok(number >= 0 && number <= 100);
    for (const values of [data.strengths, data.gaps]) assert.ok(values.length <= 3);
  }
});

for (const family of ['claude', 'openai']) test(`activityfailures CI asks resolve at every ${family} seam`, async t => {
  const h = await harness(t, family), table = loadTable(answersTableFile);
  const shape = family === 'openai' ? 'openai' : 'anthropic';
  for (const c of semanticCases()) await t.test(c.name, async () => {
    const init = request(c.action, bodyOf(c, shape)), question = questionOf(init, h.env, table);
    const url = family === 'openai' ? `${h.openaiProxy.url}/v1/responses` : `${h.proxy.url}/v1/messages`;
    assert.deepEqual(question, c.question);
    const expectedReply = answerFor(question, table).reply;
    assert.ok(expectedReply, `missing captured ask ${JSON.stringify(question)}`);
    assert.deepEqual(storedAnswer(init, h.env).reply, expectedReply);
    const direct = await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options);
    assert.deepEqual(await direct.json(), expectedReply);
    const response = await h.localFetch(url, init);
    assert.equal(response.status, 200);
    const reply = await response.json();
    assert.equal(family === 'openai' ? reply.output[0].content[0].text : reply.content[0].text, expectedReply.content[0].text);
  });
  h.assertNoLive();
});

// Removing the captured geo row must fail both provider transports before any live fallback.
for (const family of ['claude', 'openai']) for (const seam of ['direct', 'proxy'])
  test(`activityfailures multi-location geo resolves at ${family} ${seam} seam`, async t => {
    const h = await harness(t, family), table = loadTable(answersTableFile);
    const c = {...engineCases.find(item => item.name === 'geo'),
      user: `Strings:\n1. ${feedAsks.geoAlternatives.question.items[0].text}`};
    const init = request(c.action, bodyOf(c, family === 'openai' ? 'openai' : 'anthropic'));
    assert.deepEqual(questionOf(init, h.env, table), feedAsks.geoAlternatives.question);
    const expected = {places: [{n: 1, kind: 'unknown', cc: '', lat: 0, lon: 0, r_km: 0}]};
    assert.ok(validScore(c.schema, expected), 'unknown reply must satisfy the actual src/geo.py schema');
    if (seam === 'direct') {
      const reply = await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options);
      assert.deepEqual(JSON.parse((await reply.json()).content[0].text), expected);
    } else {
      const url = family === 'openai' ? `${h.openaiProxy.url}/v1/responses` : `${h.proxy.url}/v1/messages`;
      const response = await h.localFetch(url, init);
      assert.equal(response.status, 200);
      const reply = await response.json();
      assert.deepEqual(JSON.parse(family === 'openai' ? reply.output[0].content[0].text : reply.content[0].text), expected);
    }
    h.assertNoLive();
  });

test('activityfailures resolves every captured metro item and its batch before any transport', async t => {
  const h = await harness(t), table = loadTable(answersTableFile);
  const init = request('decide', captured), question = questionOf(init, h.env, table);
  assert.equal(question.operation, 'app.decide');
  assert.deepEqual(question.items.map(item => item.text), expected.map(([text]) => text));
  for (const [index, [text, answer]] of expected.entries()) {
    assert.deepEqual(table.items['app.decide'][question.items[index].key], {text, answer});
    const body = structuredClone(captured);
    body.messages[0].content = `${captured.messages[0].content.split('### Item 0\n')[0]}### Item 0\n${text}`;
    const {reply} = storedAnswer(request('decide', body), h.env);
    assert.deepEqual(JSON.parse(reply.content[0].text), {results: [{index: 0, answer}]});
  }
  const {reply} = storedAnswer(init, h.env);
  assert.deepEqual(JSON.parse(reply.content[0].text), results);
  const direct = await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options);
  assert.deepEqual(JSON.parse((await direct.json()).content[0].text), results);
  const proxied = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
  assert.equal(proxied.status, 200);
  assert.deepEqual(JSON.parse((await proxied.json()).content[0].text), results);
  h.assertNoLive();
});

test('activityfailures resolves captured role and place verdicts per item and batch before any transport', async t => {
  const h = await harness(t), table = loadTable(answersTableFile);
  const titles = ['cloud engineer', 'devops engineer', 'infrastructure engineer', 'platform engineer', 'site reliability engineer', 'systems administrator'];
  const places = ['z[uü]rich', 'switzerland', 'schweiz'];
  const roles = ['site reliability engineer', 'platform engineer', 'devops engineer', 'infrastructure engineer', 'cloud engineer', 'systems administrator'];
  const verdicts = [
    {topic: 'role-kind', texts: titles, answer: 'software'},
    {topic: 'pool-role', texts: roles, answer: 'sre_devops'},
    {topic: 'pool-region', texts: places, answer: 'europe'},
    {topic: 'pool-country', texts: places, answer: 'ch'},
    {topic: 'pool-family', texts: roles, answer: 'sre_devops_cloud'},
  ];
  assert.equal(capturedMore.length, verdicts.length, `captured topics: ${verdicts.map(({topic}) => topic).join(', ')}`);
  for (const [batch, {topic, texts, answer}] of verdicts.entries()) await t.test(topic, async () => {
    const body = capturedMore[batch], init = request('decide', body);
    const question = questionOf(init, h.env, table);
    assert.equal(question.operation, 'app.decide');
    assert.deepEqual(question.items.map(item => item.text), texts);
    for (const item of question.items) {
      assert.deepEqual(table.items['app.decide'][item.key], {text: item.text, answer}, `${topic}: ${item.text}`);
      const single = structuredClone(body);
      single.messages[0].content = `${body.messages[0].content.split('### Item 0\n')[0]}### Item 0\n${item.text}`;
      const {reply} = storedAnswer(request('decide', single), h.env);
      assert.deepEqual(JSON.parse(reply.content[0].text), {results: [{index: 0, answer}]});
    }
    const expectedBatch = {results: texts.map((_text, index) => ({index, answer}))};
    const {reply} = storedAnswer(init, h.env);
    assert.deepEqual(JSON.parse(reply.content[0].text), expectedBatch);
    const direct = await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options);
    assert.deepEqual(JSON.parse((await direct.json()).content[0].text), expectedBatch);
    const proxied = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(proxied.status, 200);
    assert.deepEqual(JSON.parse((await proxied.json()).content[0].text), expectedBatch);
  });
  h.assertNoLive();
});

test('activityfailures refuses every inventoried background kind before live AI at every seam', async t => {
  const h = await harness(t), table = loadTable(answersTableFile);
  for (const kind of kinds) {
    assert.deepEqual(table.kinds[kind], {answer: {refuse: 'invalid-key'}});
    const init = request(kind);
    assert.deepEqual(storedAnswer(init, h.env), {refuse: 'invalid-key'});
    await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), /invalid-key/);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 401, kind);
    assert.deepEqual(await response.json(), {type: 'error', error: {type: 'authentication_error', message: 'invalid x-api-key'}});
  }
  assert.equal(h.proxy.stats.failed, kinds.length);
  assert.deepEqual(JSON.parse(storedAnswer(request('organize_lines'), h.env).reply.content[0].text), {items: []});
  h.assertNoLive();
});

test('activityfailures names an undeclared kind before any live AI', async t => {
  const h = await harness(t), init = request('undeclared_activityfailures_kind');
  const missing = {code: 'E2E_AI_ANSWER_MISSING', message: /activityfailures: undeclared_activityfailures_kind.*is unkeyable/};
  assert.throws(() => storedAnswer(init, h.env), missing);
  await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), missing);
  const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
  assert.equal(response.status, 503);
  const {error} = await response.json();
  assert.equal(error.code, missing.code);
  assert.match(error.message, missing.message);
  h.assertNoLive();
});

test('activityfailures still names an unstored decide item instead of refusing all decide asks', async t => {
  const h = await harness(t), body = structuredClone(captured);
  body.messages[0].content = body.messages[0].content.replace('z[uü]rich', 'a new metro item');
  assert.throws(() => storedAnswer(request('decide', body), h.env), {
    code: 'E2E_AI_ANSWER_MISSING', message: /activityfailures: app.decide item 0 "a new metro item".*has no stored answer/,
  });
  h.assertNoLive();
});

test('activityfailures explicit faults precede stored decide answers and the unkeyable CV ask', async t => {
  const h = await harness(t), init = request('decide', captured);
  for (const mode of ['rate-limit', 'server-error', 'invalid-key', 'no-credit']) {
    h.proxy.setMode(mode);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, FAILURES[mode].status, mode);
    const error = (await response.json()).error;
    assert.equal(error.type, FAILURES[mode].type);
    assert.equal(error.message, FAILURES[mode].message);
  }
  const credit = await h.localFetch(`${h.proxy.url}/v1/messages`, request('tailor'));
  assert.equal(credit.status, FAILURES['no-credit'].status);
  const error = (await credit.json()).error;
  assert.equal(error.type, FAILURES['no-credit'].type);
  assert.equal(error.message, FAILURES['no-credit'].message);
  h.proxy.setMode('pass');
  const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse((await response.json()).content[0].text), results);
  h.assertNoLive();
});

test('activityfailures stored metro answers also resolve through the OpenAI following proxy', async t => {
  const h = await harness(t, 'openai');
  const body = {model: 'test', instructions: captured.system[0].text, input: captured.messages,
    text: {format: captured.output_config.format}};
  const response = await h.localFetch(`${h.openaiProxy.url}/v1/responses`, request('decide', body));
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert.deepEqual(JSON.parse(reply.output[0].content[0].text), results);
  h.assertNoLive();
});

test('activityfailures keeps its offline declaration and no-real-AI guard enabled', () => {
  const source = fs.readFileSync(new URL('../suites/activityfailures.mjs', import.meta.url), 'utf8');
  assert.match(source, /^export const offlineAi = true;/m);
  assert.match(source, /^export const realAi = false;/m);
});
