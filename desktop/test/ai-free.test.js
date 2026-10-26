// Free AI on the app side (lib/ai-free.js): the install's own token becomes the Anthropic key, the SDKs follow our website, an own key leaves it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {apply, isFreeKey, migrate, start, stop, FREE_BASE} from '../lib/ai-free.js';

const storage = (settings = {}) => { let s = settings; const secrets = {};
  return {settings: () => s, saveSettings: p => { s = {...s, ...p}; }, setSecret: (n, v) => { secrets[n] = v; }, secret: n => secrets[n], secrets,
    readText: () => '', writeText: () => {}, dir: '/tmp/none'}; };
const site = (seen = []) => async (url, init) => { seen.push({url, body: JSON.parse(init.body)}); return Response.json({ok: true, token: 'tok123'}); };

test('start: no key or account; mints the install token, keeps JPF1.<install>.<token> and points the SDKs at the website', async () => {
  const env = {}, seen = [], st = storage();
  assert.deepEqual(await start(st, env, site(seen)), {ok: true});
  assert.equal(seen[0].url, 'https://www.jobpilotto.top/api/install-token');
  assert.equal(seen[0].body.purpose, 'ai');
  assert.match(st.secrets.ANTHROPIC_API_KEY, /^JPF1\..+\.tok123$/);
  assert.ok(isFreeKey(st.secrets.ANTHROPIC_API_KEY));
  assert.equal(env.ANTHROPIC_BASE_URL, FREE_BASE);
  assert.equal(st.settings().aiFree, true);
});

test('start fails in words when the website cannot be reached, and leaves the engine alone', async () => {
  const env = {}, st = storage({aiEngine: 'cli'});
  const result = await start(st, env, async () => { throw new Error('offline'); });
  assert.equal(result.ok, false); assert.match(result.error, /Free AI could not start/);
  assert.equal(st.settings().aiEngine, 'cli'); assert.equal(env.ANTHROPIC_BASE_URL, undefined);
});

test('start: Free is the Anthropic API engine, whatever engine was picked before', async () => {
  for (const before of ['cli', 'codex', 'openai', 'api', undefined]) {
    const st = storage({aiEngine: before});
    assert.deepEqual(await start(st, {}, site()), {ok: true});
    assert.equal(st.settings().aiEngine, 'api', `was ${before}`);
  }
});

test('an install that had the $1 credit moves to Free at start-up; one that did not is left alone', async () => {
  const old = storage({aiTrial: true, aiEngine: 'api'}); old.setSecret('ANTHROPIC_API_KEY', 'JP1.old.key');
  assert.deepEqual(await migrate(old, {}, site()), {ok: true, moved: true});
  assert.match(old.secrets.ANTHROPIC_API_KEY, /^JPF1\./); assert.equal(old.settings().aiTrial, false);
  const plain = storage({aiEngine: 'api'});
  assert.deepEqual(await migrate(plain, {}, site()), {ok: true, moved: false});
  assert.equal(plain.secrets.ANTHROPIC_API_KEY, undefined);
});

test('an install that still has only the old setting goes through Free AI at once (no gap before the move)', () => {
  const env = {};
  apply({aiTrial: true}, env);
  assert.equal(env.ANTHROPIC_BASE_URL, FREE_BASE);
});

test('stop (own key saved) and apply at start-up restore Anthropic directly', () => {
  const env = {ANTHROPIC_BASE_URL: FREE_BASE}, st = storage({aiFree: true});
  stop(st, env);
  assert.equal(st.settings().aiFree, false);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  apply({aiFree: true}, env);
  assert.equal(env.ANTHROPIC_BASE_URL, FREE_BASE);
});

test('the end-to-end journey sends the app\'s own AI calls to its test proxy, and only the journey does', () => {
  const env = {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_AI_BASE_URL: 'http://127.0.0.1:9'};
  apply({}, env);
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:9');
  apply({aiFree: true}, env);
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:9');   // the proxy wins over Free AI in a test run
  const real = {JOB_PILOTTO_E2E_AI_BASE_URL: 'http://127.0.0.1:9'};   // the variable alone (no JOB_PILOTTO_E2E) changes nothing
  apply({}, real);
  assert.equal(real.ANTHROPIC_BASE_URL, undefined);
});

// 26 Oct 2026: CI runs on Free AI through a relay on the runner; the wizard e2e pressed "Check and save" with the relay's JPF1 key and the key field refuses
// anything but sk-ant- (beta 40261885119, wizard red). The journey now presses the Free card, and the app takes the relay's key instead of asking the website.
test('the end-to-end journey\'s Free card takes the relay\'s key and never asks the website; outside the journey the variable changes nothing', async () => {
  const env = {JOB_PILOTTO_E2E: '1', JOB_PILOTTO_E2E_FREE_AI_KEY: 'JPF1.ci-e2e-1.tok', JOB_PILOTTO_E2E_AI_BASE_URL: 'http://127.0.0.1:9'}, st = storage({aiEngine: 'cli'});
  const asked = [];
  assert.deepEqual(await start(st, env, async url => { asked.push(url); throw new Error('the website was asked'); }), {ok: true});
  assert.deepEqual(asked, []);
  assert.equal(st.secrets.ANTHROPIC_API_KEY, 'JPF1.ci-e2e-1.tok');
  assert.equal(st.settings().aiFree, true); assert.equal(st.settings().aiEngine, 'api');
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:9');   // the journey's proxy, which forwards to the relay
  const seen = [], real = storage();
  assert.deepEqual(await start(real, {JOB_PILOTTO_E2E_FREE_AI_KEY: 'JPF1.ci-e2e-1.tok'}, site(seen)), {ok: true});   // no JOB_PILOTTO_E2E: a user's start
  assert.equal(seen.length, 1); assert.match(real.secrets.ANTHROPIC_API_KEY, /\.tok123$/);
});

// #1017: Free is stored as engine 'api', so pressing the API key card changed nothing and chosen() stayed 'free'.
test('leave: the API key card pressed on Free leaves it, forgets the Free token, and the chooser then shows the API key', async () => {
  const {chosen} = await import('../renderer/ai-engine-view.js');
  const st = storage({aiFree: true, aiEngine: 'api'}); st.setSecret('ANTHROPIC_API_KEY', 'JPF1.inst.tok');
  assert.equal(chosen(st.settings(), true), 'free');
  const {leave} = await import('../lib/ai-free.js');
  assert.equal(leave(st, {}), true);
  assert.equal(chosen(st.settings(), !!st.secret('ANTHROPIC_API_KEY')), 'api');
  assert.equal(st.secret('ANTHROPIC_API_KEY'), '');
});

test('leave keeps the person\'s own key, and does nothing when Free is off', async () => {
  const {leave} = await import('../lib/ai-free.js');
  const own = storage({aiFree: true, aiEngine: 'api'}); own.setSecret('ANTHROPIC_API_KEY', 'sk-ant-own');
  leave(own, {}); assert.equal(own.secret('ANTHROPIC_API_KEY'), 'sk-ant-own');
  const off = storage({aiEngine: 'api'}); assert.equal(leave(off, {}), false);
});

test('setAiEngine routes the API key pick through leave', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../lib/setup-handlers.js', import.meta.url), 'utf8');
  assert.match(src, /if \(choice === 'api'\) aiFree\.leave\(storage\)/);
});
