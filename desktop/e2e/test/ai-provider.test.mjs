// Guards the CI AI provider switch (lib/ai-provider.mjs) and CI's side of the Codex broker (lib/broker-client.mjs): precedence, parity of tiers, the broker's refusals as skips.
import test from 'node:test';
import assert from 'node:assert/strict';
import {aiProvider, providerLine} from '../lib/ai-provider.mjs';
import {askBroker, tierOf, toBrokerCall} from '../lib/broker-client.mjs';

test('the switch: input beats a job override beats the repo variable beats the default; nothing silently changes provider', () => {
  const ci = {CI: 'true'};
  assert.deepEqual(aiProvider({...ci}), {provider: 'free', from: 'default'});
  assert.equal(aiProvider({...ci, CI_AI_PROVIDER: 'codex'}).provider, 'codex');
  assert.equal(aiProvider({...ci, CI_AI_PROVIDER: 'codex', E2E_AI_PROVIDER_JUDGES: 'claude'}, 'judges').provider, 'claude');
  assert.equal(aiProvider({...ci, CI_AI_PROVIDER: 'codex', E2E_AI_PROVIDER_JUDGES: 'claude'}, 'review').provider, 'codex');   // another consumer keeps the global
  assert.deepEqual(aiProvider({...ci, CI_AI_PROVIDER: 'codex', E2E_AI_PROVIDER_JUDGES: 'claude', E2E_AI_PROVIDER: 'free'}, 'judges'), {provider: 'free', from: 'E2E_AI_PROVIDER'});
  assert.equal(aiProvider({...ci, CI_AI_PROVIDER: ' Codex '}).provider, 'codex');
  assert.throws(() => aiProvider({...ci, CI_AI_PROVIDER: 'gpt'}), /must be codex, claude or free/);
  assert.equal(aiProvider({CI_AI_PROVIDER: 'codex'}).provider, 'claude');   // a Mac keeps its own Claude Code
  assert.equal(providerLine({...ci, CI_AI_PROVIDER: 'codex'}), 'AI provider: codex (from CI_AI_PROVIDER)');
});

test('parity: each Claude tier keeps its Codex counterpart', () => {
  assert.deepEqual(['claude-haiku-5-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-5-5', 'claude-opus-5-5', undefined].map(tierOf), ['small', 'small', 'mid', 'large', 'mid']);
});

test('a Messages request becomes one broker call: system, turns, schema, pictures, tier', () => {
  const call = toBrokerCall({model: 'claude-haiku-5-5', system: [{text: 'Be strict.'}, {text: 'JSON only.'}], output_config: {format: {schema: {type: 'object'}}},
    messages: [{role: 'user', content: [{type: 'text', text: 'Is it red?'}, {type: 'image', source: {media_type: 'image/png', data: 'AAAA'}}]}]});
  assert.equal(call.tier, 'small');
  assert.match(call.prompt, /Be strict\.\n\nJSON only\.\n\nUser:\nIs it red\?/);
  assert.deepEqual(call.schema, {type: 'object'});
  assert.deepEqual(call.images, [{name: 'image0.png', base64: 'AAAA'}]);
});

const env = {ACTIONS_ID_TOKEN_REQUEST_URL: 'https://gh.example/token?x=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'rt', CODEX_BROKER_URL: 'https://broker.example'};
const fake = reply => async (url, init) => (String(url).startsWith('https://gh.example') ? new Response(JSON.stringify({value: 'jwt-for-run'})) : reply(url, init));

test('an answered call comes back in Messages shape with its tokens; the run token is the Bearer', async () => {
  let seen;
  const answer = await askBroker({model: 'claude-sonnet-5-5', messages: [{role: 'user', content: 'hi'}]}, {env, fetchImpl: fake((url, init) => { seen = {url, auth: init.headers.authorization}; return new Response(JSON.stringify({reply: '{"verdict":"pass"}', tokens: {input: 13576, output: 25}, tier: 'mid', model: 'gpt-6.1-sol'})); })});
  assert.deepEqual(seen, {url: 'https://broker.example/call', auth: 'Bearer jwt-for-run'});
  assert.equal(answer.ok, true);
  assert.equal(answer.message.content[0].text, '{"verdict":"pass"}');
  assert.deepEqual(answer.message.usage, {input_tokens: 13576, output_tokens: 25});
});

test('the broker saying no (budget, login lost) is a skip with its reason, never another provider; no token and no answer are said apart', async () => {
  const ask = fetchImpl => askBroker({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'hi'}]}, {env, fetchImpl});
  assert.deepEqual(await ask(fake(() => new Response(JSON.stringify({why: 'budget:own-share 60.1% of 60% (scheduled)'}), {status: 429}))), {ok: false, status: 'capped', detail: 'broker: budget:own-share 60.1% of 60% (scheduled)'});
  assert.equal((await ask(fake(() => new Response('{"why":"login-lost"}', {status: 503})))).status, 'capped');
  assert.equal((await ask(fake(() => new Response('{"why":"oidc: wrong repository"}', {status: 401})))).status, 401);
  assert.equal((await ask(fake(() => { throw new Error('boom'); }))).status, 'unreachable');
  assert.equal((await askBroker({model: 'x', messages: []}, {env: {}, fetchImpl: async () => { throw new Error('no call without a token'); }})).status, 'no-token');
});

test('the judges on codex: an answer returns in Messages shape; a broker refusal is a skip with its reason, said by the runner\'s cap path', async () => {
  const {modelFetch} = await import('../lib/model.mjs');
  const {takeCapped, capMessage} = await import('../lib/ai-cap.mjs');
  const ciEnv = {...env, CI: 'true', CI_AI_PROVIDER: 'codex', E2E_SUITE: 'x'};
  const request = {method: 'POST', headers: {}, body: JSON.stringify({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'ok?'}]})};
  const realFetch = globalThis.fetch;
  try {
    let status = 200;
    globalThis.fetch = fake(() => (status === 200 ? new Response(JSON.stringify({reply: 'yes', tokens: {input: 5, output: 1}, tier: 'small', model: 'gpt-6-luna'})) : new Response(JSON.stringify({why: 'budget:week 85% of 85% (scheduled)'}), {status: 429})));
    const ok = await modelFetch('https://api.anthropic.com/v1/messages', request, {engine: () => 'api', env: ciEnv});
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).content[0].text, 'yes');
    assert.equal(takeCapped(), null);
    status = 429;
    const refused = await modelFetch('https://api.anthropic.com/v1/messages', {...request, body: JSON.stringify({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'another?'}]})}, {engine: () => 'api', env: ciEnv});
    assert.equal(refused.status, 503);
    const capped = takeCapped();
    assert.match(capMessage(capped.neurons, ciEnv, capped.why), /Codex broker said no \(broker: budget:week 85%/);
  } finally { globalThis.fetch = realFetch; }
});
