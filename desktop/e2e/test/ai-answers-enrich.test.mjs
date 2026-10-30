// Engine answer identities, validation and recording for the enrich question family.
import {familyTests} from './ai-answers-engine-fixtures.mjs';
familyTests(["enrich", "enrich retry", "enrich role"]);

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {questionOf, storedAnswer} from '../lib/ai-answers.mjs';
import {message, responseOf, startAiProxy} from '../lib/ai-proxy.mjs';
import {modelFetch} from '../lib/model.mjs';
import {engineCases, askOf, bodyOf, tempTable} from './ai-answers-engine-fixtures.mjs';
test('full extraction, narrowed retry and role refinement cannot borrow rows', () => {
  const cases = engineCases.filter(c => c.operation === 'app.enrich');
  assert.deepEqual(cases.map(c => questionOf(askOf(c), {}).items[0].key), ['default/app.enrich/4adb0a78f6a6472194fb31f117b30922a2e4b5e06a4ac809243ffee49a376e09/full', 'default/app.enrich/4adb0a78f6a6472194fb31f117b30922a2e4b5e06a4ac809243ffee49a376e09/retry-seniority,technologies', 'default/app.enrich/4adb0a78f6a6472194fb31f117b30922a2e4b5e06a4ac809243ffee49a376e09/role']);
});

const feed = {title: 'Site Reliability Engineer', company: 'Acme', location: 'Zurich'};
// Independently hash the canonical tuple, with property names in alphabetical order.
const digest = createHash('sha256').update(JSON.stringify({company: 'Acme', location: 'Zurich', title: 'Site Reliability Engineer'})).digest('hex');
const feedKey = variant => `default/app.enrich/${digest}/${variant}`;
const full = engineCases.find(c => c.name === 'enrich');
const retryFields = ['seniority', 'work_mode'];
const retry = {...full, schema: {...full.schema, required: retryFields, properties: Object.fromEntries(retryFields.map(name => [name, full.schema.properties[name]]))},
  reply: {seniority: full.reply.seniority, work_mode: full.reply.work_mode}};
const variants = [['full', full], ['role', engineCases.find(c => c.name === 'enrich role')], ['retry-seniority,work_mode', retry]];
const feedCase = (c, posting = feed) => ({...c, user: `Title: ${posting.title}\nCompany: ${posting.company}\nLocation: ${posting.location}\n\nPosting:\nAn independently supplied feed posting.`});
const truthFile = new URL('../fixtures/golden/truth.json', import.meta.url);
const truth = JSON.parse(fs.readFileSync(truthFile, 'utf8'));

for (const [variant, c] of variants) test(`feed ${variant}: tuple key survives becoming golden and respects persona and trimming`, t => {
  assert.ok(!truth.some(row => row.title === feed.title && row.company === feed.company && row.location === feed.location));
  const keys = [];
  for (const persona of ['', 'photographer']) {
    for (const posting of [feed, {title: ` ${feed.title} `, company: ` ${feed.company} `, location: ` ${feed.location} `}]) {
      const q = questionOf(askOf(c, bodyOf(feedCase(c, posting))), {E2E_QUALITY_PERSONA: persona});
      assert.equal(q.operation, 'app.enrich');
      assert.equal(q.items[0].key, `${persona || 'default'}/app.enrich/${digest}/${variant}`);
      keys.push(q.items[0].key);
    }
  }
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => String(file) === String(truthFile) ? JSON.stringify([...truth, {...feed, id: 9999}]) : read(file, ...args));
  assert.equal(questionOf(askOf(c, bodyOf(feedCase(c))), {}).items[0].key, keys[0]);
});

test('enrich refuses an identity matching two golden rows for every variant', t => {
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => String(file) === String(truthFile) ? JSON.stringify([...truth, {...truth[0], id: 9999}]) : read(file, ...args));
  for (const [, c] of variants) assert.deepEqual(questionOf(askOf(c), {}), {unkeyable: 'app.enrich: posting identity matches more than one golden row'});
});

for (const [variant, c] of variants) for (const shape of ['anthropic', 'openai']) test(`feed ${variant} ${shape}: named misses cannot borrow golden rows; stored rows serve at all three seams`, async t => {
  const golden = questionOf(askOf(c), {}).items[0];
  const rows = {[golden.key]: {text: golden.text, answer: c.reply}};
  const {file, env} = tempTable(t, {'app.enrich': rows});
  const saved = {...process.env}; Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  let live = 0, engines = 0, relays = 0;
  const upstream = http.createServer((_req, res) => { live++; res.writeHead(500); res.end('forbidden live call'); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => { upstream.closeAllConnections(); return new Promise(resolve => upstream.close(resolve)); });
  const url = `http://127.0.0.1:${upstream.address().port}`;
  const proxy = await startAiProxy({target: url, shape, relay: () => { relays++; throw new Error('must not relay'); }});
  t.after(() => proxy.close());
  const body = bodyOf(feedCase(c), shape), pathname = shape === 'openai' ? '/v1/responses' : '/v1/messages';
  const init = {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)};
  const ask = {url: pathname, headers: init.headers, body};
  const options = {env, engine: () => { engines++; throw new Error('must not select engine'); }};
  const named = error => {
    assert.equal(error.code, 'E2E_AI_ANSWER_MISSING');
    assert.ok(error.message.includes(`app.enrich posting "Site Reliability Engineer" key ${feedKey(variant)} has no stored answer`));
    return true;
  };
  assert.throws(() => storedAnswer(ask, env), named);
  await assert.rejects(modelFetch(`${url}${pathname}`, init, options), named);
  const missing = await fetch(`${proxy.url}${pathname}`, init);
  assert.equal(missing.status, 503); named((await missing.json()).error);
  rows[feedKey(variant)] = {text: `${feed.title}\n${feed.company}\n${feed.location}`, answer: c.reply};
  fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, items: {'app.enrich': rows}}));
  for (const mode of ['off', 'backbone', 'record']) {
    env.E2E_AI_ANSWERS = process.env.E2E_AI_ANSWERS = mode;
    const expected = JSON.stringify(c.reply);
    assert.deepEqual(storedAnswer(ask, env), {reply: message(expected)});
    assert.deepEqual(await (await modelFetch(`${url}${pathname}`, init, options)).json(), message(expected));
    const response = await fetch(`${proxy.url}${pathname}`, init);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), shape === 'openai' ? responseOf(expected) : message(expected));
  }
  assert.equal(live, 0); assert.equal(engines, 0); assert.equal(relays, 0); assert.equal(proxy.stats.paid || 0, 0);
});
