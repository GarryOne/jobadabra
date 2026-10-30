// Prove stores' declared background kinds resolve at every seam without a key or live transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {loadTable, storedAnswer} from '../lib/ai-answers.mjs';
import {FAILURES} from '../lib/ai-proxy.mjs';
import {answersTableFile, backboneHarness} from '../lib/backbone-harness.mjs';
import {modelFetch} from '../lib/model.mjs';

const kinds = ['contact_asks', 'missing_facts_wording', 'covered_facts', 'reuse_verdict', 'question_formats', 'cv_queue',
  'places', 'field_redraft', 'role_ideas'];
const empty = {organize_lines: {items: []}, answer_home: {items: []}, contact_from_cv: {proposals: []}};

const harness = (t, family) => backboneHarness(t, 'stores', family);

const request = action => ({method: 'POST', headers: {'content-type': 'application/json', ...(action ? {'x-jp-action': action} : {})},
  body: JSON.stringify({model: 'test', messages: [{role: 'user', content: 'What is your notice period?: Three months, negotiable'}]})});

test('the table declares exactly the refused and authored background kinds', () => {
  const table = loadTable(answersTableFile);
  // Why (30 Oct 2026, ap; #2562): the shared table includes interview declarations, Strategy's headerless list_meanings (wander) and applyflows' headerless learn_from_form refusal; list them explicitly so unlisted kinds still fail the exact check.
  assert.deepEqual(Object.keys(table.kinds).sort(), [...kinds, ...Object.keys(empty), 'interview', 'interview_patterns', 'learn_from_form', 'list_meanings'].sort());
});

test('stores background refusals resolve before live AI at every seam', async t => {
  const h = await harness(t), table = loadTable(answersTableFile);
  for (const kind of kinds) {
    const init = request(kind);
    const found = storedAnswer({url: '/v1/messages', ...init}, h.env);
    assert.deepEqual(table.kinds[kind], {answer: {refuse: 'invalid-key'}}, kind);
    assert.ok(FAILURES[found.refuse]);
    assert.deepEqual(found, {refuse: 'invalid-key'}, kind);
    await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), /invalid-key/);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 401, kind);
    assert.deepEqual(await response.json(), {type: 'error', error: {type: 'authentication_error', message: 'invalid x-api-key'}});
  }
  assert.equal(h.proxy.stats.failed, kinds.length);
  h.assertNoLive();
});

test('authored background kinds return their replies rather than refusals at every seam', async t => {
  const h = await harness(t), table = loadTable(answersTableFile);
  for (const [kind, payload] of Object.entries(empty)) {
    const init = request(kind), found = storedAnswer({url: '/v1/messages', ...init}, h.env);
    assert.deepEqual(Object.keys(found), ['reply'], kind);
    assert.deepEqual(found, table.kinds[kind].answer, kind);
    assert.deepEqual(JSON.parse(found.reply.content[0].text), payload, kind);
    assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), found.reply);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 200, kind);
    assert.deepEqual(await response.json(), found.reply);
  }
  assert.equal(h.proxy.stats.failed, 0);
  h.assertNoLive();
});

for (const [action, diagnostic] of [['undeclared_stores_kind', /stores: undeclared_stores_kind.*is unkeyable/], ['', /stores: unknown:.*is unkeyable/]]) {
  test(`stores backbone fails ${action || 'an unlabeled ask'} by name before any live AI`, async t => {
    const h = await harness(t), init = request(action);
    const missing = {code: 'E2E_AI_ANSWER_MISSING', message: diagnostic};
    assert.throws(() => storedAnswer({url: '/v1/messages', ...init}, h.env), missing);
    await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), missing);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 503);
    const {error} = await response.json();
    assert.equal(error.code, missing.code);
    assert.match(error.message, diagnostic);
    h.assertNoLive();
  });
}

test('stores stored refusals keep the OpenAI error shape through its following proxy', async t => {
  const h = await harness(t, 'openai');
  const response = await h.localFetch(`${h.openaiProxy.url}/v1/responses`, request('places'));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'invalid_api_key');
  assert.equal(h.openaiProxy.stats.failed, 1);
  h.assertNoLive();
});

test('stores keeps its offline declaration and the no-real-AI guard enabled', () => {
  const source = fs.readFileSync(new URL('../suites/stores.mjs', import.meta.url), 'utf8');
  assert.match(source, /^export const offlineAi = true;/m);
  assert.match(source, /^export const realAi = false;/m);
});
