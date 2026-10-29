// Prove stores' declared background kinds refuse at every seam without a key or live transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {loadTable, storedAnswer} from '../lib/ai-answers.mjs';
import {FAILURES} from '../lib/ai-proxy.mjs';
import {contextAiKeys, contextAiProxies} from '../lib/context.mjs';
import {modelFetch} from '../lib/model.mjs';
import {assertNoRealAi} from '../lib/no-real-ai.mjs';

const tableFile = fileURLToPath(new URL('../fixtures/golden/ai-answers.json', import.meta.url));
const kinds = ['organize_lines', 'answer_home', 'contact_asks', 'missing_facts_wording', 'covered_facts',
  'reuse_verdict', 'question_formats', 'contact_from_cv', 'cv_queue', 'places', 'field_redraft'];

async function harness(t, family = 'claude') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stores-backbone-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const env = {CI: 'true', E2E_AI_ANSWERS: 'backbone', E2E_AI_ANSWERS_FILE: tableFile, E2E_ARTIFACTS: dir,
    E2E_SUITE: 'stores', E2E_AI_REPLAY: '1', E2E_AI_CACHE: dir, E2E_QUALITY_PERSONA: '', E2E_AI_PROVIDER: 'codex'};
  const saved = {...process.env};
  for (const key of Object.keys(process.env)) if (/^(E2E_|CI_AI_PROVIDER)/.test(key)) delete process.env[key];
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, saved); });
  let networkCalls = 0, engines = 0;
  const localFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', () => { networkCalls++; assert.fail('backbone must never reach a transport or relay'); });
  const keys = await contextAiKeys({offlineAi: true, family, engine: 'api'});
  assert.deepEqual(keys.needsKey, []);
  const proxies = await contextAiProxies({offlineAi: true, family});
  t.after(async () => { await proxies.openaiProxy?.close(); await proxies.proxy.close(); });
  assert.equal(proxies.proxy.canned(), null, 'backbone must consult the table rather than the blanket offline stand-in');
  return {...proxies, env, localFetch, options: {env, engine: () => { engines++; assert.fail('must not select an engine'); }},
    assertNoLive: () => {
      assert.equal(networkCalls, 0); assert.equal(engines, 0);
      assert.equal(proxies.proxy.stats.paid || 0, 0);
      assertNoRealAi(proxies);
    }};
}

const request = action => ({method: 'POST', headers: {'content-type': 'application/json', ...(action ? {'x-jp-action': action} : {})},
  body: JSON.stringify({model: 'test', messages: [{role: 'user', content: 'What is your notice period?: Three months, negotiable'}]})});

test('stores declares all eleven background kinds, refused before live AI at every seam', async t => {
  const h = await harness(t), table = loadTable(tableFile);
  assert.deepEqual(Object.keys(table.kinds).sort(), [...kinds].sort());
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
