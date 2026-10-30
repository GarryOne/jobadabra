// Prove stores' declared background kinds refuse at every seam without a key or live transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {loadTable, storedAnswer} from '../lib/ai-answers.mjs';
import {FAILURES} from '../lib/ai-proxy.mjs';
import {backboneHarness} from '../lib/backbone-harness.mjs';
import {modelFetch} from '../lib/model.mjs';

const tableFile = fileURLToPath(new URL('../fixtures/golden/ai-answers.json', import.meta.url));
const kinds = ['organize_lines', 'answer_home', 'contact_asks', 'missing_facts_wording', 'covered_facts',
  'reuse_verdict', 'question_formats', 'contact_from_cv', 'cv_queue', 'places', 'field_redraft'];

const harness = (t, family) => backboneHarness(t, 'stores', family);

const request = action => ({method: 'POST', headers: {'content-type': 'application/json', ...(action ? {'x-jp-action': action} : {})},
  body: JSON.stringify({model: 'test', messages: [{role: 'user', content: 'What is your notice period?: Three months, negotiable'}]})});

test('stores declares all eleven background kinds, refused before live AI at every seam', async t => {
  const h = await harness(t), table = loadTable(tableFile);
  // Why (29 Oct 2026, ap): the shared table adds interview kinds; stores still requires every background refusal.
  for (const kind of kinds) assert.ok(Object.hasOwn(table.kinds, kind), `${kind} must stay declared`);
  for (const kind of kinds) {
    assert.deepEqual(table.kinds[kind], {answer: {refuse: 'invalid-key'}});
    assert.ok(FAILURES[table.kinds[kind].answer.refuse]);
    const init = request(kind);
    assert.deepEqual(storedAnswer({url: '/v1/messages', ...init}, h.env), {refuse: 'invalid-key'});
    await assert.rejects(modelFetch('http://127.0.0.1:1/v1/messages', init, h.options), /invalid-key/);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 401, kind);
    assert.deepEqual(await response.json(), {type: 'error', error: {type: 'authentication_error', message: 'invalid x-api-key'}});
  }
  assert.equal(h.proxy.stats.failed, kinds.length);
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
  const response = await h.localFetch(`${h.openaiProxy.url}/v1/responses`, request('answer_home'));
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
