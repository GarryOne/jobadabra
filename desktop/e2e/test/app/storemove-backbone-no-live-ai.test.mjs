// Prove storemove keeps its original lines with stored AI answers and no live key or transport.
import {loadAppModule} from '../../lib/app-module.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {loadTable, questionOf, storedAnswer} from '../../lib/ai-answers.mjs';
import {answersTableFile, backboneHarness} from '../../lib/backbone-harness.mjs';
import {requestKey} from '../../lib/ai-meter.mjs';
import {modelFetch} from '../../lib/model.mjs';
const {judge} = await loadAppModule('profile-move.js');
const {judgeNew} = await loadAppModule('details-review.js');
import {createStorage} from '../../../lib/storage.js';

const {request: captured} = JSON.parse(fs.readFileSync(new URL('../../fixtures/golden/storemove-organize-ask.json', import.meta.url), 'utf8'));
const data = JSON.parse(captured.messages[0].content);
const background = ['contact_asks', 'missing_facts_wording', 'covered_facts', 'reuse_verdict', 'question_formats'];
const request = (action, body = {model: 'test', messages: [{role: 'user', content: 'Background read'}]}) => ({
  method: 'POST', headers: {'content-type': 'application/json', 'x-jp-action': action}, body: JSON.stringify(body),
});
const harness = (t, family) => backboneHarness(t, 'storemove', family);

for (const family of ['claude', 'openai']) test(`storemove captured organize_lines resolves at every ${family} seam`, async t => {
  const h = await harness(t, family), table = loadTable(answersTableFile);
  const body = family === 'openai' ? {model: captured.model, instructions: captured.system, input: captured.messages,
    text: {format: captured.output_config.format}} : captured;
  const init = request('organize_lines', body);
  assert.deepEqual(questionOf(init, h.env, table), {operation: 'app.kind', id: 'organize_lines'});
  const found = storedAnswer(init, h.env);
  assert.deepEqual(JSON.parse(found.reply.content[0].text), {items: []});
  const schema = captured.output_config.format.schema;
  assert.deepEqual(schema.required, ['items']);
  assert.equal(schema.properties.items.type, 'array');
  assert.equal(schema.properties.items.minItems, undefined, 'the product accepts no routing proposals');
  assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), found.reply);
  const url = family === 'openai' ? `${h.openaiProxy.url}/v1/responses` : `${h.proxy.url}/v1/messages`;
  const response = await h.localFetch(url, init);
  assert.equal(response.status, 200);
  const reply = await response.json();
  assert.deepEqual(JSON.parse(family === 'openai' ? reply.output[0].content[0].text : reply.content[0].text), {items: []});
  h.assertNoLive();
});

test('storemove real organizer rebuilds the captured request and accepts the empty stored verdict', async t => {
  const h = await harness(t), asked = [];
  const client = {messages: {create: async (body, options) => {
    asked.push(body);
    assert.equal(options.headers['x-jp-action'], 'organize_lines');
    return storedAnswer(request('organize_lines', body), h.env).reply;
  }}};
  const items = data.items.map(({id, line, context: [page, ...context]}) => ({id, page, context, value: line}));
  assert.deepEqual(await judge(items, {client}, {destinations: data.destinations}), new Map());
  assert.deepEqual(asked, [captured]);
  h.assertNoLive();
});

test('storemove saved-line checks keep the same key and original texts at two dates and profile paths', async t => {
  const h = await harness(t), keys = [], bodies = [];
  const texts = {profile: `# Profile\n\n${data.items[0].line}\n\n${data.items[1].line}\n`, answers: `# Answers\n\n${data.items[2].line}\n`};
  for (const [index, date] of ['2026-10-30T01:00:00Z', '2027-01-02T23:00:00Z'].entries()) {
    const storage = createStorage(path.join(h.env.E2E_ARTIFACTS, `install-${index}`), {encrypt: value => value, decrypt: value => value});
    storage.saveSettings({store: 'sqlite'});
    for (const [page, text] of Object.entries(texts)) storage.writeText(`${page}.md`, text);
    const client = {messages: {create: async (body, options) => {
      const init = request(options.headers['x-jp-action'], body);
      keys.push(questionOf(init, h.env)); bodies.push(body);
      return storedAnswer(init, h.env).reply;
    }}};
    const result = await judgeNew(storage, {ai: {client}, now: new Date(date), copy: () => assert.fail('no routing proposal may copy or move the originals')});
    assert.deepEqual(result, {judged: 3, queued: 0, unclear: 0});
    for (const [page, text] of Object.entries(texts)) assert.equal(storage.readText(`${page}.md`), text);
  }
  assert.deepEqual(keys, [{operation: 'app.kind', id: 'organize_lines'}, {operation: 'app.kind', id: 'organize_lines'}]);
  assert.deepEqual(bodies[0], bodies[1], 'the caller does not put its clock or profile path in the request');
  const changed = structuredClone(captured), lines = JSON.parse(changed.messages[0].content);
  lines.items.forEach((line, index) => { line.id = `${line.context[0]}:other-install-block-${index}`; });
  changed.messages[0].content = JSON.stringify(lines);
  assert.notEqual(changed.messages[0].content, captured.messages[0].content);
  assert.notEqual(requestKey('/v1/messages', JSON.stringify(changed)), requestKey('/v1/messages', JSON.stringify(captured)), 'the old byte replay misses when Notion block IDs change');
  assert.deepEqual(questionOf(request('organize_lines', changed), h.env), keys[0], 'random Notion IDs do not enter the declared-kind key');
  assert.deepEqual(JSON.parse(storedAnswer(request('organize_lines', changed), h.env).reply.content[0].text), {items: []});
  h.assertNoLive();
});

test('storemove background reads resolve their existing declared answers before live AI', async t => {
  const h = await harness(t);
  for (const kind of background) {
    const init = request(kind);
    assert.deepEqual(questionOf(init, h.env), {operation: 'app.kind', id: kind});
    assert.deepEqual(storedAnswer(init, h.env), {refuse: 'invalid-key'});
    await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), /invalid-key/);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 401, kind);
  }
  h.assertNoLive();
});

for (const family of ['claude', 'openai']) test(`storemove names an undeclared kind at every ${family} seam`, async t => {
  const h = await harness(t, family), body = family === 'openai' ? {model: 'test', input: 'unknown ask'} : undefined;
  const init = request('undeclared_storemove_kind', body);
  const missing = {code: 'E2E_AI_ANSWER_MISSING', message: /storemove: undeclared_storemove_kind.*is unkeyable/};
  assert.throws(() => storedAnswer(init, h.env), missing);
  await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), missing);
  const url = family === 'openai' ? `${h.openaiProxy.url}/v1/responses` : `${h.proxy.url}/v1/messages`;
  const response = await h.localFetch(url, init);
  assert.equal(response.status, 503);
  const {error} = await response.json();
  assert.equal(error.code, missing.code);
  assert.match(error.message, missing.message);
  h.assertNoLive();
});

test('storemove declares offline AI and uses backbone on both workflow attempts', () => {
  const source = fs.readFileSync(new URL('../../suites/storemove.mjs', import.meta.url), 'utf8');
  assert.match(source, /^export const offlineAi = true;/m);
  assert.match(source, /^export const realAi = false;/m);
  // The suite declares it; every workflow reads it from the matrix (plan-run.mjs, tests/test_workflow_ai_answers.py; beta 41078746088: a hand-kept list drifted).
  assert.match(fs.readFileSync(new URL('../../suites/storemove.mjs', import.meta.url), 'utf8'), /^export const aiAnswers = 'backbone';/m);
});
