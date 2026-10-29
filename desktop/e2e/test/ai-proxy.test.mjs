// The slow/failing AI proxy: each mode answers the way the real API does, and a bad mode name is refused (a typo must not silently pass requests through).
import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {AiLimit, AiUnavailable} from '../../lib/ai/contract.js';
import {OpenAiApi, contractError, fromResponse} from '../../lib/ai/openai-api.js';
import {FAILURES, OPENAI_FAILURES, asAnthropic, failureFor, openaiFailureFor, responseOf, startAiProxy} from '../lib/ai-proxy.mjs';

const post = url => fetch(`${url}/v1/messages`, {method: 'POST', body: '{}', headers: {'content-type': 'application/json'}});

test('every failure mode is an Anthropic error body with its status', () => {
  for (const [mode, failure] of Object.entries(FAILURES)) {
    const made = failureFor(mode);
    assert.equal(made.status, failure.status);
    const body = JSON.parse(made.body);
    assert.equal(body.type, 'error');
    assert.equal(body.error.type, failure.type);
  }
  assert.equal(failureFor('pass'), null);
  assert.equal(failureFor('hang'), null);
});

test('the no-credit body is worded the way the engine recognises as a spending limit', () => {
  assert.match(JSON.parse(failureFor('no-credit').body).error.message, /credit balance/);
});

test('a proxy in a failure mode answers it without reaching the target, and passes through again afterwards', async () => {
  let reached = 0;
  const target = http.createServer((req, res) => { reached++; res.writeHead(200, {'content-type': 'application/json'}); res.end('{"ok":true}'); });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  const proxy = await startAiProxy({target: `http://127.0.0.1:${target.address().port}`});
  try {
    proxy.setMode('rate-limit');
    const refused = await post(proxy.url);
    assert.equal(refused.status, 429);
    assert.equal((await refused.json()).error.type, 'rate_limit_error');
    assert.equal(reached, 0);
    proxy.setMode('pass');
    const answered = await post(proxy.url);
    assert.equal(answered.status, 200);
    assert.equal(reached, 1);
    assert.equal(proxy.stats.calls, 2);
  } finally { await proxy.close(); await new Promise(resolve => target.close(resolve)); }
});

test('an unknown mode is refused', async () => {
  const proxy = await startAiProxy();
  try { assert.throws(() => proxy.setMode('rate_limit'), /unknown proxy mode/); } finally { await proxy.close(); }
});

test('request diagnostics retain only method and path, cap at 40 and stay outside stats', async () => {
  const proxy = await startAiProxy({target: 'http://127.0.0.1:1'});
  try {
    proxy.setMode('invalid-key');
    const messages = await fetch(`${proxy.url}/v1/messages?key=secret`, {method: 'POST', body: '{}'});
    const models = await fetch(`${proxy.url}/v1/models?token=secret`);
    assert.equal(messages.status, 401);
    assert.equal(models.status, 401);
    assert.deepEqual(proxy.seenPaths(), ['POST /v1/messages', 'GET /v1/models']);
    for (let i = 0; i < 40; i++) await fetch(`${proxy.url}/v1/models?page=${i}`);
    assert.equal(proxy.seenPaths().length, 40);
    assert.equal(proxy.stats.calls, 42);
    assert.equal(proxy.stats.failed, 42);
    assert.equal(proxy.stats.paid || 0, 0);
    assert.ok(Object.values(proxy.stats).every(value => !Array.isArray(value)));
    const seen = proxy.seenPaths();
    seen.push('GET /changed-by-caller');
    assert.equal(proxy.seenPaths().length, 40);
    assert.ok(proxy.seenPaths().every(entry => !entry.includes('?')));
  } finally { await proxy.close(); }
});

test('hang never answers', async () => {
  const proxy = await startAiProxy();
  try {
    proxy.setMode('hang');
    const outcome = await Promise.race([post(proxy.url).then(() => 'answered', () => 'closed'), new Promise(resolve => setTimeout(() => resolve('waiting'), 400))]);
    assert.equal(outcome, 'waiting');
  } finally { await proxy.close(); }
});

test('a refusal asks for an almost immediate retry, so the SDK does not back off for seconds in a test', async () => {
  const proxy = await startAiProxy();
  try {
    for (const mode of ['rate-limit', 'server-error']) {
      proxy.setMode(mode);
      const answer = await post(proxy.url);
      assert.equal(answer.headers.get('retry-after-ms'), '10', mode);
    }
  } finally { await proxy.close(); }
});

// ---- An OpenAI turn (9 Oct 2026: the first OpenAI CI run let every stand-in through to the real model and no fault ever fired) ----
// The real adapter and SDK (desktop/lib/ai/openai-api.js) against the OpenAI proxy that follows the suite's proxy: the shapes are proven by the code that reads them.

// The SDK is the app's dependency (desktop/node_modules): CI's plan job installs only the e2e harness's, so the SDK tests run where it is (a Mac, the desktop job)
// and the shape test below, which needs no SDK, runs everywhere.
const OpenAI = await import('openai').then(module => module.default, () => null);
const withSdk = {skip: OpenAI ? false : 'the openai SDK is not installed here (desktop/node_modules)'};

async function openaiTurn() {
  let reached = 0;
  const target = http.createServer((req, res) => { reached++; res.writeHead(500); res.end('{}'); });   // the "real" OpenAI: never to be reached here
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  const suite = await startAiProxy({target: `http://127.0.0.1:${target.address().port}`});
  const openai = await startAiProxy({target: `http://127.0.0.1:${target.address().port}`, kind: 'app-openai', metered: /\/responses(\?|$)/, shape: 'openai', follow: suite});
  const engine = new OpenAiApi({sdk: new OpenAI({apiKey: 'sk-test', baseURL: `${openai.url}/v1`, maxRetries: 0})});
  return {suite, openai, engine, reached: () => reached, close: async () => { await openai.close(); await suite.close(); await new Promise(resolve => target.close(resolve)); }};
}
const ask = (engine, text, more = {}) => engine.complete({model: 'fast', system: 'You pick a menu choice.', messages: [{role: 'user', parts: [text]}], maxTokens: 100, ...more});

test("an OpenAI turn's calls are answered by the suite's stand-in, which reads them as Messages bodies", withSdk, async () => {
  const turn = await openaiTurn();
  const seen = [];
  turn.suite.setCanned(body => { seen.push(body); return typeof body.messages[0].content === 'string' && body.messages[0].content.startsWith('{"question"') ? JSON.stringify({choice: 'Suisse'}) : null; });
  try {
    const answer = await ask(turn.engine, JSON.stringify({question: 'Indicatif', answer: '+41', choices: ['France', 'Suisse']}), {schema: {type: 'object', properties: {choice: {type: 'string'}}, required: ['choice']}});
    assert.deepEqual(JSON.parse(answer.content[0].text), {choice: 'Suisse'});
    assert.equal(seen[0].system, 'You pick a menu choice.');
    assert.equal(turn.suite.stats.canned, 1);   // counted where the suite looks
    assert.equal(turn.reached(), 0);
    // Streamed (the strategy draft's progress bar): the same answer through the SDK's event stream.
    const deltas = [];
    const streamed = await turn.engine.messages.stream({model: 'fast', max_tokens: 100, messages: [{role: 'user', content: JSON.stringify({question: 'Indicatif', answer: '+41', choices: ['Suisse']})}]})
      .on('text', delta => deltas.push(delta)).finalMessage();
    assert.equal(streamed.content[0].text, '{"choice":"Suisse"}');
    assert.deepEqual(deltas, ['{"choice":"Suisse"}']);
  } finally { await turn.close(); }
});

test("a fault the suite sets fires on an OpenAI turn, in OpenAI's own error shape, and is counted on the suite's proxy", withSdk, async () => {
  const turn = await openaiTurn();
  try {
    turn.suite.setMode('no-credit');
    await assert.rejects(ask(turn.engine, 'hello'), error => error instanceof AiLimit);   // insufficient_quota: the spending limit, final
    turn.suite.setMode('invalid-key');
    await assert.rejects(ask(turn.engine, 'hello'), error => error instanceof AiLimit);
    turn.suite.setMode('rate-limit');
    await assert.rejects(ask(turn.engine, 'hello'), error => error instanceof AiUnavailable);
    turn.suite.setMode('server-error');
    await assert.rejects(ask(turn.engine, 'hello'), error => error instanceof AiUnavailable);
    assert.equal(turn.suite.stats.failed, 4);
    assert.equal(turn.suite.stats.calls, 4, 'steps count AI calls on the suite proxy: an OpenAI turn must show there too');
    assert.equal(turn.reached(), 0);
    assert.deepEqual(Object.keys(OPENAI_FAILURES).sort(), Object.keys(FAILURES).sort());   // a new Anthropic fault needs its OpenAI twin
  } finally { await turn.close(); }
});

test('a Responses body reads as a Messages body: files are documents, one text part is a string', () => {
  const body = asAnthropic({model: 'gpt', instructions: 'sys', input: [{role: 'user', content: [{type: 'input_file', file_data: 'x'}, {type: 'input_text', text: 'read it'}]}, {role: 'user', content: [{type: 'input_text', text: '<cv>'}]}]});
  assert.equal(body.system, 'sys');
  assert.deepEqual(body.messages[0].content, [{type: 'document'}, {type: 'text', text: 'read it'}]);
  assert.equal(body.messages[1].content, '<cv>');
});

test("without the SDK: the proxy's answers and faults read right through the adapter's own readers", async () => {
  assert.equal(fromResponse(responseOf('{"choice":"Suisse"}'), {model: 'fast', schema: {type: 'object', properties: {choice: {type: 'string'}}}}).content[0].text, '{"choice":"Suisse"}');
  const kinds = Object.fromEntries(Object.keys(OPENAI_FAILURES).map(mode => {
    const made = openaiFailureFor(mode), body = JSON.parse(made.body);
    const error = contractError(Object.assign(new Error(body.error.message), {status: made.status, code: body.error.code, name: 'APIError'}));
    return [mode, error instanceof AiLimit ? 'limit' : error instanceof AiUnavailable ? 'unavailable' : 'other'];
  }));
  assert.deepEqual(kinds, {'rate-limit': 'unavailable', 'server-error': 'unavailable', 'invalid-key': 'limit', 'no-credit': 'limit'});
});

test('asAnthropic carries the answer schema, so a stand-in can tell a scoring call on an OpenAI turn too', async () => {
  const {asAnthropic} = await import('../lib/ai-proxy.mjs');
  const schema = {type: 'object', properties: {score: {type: 'integer'}}};
  const asked = asAnthropic({model: 'm', input: 'rate this', text: {format: {type: 'json_schema', name: 'answer', strict: true, schema}}});
  assert.deepEqual(asked.output_config.format.schema, schema);
  assert.equal(asAnthropic({model: 'm', input: 'hi'}).output_config, undefined);
});

test('a stand-in can refuse a call the way the API does, and the refusal is counted and named as a stub', async () => {
  const {STUBBED} = await import('../lib/ai-proxy.mjs');
  const proxy = await startAiProxy();
  try {
    proxy.setCanned(() => ({refuse: 'no-credit'}));
    const response = await post(proxy.url);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /credit balance is too low/);
    assert.equal(proxy.stats.failed, 1);
    assert.ok(STUBBED.has('no-credit'));
  } finally { await proxy.close(); }
});
