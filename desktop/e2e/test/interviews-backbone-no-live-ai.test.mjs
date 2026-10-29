// Prove interview reviews and patterns use declared answers with no live key or AI transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {loadTable, storedAnswer} from '../lib/ai-answers.mjs';
import {DUMMY_KEY} from '../lib/engine.mjs';
import {FAILURES} from '../lib/ai-proxy.mjs';
import {contextAiKeys, contextAiProxies} from '../lib/context.mjs';
import {modelFetch} from '../lib/model.mjs';
import {assertNoRealAi} from '../lib/no-real-ai.mjs';

const tableFile = fileURLToPath(new URL('../fixtures/golden/ai-answers.json', import.meta.url));
const background = ['organize_lines', 'contact_asks', 'covered_facts', 'reuse_verdict', 'field_redraft'];
const captions = ['recruiter-call-gamma', 'E2E Acme · Round 1'];

async function harness(t, family = 'claude') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interviews-backbone-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const env = {CI: 'true', E2E_AI_ANSWERS: 'backbone', E2E_AI_ANSWERS_FILE: tableFile, E2E_ARTIFACTS: dir,
    E2E_ANTHROPIC_KEY: 'revoked', E2E_OPENAI_KEY: 'revoked', E2E_SUITE: 'interviews', E2E_AI_REPLAY: '1', E2E_AI_CACHE: dir, E2E_QUALITY_PERSONA: '', E2E_AI_PROVIDER: 'codex'};
  const saved = {...process.env};
  for (const key of Object.keys(process.env)) if (/^(E2E_|CI_AI_PROVIDER)/.test(key)) delete process.env[key];
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, saved); });
  let networkCalls = 0, engines = 0;
  const localFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', () => { networkCalls++; assert.fail('backbone must never reach a transport or relay'); });
  const keys = await contextAiKeys({offlineAi: true, family, engine: 'api'});
  assert.deepEqual(keys.needsKey, []);
  assert.equal(keys.key, DUMMY_KEY);
  delete process.env.E2E_ANTHROPIC_KEY; delete process.env.E2E_OPENAI_KEY;
  assert.deepEqual(await contextAiKeys({offlineAi: true, family, engine: 'api'}), keys);
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

const request = (action, content = 'background request') => ({method: 'POST',
  headers: {'content-type': 'application/json', ...(action ? {'x-jp-action': action} : {})},
  body: JSON.stringify({model: 'test', messages: [{role: 'user', content}]})});
const review = caption => request('interview', `Applications:\n0. Reordered job\n\nCaption: ${caption}\n\nTranscript or notes:\nfixture transcript`);

test('interviews serves both keyed reviews and the kind-only aggregate at every seam before live AI', async t => {
  const h = await harness(t), table = loadTable(tableFile);
  const asks = [...captions.map(caption => [review(caption), table.answers['app.interview']?.[caption]?.reply]),
    ...['first review collection', 'changed reviews and dates'].map(text => [request('interview_patterns', text), table.kinds.interview_patterns?.answer.reply])];
  for (const [init, expected] of asks) {
    assert.ok(expected, 'the asserted question needs a real stored reply');
    assert.deepEqual(storedAnswer({url: '/v1/messages', ...init}, h.env), {reply: expected});
    assert.deepEqual(await (await modelFetch('http://127.0.0.1:1/v1/messages', init, h.options)).json(), expected);
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, init);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  }
  for (const kind of background) {
    assert.deepEqual(table.kinds[kind].answer, {refuse: 'invalid-key'});
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, request(kind));
    assert.equal(response.status, 401, kind);
  }
  h.assertNoLive();
});

for (const [init, diagnostic] of [[request('undeclared_interviews_kind'), /interviews: undeclared_interviews_kind.*is unkeyable/],
  [review('new-round'), /interviews: app.interview\/new-round.*has no stored answer/],
  [request('interview'), /interviews: interview.*caption.*is unkeyable/],
  [request(''), /interviews: unknown:.*is unkeyable/]]) {
  test(`interviews fails an undeclared question by name: ${diagnostic}`, async t => {
    const h = await harness(t), missing = {code: 'E2E_AI_ANSWER_MISSING', message: diagnostic};
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

test('interviews no-credit fault precedes even a real stored review, then pass mode uses the table', async t => {
  const h = await harness(t), init = review(captions[0]);
  h.proxy.setMode('no-credit');
  for (const faulted of [init, review('recruiter-call-failing')]) {
    const response = await h.localFetch(`${h.proxy.url}/v1/messages`, faulted);
    assert.equal(response.status, FAILURES['no-credit'].status);
    assert.match((await response.json()).error.message, /credit/i);
  }
  h.proxy.setMode('pass');
  assert.equal((await h.localFetch(`${h.proxy.url}/v1/messages`, init)).status, 200);
  h.assertNoLive();
});

test('interviews stored replies survive the OpenAI following proxy', async t => {
  const h = await harness(t, 'openai');
  const response = await h.localFetch(`${h.openaiProxy.url}/v1/responses`, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({model: 'test', input: 'different aggregate', prompt_cache_key: 'job-pilotto-interview_patterns'})});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.object, 'response');
  h.assertNoLive();
});

test('interviews declares offline AI, retains no-real-AI enforcement, and uses backbone on both workflow attempts', () => {
  const source = fs.readFileSync(new URL('../suites/interviews.mjs', import.meta.url), 'utf8');
  assert.match(source, /^export const offlineAi = true;/m);
  assert.match(source, /^export const realAi = false;/m);
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/e2e.yml', import.meta.url), 'utf8');
  const attempts = [...workflow.matchAll(/E2E_AI_ANSWERS: .*contains\(fromJSON\('([^']+)'\), matrix\.suite\)/g)];
  assert.equal(attempts.length, 2);
  for (const [, suites] of attempts) assert.ok(JSON.parse(suites).includes('interviews'));
});
