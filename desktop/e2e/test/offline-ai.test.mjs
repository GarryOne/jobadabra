// Offline suites use no AI secret or live transport and fail on any proxy question.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as context from '../lib/context.mjs';
import {DUMMY_KEY, pickEngine, pickFamily} from '../lib/engine.mjs';
import {answerFor, loadTable, questionOf} from '../lib/ai-answers.mjs';
import * as guards from '../lib/no-real-ai.mjs';

function environment(t, extra = {}) {
  const saved = {...process.env};
  for (const key of Object.keys(process.env)) if (/^(E2E_|CI_AI_PROVIDER)/.test(key)) delete process.env[key];
  Object.assign(process.env, {CI: 'true', E2E_AI_PROVIDER: 'claude', ...extra});
  t.after(() => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, saved); });
}

test('offline context keys bypass every key check, use the dummy and require no secret', async t => {
  environment(t, {E2E_ANTHROPIC_KEY: 'revoked', E2E_OPENAI_KEY: 'revoked'});
  let checked = 0;
  t.mock.method(globalThis, 'fetch', async () => { checked++; return new Response('{}', {status: 401}); });
  for (const family of ['claude', 'openai', 'free']) {
    const keys = await context.contextAiKeys({offlineAi: true, family, engine: family === 'openai' ? 'openai' : 'api'});
    assert.equal(keys.key, DUMMY_KEY);
    assert.equal(keys.appKey, DUMMY_KEY);
    assert.equal(keys.judgeKey, DUMMY_KEY);
    assert.deepEqual(keys.needs, []);
    assert.deepEqual(keys.needsKey, []);
  }
  assert.equal(checked, 0);
  delete process.env.E2E_ANTHROPIC_KEY;
  delete process.env.E2E_OPENAI_KEY;
  assert.deepEqual((await context.contextAiKeys({offlineAi: true, family: 'claude', engine: 'api'})).needs, []);
});

test('a live context still checks the CI key and requires it; Mac key selection stays unchanged', async t => {
  environment(t, {E2E_ANTHROPIC_KEY: 'revoked'});
  let checked = 0;
  t.mock.method(globalThis, 'fetch', async () => { checked++; return new Response('{}', {status: 401}); });
  await assert.rejects(context.contextAiKeys({family: 'claude', engine: 'api'}), /refused \(401\)/);
  assert.equal(checked, 1);
  delete process.env.E2E_ANTHROPIC_KEY;
  assert.deepEqual((await context.contextAiKeys({family: 'claude', engine: 'api'})).needs, [{name: 'E2E_ANTHROPIC_KEY', value: ''}]);
  delete process.env.CI;
  const keys = await context.contextAiKeys({offlineAi: true, family: 'claude', engine: 'cli'});
  assert.equal(keys.key, '');
  assert.equal(keys.judgeKey, '');
  assert.equal(keys.appKey, DUMMY_KEY);
  assert.deepEqual(keys.needs, []);
});

test('offline proxies refuse all requests before stored answers, relays, broker or provider fetch', async t => {
  const fetchLocal = globalThis.fetch;
  let escaped = 0;
  environment(t, {E2E_AI_PROVIDER: 'codex', E2E_FREE_AI_URL: 'http://127.0.0.1:1', E2E_FREE_AI_KEY: 'JPF1.test', E2E_AI_ANSWERS: 'backbone'});
  const golden = file => JSON.parse(fs.readFileSync(new URL(`../fixtures/golden/${file}`, import.meta.url), 'utf8'));
  const item = golden('truth.json')[0], company = item.company || golden('sources.json')[0].company;
  const known = {messages: [{role: 'user', content: `Title: ${item.title}\nCompany: ${company}\nLocation: ${item.location}`} ]};
  const headers = {'x-jp-action': 'score'};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-ai-')), file = path.join(dir, 'answers.json');
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.writeFileSync(file, JSON.stringify({v: 1, answers: {'app.score': {[item.id]: {reply: {content: [{type: 'text', text: '{"score":82}'}]}}}}}));
  process.env.E2E_AI_ANSWERS_FILE = file;
  process.env.E2E_ARTIFACTS = dir;
  assert.ok(answerFor(questionOf({headers, body: known}), loadTable(file)).reply, 'this question has a stored answer, but offline settings must refuse it too');
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (new URL(url).hostname !== '127.0.0.1' || new URL(url).port === '1') { escaped++; throw new Error('outside the stand-in'); }
    return fetchLocal(url, options);
  });
  for (const family of ['claude', 'free', 'openai']) {
    const proxies = await context.contextAiProxies({offlineAi: true, family});
    try {
      guards.assertNoAiQuestions(proxies);
      for (const [proxy, endpoint, body] of [
        [proxies.proxy, '/v1/messages', {messages: [{role: 'user', content: 'unknown question'}]}],
        [proxies.proxy, '/v1/messages', known],
        ...(proxies.openaiProxy ? [[proxies.openaiProxy, '/v1/responses', {input: 'unknown', stream: true}]] : [])]) {
        const response = await fetch(`${proxy.url}${endpoint}`, {method: 'POST', headers, body: JSON.stringify(body)});
        assert.equal(response.status, 401);
        assert.ok((await response.json()).error);
      }
      assert.equal(proxies.proxy.stats.calls, family === 'openai' ? 3 : 2);
      assert.equal(proxies.proxy.stats.failed + (proxies.openaiProxy?.stats.failed || 0), proxies.proxy.stats.calls);
      assert.equal(proxies.proxy.stats.paid || 0, 0);
      assert.throws(() => guards.assertNoAiQuestions(proxies), /AI question/);
    } finally { await proxies.openaiProxy?.close(); await proxies.proxy.close(); }
  }
  assert.equal(escaped, 0);
});

test('the zero-question guard rejects every request counter on either proxy', () => {
  for (const proxy of ['proxy', 'openaiProxy']) for (const counter of ['calls', 'canned', 'armed', 'failed', 'paid', 'inflight', 'described', 'futureCounter']) {
    assert.throws(() => guards.assertNoAiQuestions({[proxy]: {stats: {[counter]: 1}}}), /AI question/);
  }
});

test('settings declares offline AI and the harness wires its key path, proxies and critical final check', () => {
  const source = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(source('../suites/settings.mjs'), /^export const offlineAi = true;/m);
  assert.match(source('../suites/settings.mjs'), /^export const realAi = false;/m);
  assert.match(source('../lib/context.mjs'), /await contextAiKeys\(\{offlineAi, light, family, engine\}\)/);
  assert.match(source('../lib/context.mjs'), /await contextAiProxies\(\{offlineAi, family\}\)/);
  assert.match(source('../lib/suite-main.mjs'), /offlineAi: !!suite\.offlineAi/);
  assert.match(source('../lib/suite-main.mjs'), /await runAiGuards\(suite, ctx, runAlways\)/);
  assert.match(source('../lib/no-real-ai.mjs'), /suite\.offlineAi\) await runAlways\('no AI question reached the proxy at all'[\s\S]*?assertNoAiQuestions\(ctx\)[\s\S]*?critical: true/);
  for (const [run, family] of [['7', 'openai'], ['8', 'claude']]) {
    const env = {CI: 'true', CI_AI_PROVIDER: 'free', CI_FREE_AI_CF_TOKEN: 'unused-without-relay', E2E_OPENAI_KEY: 'revoked', GITHUB_RUN_NUMBER: run};
    assert.equal(pickFamily(env), family);
    assert.equal(pickEngine({env, family}), family === 'openai' ? 'openai' : 'api');
    const withoutSecrets = {...env, E2E_OPENAI_KEY: '', CI_FREE_AI_CF_TOKEN: ''};
    assert.equal(pickFamily(withoutSecrets), 'claude');
    assert.equal(pickEngine({env: withoutSecrets}), 'api');
  }
});
