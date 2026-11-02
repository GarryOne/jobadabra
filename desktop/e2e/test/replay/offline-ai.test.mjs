// Offline suites use no AI secret or live transport and refuse background questions without reaching a real model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as context from '../../lib/context.mjs';
import {DUMMY_KEY, pickEngine, pickFamily} from '../../lib/engine.mjs';
import {answerFor, loadTable, questionOf} from '../../lib/ai-answers.mjs';
import * as guards from '../../lib/no-real-ai.mjs';
import {installApplyAnswers} from '../../lib/apply-answers.mjs';

test('apply declares offline AI with the real-model guard enabled', () => {
  const source = fs.readFileSync(new URL('../../suites/apply.mjs', import.meta.url), 'utf8');
  assert.match(source, /^export const offlineAi = true;/m);
  assert.match(source, /^export const realAi = false;/m);
});

test('apply preserves contact answers and each context\'s unmatched-ask fallback', () => {
  const ctx = {}, install = fallback => {
    let answer = fallback;
    ctx.proxy = {canned: () => answer, setCanned: handler => { answer = handler; }};
    installApplyAnswers(ctx);
    return answer;
  };
  const answer = install(() => ({refuse: 'invalid-key'}));
  const labels = ['resume/cv', 'i agree to the privacy policy and the processing of my data'];
  const contact = fs.readFileSync(new URL('../../../lib/contact-keys.js', import.meta.url), 'utf8');
  const system = /const INSTRUCTIONS = `([^\n]+)/.exec(contact)[1];
  const body = {system, messages: [{role: 'user', content: JSON.stringify(labels)}]};
  const text = answer(body);
  assert.equal(typeof text, 'string', 'the recorded contact-label ask must not fall through');
  assert.deepEqual(JSON.parse(text), {items: labels.map(label => ({label, key: 'none'}))});
  const blocks = {system: [{type: 'text', text: system}], messages: [{role: 'user', content: [{type: 'text', text: body.messages[0].content}]}]};
  assert.deepEqual(JSON.parse(answer(blocks)), JSON.parse(text));
  assert.deepEqual({...answer({...body, system: 'A different question with the same labels'})}, {refuse: 'invalid-key'});
  const digest = {system: 'You help a job seeker who is on a job posting page in any language. The page has no application form the program can fill.',
    messages: [{role: 'user', content: 'Address path: /e2e/jobs/4001001\nCandidates (number...'}]};
  assert.deepEqual({...answer(digest)}, {refuse: 'invalid-key'});
  const passThrough = install(null);
  assert.equal(passThrough(digest), null, 'an explicitly supplied null fallback permits pass-through');
  assert.equal(passThrough({...body, system: 'A different question with the same labels'}), null);
  assert.equal(ctx.answerAsks, undefined);
  assert.equal(ctx.kindAsks, undefined);
});

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

test('offline proxies outside backbone refuse before stored answers, relays, broker or provider fetch', async t => {
  const fetchLocal = globalThis.fetch;
  let escaped = 0;
  environment(t, {E2E_AI_PROVIDER: 'codex', E2E_FREE_AI_URL: 'http://127.0.0.1:1', E2E_FREE_AI_KEY: 'JPF1.test', E2E_AI_ANSWERS: 'off'});
  const golden = file => JSON.parse(fs.readFileSync(new URL(`../../fixtures/golden/${file}`, import.meta.url), 'utf8'));
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
      guards.assertNoRealAi(proxies);
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
      assert.doesNotThrow(() => guards.assertNoRealAi(proxies));
    } finally { await proxies.openaiProxy?.close(); await proxies.proxy.close(); }
  }
  assert.equal(escaped, 0);
});

test('every offline suite also declares realAi=false so its real-model guard is always enabled', () => {
  const dir = new URL('../../suites/', import.meta.url);
  const offline = fs.readdirSync(dir).filter(file => file.endsWith('.mjs')).map(file =>
    [file, fs.readFileSync(new URL(file, dir), 'utf8')]).filter(([, source]) => /^export const offlineAi = true;/m.test(source));
  assert.ok(offline.some(([file]) => file === 'settings.mjs'), 'settings must remain covered by the invariant');
  for (const [file, source] of offline) assert.match(source, /^export const realAi = false;/m, `${file}: offline AI requires the real-model guard`);
});

test('settings declares offline AI and the harness wires its key path, proxies and real-model guard', () => {
  const source = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(source('../../suites/settings.mjs'), /^export const offlineAi = true;/m);
  assert.match(source('../../suites/settings.mjs'), /^export const realAi = false;/m);
  assert.match(source('../../lib/context.mjs'), /await contextAiKeys\(\{offlineAi, light, family, engine\}\)/);
  assert.match(source('../../lib/context.mjs'), /await contextAiProxies\(\{offlineAi, family, liveAi\}\)/);
  assert.match(source('../../lib/suite-main.mjs'), /offlineAi: !!suite\.offlineAi/);
  assert.match(source('../../lib/suite-main.mjs'), /await runAiGuards\(suite, ctx, runAlways\)/);
  assert.match(source('../../lib/no-real-ai.mjs'), /suite\.realAi === false\) await runAlways\('no AI call of this suite reached a real model:[\s\S]*?assertNoRealAi\(ctx\)[\s\S]*?critical: true/);
  for (const [run, family] of [['7', 'openai'], ['8', 'claude']]) {
    const env = {CI: 'true', CI_AI_PROVIDER: 'free', CI_FREE_AI_CF_TOKEN: 'unused-without-relay', E2E_OPENAI_KEY: 'revoked', GITHUB_RUN_NUMBER: run};
    assert.equal(pickFamily(env), family);
    assert.equal(pickEngine({env, family}), family === 'openai' ? 'openai' : 'api');
    const withoutSecrets = {...env, E2E_OPENAI_KEY: '', CI_FREE_AI_CF_TOKEN: ''};
    assert.equal(pickFamily(withoutSecrets), 'claude');
    assert.equal(pickEngine({env: withoutSecrets}), 'api');
  }
});


test('applyflows wrapper refuses paid AI calls in its fixture journeys', async () => {
  const suite = await import('../../suites/applyflows.mjs');
  const {runAiGuards} = await import('../../lib/no-real-ai.mjs');
  await assert.rejects(runAiGuards(suite, {proxy: {stats: {paid: 1}}}, (_name, work) => work()), /1 AI call\(s\) reached a real model/);
  assert.equal(suite.offlineAi, true, 'fixture journeys must create an offline proxy');
});


test('explicit LIVE mode keeps applyflows on its real-site measurement path', async t => {
  const saved = process.env.LIVE;
  process.env.LIVE = '1';
  t.after(() => { if (saved === undefined) delete process.env.LIVE; else process.env.LIVE = saved; });
  const suite = await import('../../suites/applyflows.mjs?live-control');
  assert.equal(suite.offlineAi, false);
  assert.equal(suite.realAi, true);
});
