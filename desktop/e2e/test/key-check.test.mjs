// The early key check: a refused key stops the suite with its name; a good key, a down network or an unknown engine do not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {CHECKED_ENGINES, CLAUDE_MODELS, checkKeyAccepted, checkOtherKeys} from '../lib/key-check.mjs';

const replying = status => async () => ({status});

test('every checked engine fails on 401 and 403 naming its secret, and passes on 200', async () => {
  assert.deepEqual([...CHECKED_ENGINES].sort(), ['api', 'openai']);
  for (const engine of CHECKED_ENGINES) {
    for (const status of [401, 403]) await assert.rejects(checkKeyAccepted({engine, key: 'k', fetchImpl: replying(status)}), new RegExp(`E2E_(OPENAI|ANTHROPIC)_KEY refused \\(${status}\\)`));
    await checkKeyAccepted({engine, key: 'k', fetchImpl: replying(200)});
    await checkKeyAccepted({engine, key: 'k', fetchImpl: replying(429)});   // a limit is the AI's own line, not a refusal
    await checkKeyAccepted({engine, key: 'k', fetchImpl: async () => { throw new Error('offline'); }});
  }
});

test('the key is sent to its own provider only, and never printed', async () => {
  for (const [engine, host] of [['openai', 'api.openai.com'], ['api', 'api.anthropic.com']]) {
    let seen = null;
    await assert.rejects(checkKeyAccepted({engine, key: 'sk-secret', fetchImpl: async (url, options) => { seen = {url, options}; return {status: 401}; }}), error => !/sk-secret/.test(error.message));
    assert.equal(new URL(seen.url).host, host);
  }
});

test('a CLI engine, no key or an unknown engine is not checked', async () => {
  for (const engine of ['cli', 'codex', 'other']) await checkKeyAccepted({engine, key: 'k', fetchImpl: () => { throw new Error('must not call'); }});
  await checkKeyAccepted({engine: 'openai', key: '', fetchImpl: () => { throw new Error('must not call'); }});
});

test('the Claude models checked are the ones src/ai/models.py names', () => {
  const models = fs.readFileSync(path.resolve(import.meta.dirname, '../../../src/ai/models.py'), 'utf8');
  const named = [...models.matchAll(/(?:SMALL|MAIN|BIG)_MODEL = (?:os\.getenv\([^)]*\) or )?'(claude-[\w.-]+)'/g)].map(match => match[1]);
  assert.deepEqual([...CLAUDE_MODELS].sort(), named.sort());
});

test('a model the API refuses stops the suite with the model and the API\'s words, key-shaped text removed; a limit does not', async () => {
  const refusing = (status, message) => async url => url.endsWith('/count_tokens') ? {status, json: async () => ({error: {message}})} : {status: 200};
  await assert.rejects(checkKeyAccepted({engine: 'api', key: 'k', fetchImpl: refusing(400, 'model: claude-haiku-5-5 is not available key sk-ant-api03-abcdefghijkl')}),
    error => /claude-haiku-5-5 \(400\)/.test(error.message) && /not available/.test(error.message) && !/abcdefghijkl/.test(error.message));
  await assert.rejects(checkKeyAccepted({engine: 'api', key: 'k', fetchImpl: refusing(404, 'not_found')}), /\(404\)/);
  await checkKeyAccepted({engine: 'api', key: 'k', fetchImpl: refusing(429, 'rate limited')});
  await checkKeyAccepted({engine: 'openai', key: 'k', fetchImpl: refusing(400, 'never asked: OpenAI has no count_tokens here')});
});

test('the key of the other family is checked on every run, whichever family runs: a refusal is a printed warning with the API\'s words, never a stop', async () => {
  const env = {E2E_ANTHROPIC_KEY: 'a', E2E_OPENAI_KEY: 'o'};
  const refusing = async url => url.endsWith('/count_tokens') ? {status: 400, json: async () => ({error: {message: 'credit balance is too low'}})} : {status: 200};
  for (const engine of CHECKED_ENGINES) {
    const lines = [];
    await checkOtherKeys({engine, env, log: line => lines.push(line), fetchImpl: refusing});
    assert.equal(lines.length, 1, engine);
    assert.match(lines[0], engine === 'openai' ? /⚠ preflight: E2E_ANTHROPIC_KEY: the API refused model claude-haiku-5-5 \(400\).*credit balance is too low/ : /preflight: E2E_OPENAI_KEY is accepted/, engine);
  }
  const lines = [];
  await checkOtherKeys({engine: 'openai', env: {}, log: line => lines.push(line), fetchImpl: refusing});
  assert.deepEqual(lines, ['  preflight: no E2E_ANTHROPIC_KEY here']);
});

test('the app\'s own request shape is sent once to Claude, and a 400 on it stops the suite with the API\'s words; a limit does not', async () => {
  const bodies = [];
  const sending = status => async (url, options) => {
    if (!url.endsWith('/v1/messages')) return {status: 200};
    bodies.push(JSON.parse(options.body));
    return {status, json: async () => ({error: {message: 'output_config.effort is not supported'}})};
  };
  await assert.rejects(checkKeyAccepted({engine: 'api', key: 'k', fetchImpl: sending(400)}), /own request shape on claude-haiku-5-5 \(400\).*effort is not supported/);
  await checkKeyAccepted({engine: 'api', key: 'k', fetchImpl: sending(429)});
  await checkKeyAccepted({engine: 'openai', key: 'k', fetchImpl: sending(400)});
  assert.equal(bodies.length, 2);   // never on OpenAI
  assert.equal(bodies[0].output_config.format.type, 'json_schema');
  assert.equal(bodies[0].output_config.effort, 'low');
  assert.ok(bodies[0].max_tokens <= 256);
});

// 18 Oct 2026 (strategy refusals): a refusal prints the request's shape and the key's fingerprint, never the key, and only the first three.
test('describeRefusal: the first three refusals say the request-id, model, max_tokens, size and a key fingerprint, never the key', async () => {
  const {describeRefusal} = await import('../lib/ai-proxy.mjs');
  const {keyFingerprint} = await import('../lib/key-check.mjs');
  const lines = [], stats = {inflight: 2};
  const answer = {status: 400, headers: new Headers({'request-id': 'req_abc'})}, req = {headers: {'x-api-key': 'sk-ant-secret-value'}};
  for (let n = 0; n < 5; n++) describeRefusal(stats, answer, req, Buffer.from(JSON.stringify({model: 'claude-haiku-5-5', max_tokens: 4000})), line => lines.push(line));
  assert.equal(lines.length, 3);
  assert.match(lines[0], /400: request-id req_abc, model claude-haiku-5-5, max_tokens 4000, input \d+ bytes, 2 in flight, key fingerprint [0-9a-f]{8}/);
  assert.ok(lines[0].includes(keyFingerprint('sk-ant-secret-value')));
  assert.ok(!lines.join('\n').includes('secret-value'));
  assert.equal(keyFingerprint(''), 'none');
});

test('an empty credit balance (a 400 on the app-shaped call) stops the run with the API\'s own words', async () => {
  const credit = async url => (/\/v1\/messages$/.test(url) ? {status: 400, json: async () => ({error: {message: 'Your credit balance is too low to access the Anthropic API.'}})} : {status: 200});
  await assert.rejects(checkKeyAccepted({engine: 'api', key: 'k', fetchImpl: credit}), /credit balance is too low/);
});

test('the app on codex: the placeholder key is never sent to the provider, so a 401 from it cannot stop the suite; any other provider still checks', async () => {
  const {checkAppKey} = await import('../lib/key-check.mjs');
  let asked = 0;
  const refusing = async () => { asked++; return new Response('{"error":{"message":"invalid x-api-key"}}', {status: 401}); };
  const lines = [];
  assert.equal(await checkAppKey({provider: 'codex', engine: 'api', key: 'sk-ant-api03-placeholder', fetchImpl: refusing, log: line => lines.push(line)}), false);
  assert.equal(asked, 0, 'nothing is asked of api.anthropic.com');
  assert.match(lines[0], /app is on Codex/);
  for (const provider of ['free', 'claude'])
    await assert.rejects(checkAppKey({provider, engine: 'api', key: 'sk-ant-api03-placeholder', fetchImpl: refusing}), /refused \(401\)/);
});

test('the suite context checks the app key only through checkAppKey, so the codex rule cannot be skipped', () => {
  const context = fs.readFileSync(new URL('../lib/context.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(context, /\bcheckKeyAccepted\(/);
  assert.match(context, /checkAppKey\(\{provider: aiProvider\(process\.env, 'app'\)\.provider/);
});
