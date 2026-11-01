// The AI engine contract (lib/ai/): every adapter answers the same request with the same response shape, refuses what the contract does
// not carry, and turns its provider's failures into the contract's errors. Recorded answers only: fake SDKs and a fake process spawner,
// no network, no key, no real Claude Code or Codex. Also: no `new Anthropic` outside lib/ai/anthropic-api.js, and the price table the
// Worker keeps (app-core/src/ai.js) equals the app's.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {AiError, AiLimit, AiUnavailable, requestFrom} from '../lib/ai/contract.js';
import {AnthropicApi} from '../lib/ai/anthropic-api.js';
import {ClaudeCode} from '../lib/ai/claude-code-cli.js';
import {Codex, OFF, PDF_TEXT, SHELL} from '../lib/ai/codex-cli.js';
import {TIMEOUT_TEXT, electronPdfReader, pageText} from '../lib/ai/pdf-pages.js';
import {OpenAiApi, body} from '../lib/ai/openai-api.js';
import * as ai from '../lib/ai/index.js';
import {OPENAI_PRICES, model, openaiModel, priceOf} from '../lib/ai/models.js';
import {dropNulls, strict} from '../lib/ai/schema.js';
import * as claudeCode from '../lib/claude-code.js';
import * as worker from '../../app-core/src/ai-prices.js';   // not ai.js: it imports the Worker's SDK, which the desktop job does not install

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = {type: 'object', required: ['summary'], properties: {summary: {type: 'string'}, note: {type: 'string'}}};
const PDF = {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF fake').toString('base64')}};
const PNG = {type: 'image', source: {type: 'base64', media_type: 'image/png', data: Buffer.from('png').toString('base64')}};
const params = (extra = {}) => ({model: 'claude-sonnet-5-5', max_tokens: 500, system: [{type: 'text', text: 'Be brief.', cache_control: {type: 'ephemeral'}}],
  messages: [{role: 'user', content: [PDF, PNG, {type: 'text', text: 'Summarise.'}]}], output_config: {format: {type: 'json_schema', schema: SCHEMA}}, ...extra});

// A spawned process that answers from respond({args, prompt, cwd, files}) -> {stdout, stderr, code}; every call is kept.
function fakeSpawn(respond) {
  const calls = [];
  const spawnFn = (binary, args, {cwd}) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    child.stdin = {on: () => {}, end: prompt => setImmediate(() => {
      const call = {binary, args, prompt, cwd, files: fs.readdirSync(cwd).sort(),
        schema: args.includes('--output-schema') ? JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8')) : null};
      calls.push(call);
      const {stdout = '', stderr = '', code = 0} = respond(call, calls.length);
      child.stdout.emit('data', stdout); child.stderr.emit('data', stderr); child.emit('close', code);
    })};
    return child;
  };
  return {spawnFn, calls};
}
const claudeFlags = (binary, args, options, callback) => callback(null, '--output-format --model --tools --allowedTools --permission-mode --json-schema --no-session-persistence');
const codexFeatures = (binary, args, options, callback) => callback(null, `${SHELL}  stable  true\nplugins  stable  true\nhooks  beta  false\nsomething_new  beta  false\n`);
const codexEvents = (text, usage = {input_tokens: 120, cached_input_tokens: 20, output_tokens: 8}) =>
  [{type: 'thread.started'}, {type: 'turn.started'}, {type: 'item.completed', item: {type: 'agent_message', text}}, {type: 'turn.completed', usage}]
    .map(event => JSON.stringify(event)).join('\n');

// The app's PDF reader (ai/pdf-pages.js renders in a window): here two pages and the text.
const readPdf = async list => list.map(() => ({pages: [Buffer.from('page1').toString('base64'), Buffer.from('page2').toString('base64')], text: 'Nine years at Acme'}));

// The four engines, each answering {"summary":"done"} the way its provider does.
function engines() {
  const anthropicSdk = {messages: {create: async sent => ({id: 'm', type: 'message', model: sent.model, stop_reason: 'end_turn',
    content: [{type: 'text', text: '{"summary":"done"}'}], usage: {input_tokens: 100, output_tokens: 8}, sent})}};
  const openaiSdk = {sent: [], responses: {create: async sent => { openaiSdk.sent.push(sent); return {model: sent.model, status: 'completed',
    output: [{type: 'message', content: [{type: 'output_text', text: '{"summary":"done","note":null}'}]}], output_text: '{"summary":"done","note":null}',
    usage: {input_tokens: 120, input_tokens_details: {cached_tokens: 20}, output_tokens: 8}}; }}};
  const claude = fakeSpawn(() => ({stdout: JSON.stringify({type: 'result', subtype: 'success', is_error: false, result: '',
    structured_output: {summary: 'done'}, usage: {input_tokens: 100, output_tokens: 8}})}));
  const codex = fakeSpawn(() => ({stdout: codexEvents('{"summary":"done","note":null}')}));
  return {
    api: {adapter: new AnthropicApi({sdk: anthropicSdk}), billing: 'api', provider: 'anthropic'},
    cli: {adapter: new ClaudeCode({binary: '/fake/claude', spawnFn: claude.spawnFn, run: claudeFlags}), billing: 'subscription', provider: 'anthropic', calls: claude.calls},
    openai: {adapter: new OpenAiApi({sdk: openaiSdk, env: {}, action: 'cv'}), billing: 'api', provider: 'openai', sent: openaiSdk.sent},
    codex: {adapter: new Codex({binary: '/fake/codex', spawnFn: codex.spawnFn, run: codexFeatures, env: {}, pdfReader: readPdf}), billing: 'subscription', provider: 'openai', calls: codex.calls},
  };
}

test('every engine: the same request, the same response shape, structured answer in the caller\'s shape, usage billed right', async () => {
  const all = engines();
  assert.deepEqual(Object.keys(all).sort(), [...ai.NAMES].sort());   // a new engine must be added here
  for (const [name, {adapter, billing, provider}] of Object.entries(all)) {
    assert.equal(adapter.engine, name);
    assert.equal(adapter.family, ai.ENGINES[name].family);
    const answer = await adapter.messages.create(params());
    assert.equal(answer.content[0].type, 'text', name);
    assert.deepEqual(JSON.parse(answer.content[0].text), {summary: 'done'}, `${name}: the null for "note" is dropped`);
    assert.equal(answer.stop_reason, 'end_turn', name);
    assert.equal(answer.usage.billing, billing, name);
    assert.equal(answer.usage.provider, provider, name);
    assert.ok(Number.isInteger(answer.usage.input_tokens) && Number.isInteger(answer.usage.output_tokens), name);
    await assert.rejects(adapter.messages.create({...params(), temperature: 0.2}), /not part of the AI contract.*temperature/, `${name}: unknown params throw`);
    await assert.rejects(adapter.messages.create({...params(), tools: [{type: 'bash'}]}), /only the web search tool/, name);
  }
});

test('OpenAI API: the Responses body, cached tokens, refusal, cut-off, and errors as the contract\'s', async () => {
  const {openai} = engines();
  await openai.adapter.messages.create(params());
  const [sent] = openai.sent;
  assert.equal(sent.model, 'gpt-6.1-sol');   // sonnet -> main tier
  assert.equal(sent.instructions, 'Be brief.');
  assert.equal(sent.store, false);
  assert.equal(sent.prompt_cache_key, 'jobadabra-cv');
  assert.deepEqual(sent.input[0].content.map(part => part.type), ['input_file', 'input_image', 'input_text']);
  assert.match(sent.input[0].content[0].file_data, /^data:application\/pdf;base64,/);
  assert.deepEqual(sent.text.format.schema, strict(SCHEMA));
  assert.deepEqual(sent.text.format.schema.required, ['summary', 'note']);
  assert.equal(sent.text.format.schema.additionalProperties, false);
  assert.ok(sent.max_output_tokens > 500);   // headroom for reasoning
  const big = body(requestFrom({model: 'claude-opus-5-5', max_tokens: 10, messages: [{role: 'user', content: 'x'}], tools: [{type: 'web_search_20250305', max_uses: 3}]}), {env: {}});
  assert.deepEqual(big.reasoning, {effort: 'high'});
  assert.deepEqual(big.tools, [{type: 'web_search'}]);
  assert.equal(big.max_tool_calls, 3);
  const answering = output => new OpenAiApi({env: {}, sdk: {responses: {create: async () => output}}});
  const ask = {model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'x'}]};
  const refused = await answering({status: 'completed', output: [{type: 'message', content: [{type: 'refusal', refusal: 'No.'}]}]}).messages.create(ask);
  assert.equal(refused.stop_reason, 'refusal');
  const cut = await answering({status: 'incomplete', incomplete_details: {reason: 'max_output_tokens'}, output_text: 'par'}).messages.create(ask);
  assert.equal(cut.stop_reason, 'max_tokens');
  const used = await answering({status: 'completed', model: 'gpt-6-luna', output_text: 'ok', usage: {input_tokens: 100, input_tokens_details: {cached_tokens: 40}, output_tokens: 5}}).messages.create(ask);
  assert.deepEqual([used.usage.input_tokens, used.usage.cache_read_input_tokens, used.usage.model], [60, 40, 'gpt-6-luna']);
  const failing = error => new OpenAiApi({env: {}, sdk: {responses: {create: async () => { throw error; }}}}).messages.create(ask);
  await assert.rejects(failing(Object.assign(new Error('bad key'), {status: 401})), error => error instanceof AiLimit && error.final);
  await assert.rejects(failing(Object.assign(new Error('quota'), {status: 429, code: 'insufficient_quota'})), error => error instanceof AiLimit && /spend limit/.test(error.message));
  await assert.rejects(failing(Object.assign(new Error('slow down'), {status: 429})), AiUnavailable);
  await assert.rejects(failing(Object.assign(new Error('boom'), {status: 503})), AiUnavailable);
  await assert.rejects(failing(Object.assign(new Error('socket hang up'), {name: 'APIConnectionError'})), AiUnavailable);
  await assert.rejects(failing(Object.assign(new Error('timed out'), {name: 'APIConnectionTimeoutError'})), AiUnavailable);
  const bug = new TypeError('x is undefined');
  await assert.rejects(failing(bug), error => error === bug, 'a bug is never turned into an AI error');
  await assert.rejects(failing(Object.assign(new Error('bad request'), {status: 400})), error => error instanceof AiError && !(error instanceof AiLimit));
  await assert.rejects(new OpenAiApi({env: {}}).messages.create(ask), error => error instanceof AiLimit && /OpenAI API key/.test(error.message));
});

test('Codex: its own folder, read-only, user config and the shell off, strict schema file, a PDF only as page pictures + its text', async () => {
  const {codex} = engines();
  await codex.adapter.messages.create(params());
  const [call] = codex.calls;
  const flag = name => call.args[call.args.indexOf(name) + 1];
  const disabled = name => call.args.some((arg, i) => arg === name && call.args[i - 1] === '--disable');
  assert.deepEqual(call.args.slice(0, 5), ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-s']);
  assert.equal(flag('-s'), 'read-only');
  assert.equal(flag('-C'), call.cwd);
  assert.ok(call.args.includes('--ignore-user-config') && call.args.includes('--ignore-rules'));
  assert.equal(flag('-m'), 'gpt-6.1-sol');
  assert.ok(disabled('plugins') && !call.args.includes('something_new'));   // only features this Codex lists, only from OFF
  assert.ok(OFF.includes('plugins'));
  assert.ok(disabled(SHELL), 'the shell is always off, even with a PDF');
  assert.ok(call.args.includes('web_search="disabled"'));
  assert.deepEqual(call.schema, strict(SCHEMA));
  assert.ok(!call.files.some(name => name.endsWith('.pdf')), 'a PDF never reaches Codex as a file');
  assert.deepEqual(call.files.filter(name => name.startsWith('image-')), ['image-1.png', 'image-2.png', 'image-3.png']);   // 2 pages + the PNG
  assert.equal(call.args.filter(arg => arg === '-i').length, 3);
  assert.equal(call.args.at(-1), '-');
  assert.match(call.prompt, /^\[attached PDF \.\/document-1\.pdf, its text:\]\nNine years at Acme/);   // the question only: the system prompt is a file
  assert.ok(call.files.includes('instructions.md'));
  assert.equal(call.args[call.args.lastIndexOf('-c') + 1], `model_instructions_file=${JSON.stringify(path.join(call.cwd, 'instructions.md'))}`);
  assert.ok(!fs.existsSync(call.cwd), 'the call folder is removed');
  // No PDF reader (a process without windows): the call fails before Codex runs, saying why.
  const none = fakeSpawn(() => ({stdout: codexEvents('x')}));
  await assert.rejects(new Codex({binary: '/fake/codex', run: codexFeatures, env: {}, spawnFn: none.spawnFn, pdfReader: null}).messages.create(params()),
    error => error instanceof AiError && error.message === PDF_TEXT);
  assert.equal(none.calls.length, 0);
  // Text only: the small tier.
  const text = engines().codex;
  await text.adapter.messages.create({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'hi'}]});
  assert.equal(text.calls[0].args[text.calls[0].args.indexOf('-m') + 1], 'gpt-6-luna');
});

test('a PDF page\'s text in reading order: lines by position, words of one line joined', () => {
  assert.equal(pageText([{str: 'Acme', x: 200, y: 50, h: 10}, {str: 'Sam', x: 10, y: 10, h: 12}, {str: '2016-2025', x: 10, y: 51, h: 10}, {str: ' ', x: 0, y: 90, h: 1}]),
    'Sam\n2016-2025 Acme');
});

test('the CLI engines: signed out and plan limit are AiLimit; a bad structured answer is repaired once; codex env drops the keys', async () => {
  const failing = stdout => new Codex({binary: '/fake/codex', run: codexFeatures, env: {},
    spawnFn: fakeSpawn(() => ({stdout, code: 1})).spawnFn}).messages.create({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'x'}]});
  await assert.rejects(failing(JSON.stringify({type: 'error', message: 'Not logged in. Run codex login'})), error => error instanceof AiLimit && error.kind === 'signed-out' && error.final);
  await assert.rejects(failing(JSON.stringify({type: 'turn.failed', error: {message: 'You\'ve hit your usage limit'}})), error => error instanceof AiLimit && error.kind === 'limit' && !error.final);
  await assert.rejects(failing('garbage'), error => error instanceof AiError && error.kind === 'failed');
  await assert.rejects(new Codex({binary: ''}).messages.create({model: 'm', messages: []}), error => error instanceof AiLimit && error.kind === 'missing');
  const repair = fakeSpawn((call, n) => ({stdout: codexEvents(n === 1 ? 'not json' : '{"summary":"fixed","note":null}')}));
  const fixed = await new Codex({binary: '/fake/codex', run: codexFeatures, env: {}, spawnFn: repair.spawnFn, log: () => {}})
    .messages.create({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'x'}], output_config: {format: {type: 'json_schema', schema: SCHEMA}}});
  assert.deepEqual(JSON.parse(fixed.content[0].text), {summary: 'fixed'});
  assert.equal(repair.calls.length, 2);
  assert.equal(fixed.usage.input_tokens, 200);   // both calls counted
  const env = new Codex({env: {PATH: '/bin', OPENAI_API_KEY: 'sk', CODEX_API_KEY: 'c', ANTHROPIC_API_KEY: 'a'}}).env();
  assert.deepEqual(Object.keys(env), ['PATH']);
});

test('fallback: only on the user\'s tick, only within the family, after a plan limit', async () => {
  const limited = fakeSpawn(() => ({stdout: JSON.stringify({type: 'turn.failed', error: {message: 'usage limit reached'}}), code: 1}));
  let fellTo = null;
  const fallback = () => (fellTo = {messages: {create: async () => ({content: [{type: 'text', text: 'from the API'}], usage: {billing: 'api'}})}});
  const codex = new Codex({binary: '/fake/codex', run: codexFeatures, env: {}, spawnFn: limited.spawnFn, fallback, log: () => {}});
  const ask = {model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'x'}]};
  assert.equal((await codex.messages.create(ask)).content[0].text, 'from the API');
  assert.ok(codex.fellBack && fellTo);
  await codex.messages.create(ask);
  assert.equal(limited.calls.length, 1, 'the rest of the run goes to the fallback');
  const store = (settings, secrets = {}) => ({settings: () => settings, secret: name => secrets[name] || ''});
  assert.equal(ai.client(store({aiEngine: 'codex'}, {OPENAI_API_KEY: 'sk', ANTHROPIC_API_KEY: 'a'})).fallback, null, 'no tick, no fallback');
  const ticked = ai.client(store({aiEngine: 'codex', aiFallback: true}, {OPENAI_API_KEY: 'sk', ANTHROPIC_API_KEY: 'a'}));
  assert.equal(ticked.fallback().engine, 'openai');
  assert.equal(ai.client(store({aiEngine: 'cli', aiFallback: true}, {ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'sk'})).fallback().engine, 'api');
  assert.equal(ai.client(store({aiEngine: 'codex', aiFallback: true}, {ANTHROPIC_API_KEY: 'a'})).fallback, null, 'never Claude for an OpenAI engine');
});

test('the registry: the choice, readiness, family, Always on, and the factory never switching families', () => {
  const store = (settings, secrets = {}) => ({settings: () => settings, secret: name => secrets[name] || ''});
  assert.equal(ai.chosen({}, {}), null);
  assert.equal(ai.chosen({}, {ANTHROPIC_API_KEY: 'a'}), 'api');
  assert.equal(ai.chosen({aiEngine: 'codex'}, {}), 'codex');
  assert.equal(ai.ready({aiEngine: 'openai'}, {ANTHROPIC_API_KEY: 'a'}), false);
  assert.equal(ai.ready({aiEngine: 'openai'}, {OPENAI_API_KEY: 'sk'}), true);
  assert.equal(ai.ready({aiEngine: 'codex'}, {}), true);
  assert.equal(ai.family({aiEngine: 'codex'}, {}), 'openai');
  assert.equal(ai.family({aiEngine: 'cli'}, {}), 'claude');
  assert.equal(ai.alwaysOnEngine({aiEngine: 'codex'}, {}), 'openai');
  assert.equal(ai.alwaysOnEngine({aiEngine: 'cli'}, {}), 'api');
  assert.equal(ai.client(store({aiEngine: 'openai'}, {ANTHROPIC_API_KEY: 'a'})).engine, 'openai', 'OpenAI chosen without its key: never the Anthropic key');
  assert.equal(ai.client(store({aiEngine: 'api'}, {})), null);
  assert.equal(ai.client(store({aiEngine: 'api'}, {ANTHROPIC_API_KEY: 'a'})).engine, 'api');
  assert.equal(claudeCode.client(store({aiEngine: 'api'}, {ANTHROPIC_API_KEY: 'a'})), null, 'the old callers keep using their key for the API');
  assert.equal(claudeCode.client(store({aiEngine: 'openai'}, {OPENAI_API_KEY: 'sk'})).engine, 'openai');
  assert.equal(claudeCode.aiReady({aiEngine: 'openai'}, true, false), false);
  assert.deepEqual(claudeCode.pipelineVariables({aiEngine: 'openai'}, false, true), {JOBADABRA_AI_ENGINE: 'openai'});
  assert.deepEqual(claudeCode.pipelineVariables({aiEngine: 'codex', codex: {path: '/x/codex'}, aiFallback: true}, true, true),
    {JOBADABRA_AI_ENGINE: 'codex', JOBADABRA_CODEX_BIN: '/x/codex', JOBADABRA_AI_FALLBACK: 'openai'});
  assert.deepEqual(claudeCode.pipelineVariables({aiEngine: 'codex', aiFallback: true}, true, false), {JOBADABRA_AI_ENGINE: 'codex'});
});

test('models by tier, env overrides, and one price table in the app and the Worker', () => {
  assert.equal(model('small'), 'claude-haiku-5-5');
  assert.equal(model('small', 'openai', {}), 'gpt-6-luna');
  assert.equal(model('main', 'openai', {JOBADABRA_OPENAI_MAIN_MODEL: 'gpt-x'}), 'gpt-x');
  assert.deepEqual(openaiModel('claude-opus-5-5', null, {}), {model: 'gpt-6.1-sol', effort: 'high'});
  assert.deepEqual(openaiModel('gpt-6-luna', 'low', {}), {model: 'gpt-6-luna', effort: 'low'});
  assert.deepEqual(worker.OPENAI_PRICES, OPENAI_PRICES);
  const claudePrice = {input: 3, output: 15};
  for (const usage of [{provider: 'openai', model: 'gpt-6-luna'}, {provider: 'openai', model: 'unknown'}, {provider: 'anthropic'}, {}]) {
    assert.deepEqual(worker.priceOf(usage, claudePrice), priceOf(usage, claudePrice));
  }
  assert.deepEqual(priceOf({provider: 'openai', model: 'gpt-6-luna'}, claudePrice), OPENAI_PRICES['gpt-6-luna']);
  assert.deepEqual(priceOf({provider: 'anthropic'}, claudePrice), claudePrice);
  assert.deepEqual(dropNulls({summary: 'a', note: null}, SCHEMA), {summary: 'a'});
});

test('no `new Anthropic` outside lib/ai/anthropic-api.js: every app AI call goes through the one factory', () => {
  const roots = ['lib', 'renderer', 'main.js'].map(name => path.join(here, '..', name));
  const files = roots.flatMap(function walk(file) {
    if (fs.statSync(file).isDirectory()) return fs.readdirSync(file).flatMap(name => walk(path.join(file, name)));
    return /\.(m?js|cjs)$/.test(file) ? [file] : [];
  });
  const found = files.filter(file => !file.endsWith(path.join('lib', 'ai', 'anthropic-api.js')) && /new Anthropic\s*\(/.test(fs.readFileSync(file, 'utf8')))
    .map(file => path.relative(path.join(here, '..'), file));
  assert.deepEqual(found, []);
});

test('Always on: the OpenAI family runs on GitHub as the OpenAI API engine with its key; Claude stays the default (variable removed)', async () => {
  const github = await import('../lib/github.js');
  const payload = (settings, secrets) => github.payload({settings: () => settings, saveSettings: () => {}, readText: () => '', secret: name => secrets[name] || ''});
  const codex = payload({aiEngine: 'codex', codex: {path: '/x/codex'}}, {OPENAI_API_KEY: 'sk-o', NOTION_TOKEN: 'ntn'});
  assert.equal(codex.variables.JOBADABRA_AI_ENGINE, 'openai');
  assert.equal(codex.secrets.OPENAI_API_KEY, 'sk-o');
  assert.ok(!('JOBADABRA_CODEX_BIN' in codex.variables));
  assert.ok(codex.variables.JOBADABRA_SCORE_MODEL, 'the AI steps run: the OpenAI key is there');
  const claude = payload({aiEngine: 'cli'}, {ANTHROPIC_API_KEY: 'sk-a'});
  assert.ok(!('JOBADABRA_AI_ENGINE' in claude.variables));
  assert.ok(claude.removed.includes('JOBADABRA_AI_ENGINE'));
});

test('Codex Verify is as locked down as a call: same folder rules, tools and shell off, no web search; the result is kept', async () => {
  const {verifyCodex} = await import('../lib/ai/codex-cli.js');
  const spawned = fakeSpawn(() => ({stdout: codexEvents('OK')}));
  let saved = null;
  const result = await verifyCodex({saveSettings: part => { saved = part; }}, {binary: () => '/fake/codex-verify', run: codexFeatures, spawnFn: spawned.spawnFn, now: () => new Date(0)});
  const [call] = spawned.calls;
  const disabled = name => call.args.some((arg, i) => arg === name && call.args[i - 1] === '--disable');
  assert.ok(disabled(SHELL) && disabled('plugins'));
  assert.ok(call.args.includes('--ignore-user-config') && call.args.includes('--ignore-rules') && call.args.includes('web_search="disabled"'));
  assert.equal(call.args[call.args.indexOf('-s') + 1], 'read-only');
  assert.deepEqual([result.installed, result.authenticated, saved.codex.checkedAt], [true, true, new Date(0).toISOString()]);
  const signedOut = fakeSpawn(() => ({stdout: JSON.stringify({type: 'error', message: 'Not logged in'}), code: 1}));
  const out = await verifyCodex({saveSettings: () => {}}, {binary: () => '/fake/codex-verify', run: codexFeatures, spawnFn: signedOut.spawnFn});
  assert.deepEqual([out.installed, out.authenticated], [true, false]);
  assert.match(out.error, /codex login/);
});

test('an OpenAI-family limit reads as OpenAI\'s and links OpenAI\'s page, never Anthropic\'s console', async () => {
  const {aiLimitHead} = await import('../renderer/run-status.js');
  const {billingLabel} = await import('../renderer/ai-engine-view.js');
  const codex = aiLimitHead({ok: false, kind: 'search', billing: 'ChatGPT plan',
    log: ['Codex: your ChatGPT plan\'s usage limit is reached, so this AI step is paused; try again later, when the limit resets.']}, 'Jobs check');
  assert.equal(codex.fix.url, 'https://chatgpt.com/codex/settings/usage');
  assert.match(codex.summary, /ChatGPT plan/);
  const credit = aiLimitHead({ok: false, kind: 'search', billing: 'OpenAI API credits',
    log: ['OpenAI: your API account has no credit left or reached its spend limit (platform.openai.com → Billing), so this AI step is paused.']}, 'Jobs check');
  assert.equal(credit.fix.url, 'https://platform.openai.com/settings/organization/limits');
  const anthropic = aiLimitHead({ok: false, kind: 'search', log: ['Your credit balance is too low to access the Anthropic API.']}, 'Jobs check');
  assert.match(anthropic.fix.url, /console\.anthropic\.com/);
  assert.equal(billingLabel({billing: 'ChatGPT plan'}), 'Codex · your plan');
});

test('two PDFs in one call: one read, one window, both as pages + text; a stuck read fails in time and still closes the window', async () => {
  const reads = [];
  const spawned = fakeSpawn(() => ({stdout: codexEvents('ok')}));
  const codex = new Codex({binary: '/fake/codex', run: codexFeatures, env: {}, spawnFn: spawned.spawnFn,
    pdfReader: async list => { reads.push(list.length); return list.map((_, i) => ({pages: [Buffer.from(`p${i}`).toString('base64')], text: `CV ${i + 1}`})); }});
  await codex.messages.create({model: 'claude-haiku-5-5', messages: [{role: 'user', content: [PDF, {type: 'text', text: 'Compare.'}, PDF]}]});
  assert.deepEqual(reads, [2]);
  const [call] = spawned.calls;
  assert.match(call.prompt, /\[attached PDF \.\/document-1\.pdf, its text:\]\nCV 1[\s\S]*\[attached PDF \.\/document-2\.pdf, its text:\]\nCV 2/);
  assert.deepEqual(call.files, ['image-1.png', 'image-2.png']);
  // The window side, with a fake probe: one window for both PDFs, the second opened in it, closed once.
  const events = [];
  const probe = async () => { events.push('window'); return {open: async () => events.push('open'), scan: async () => [{n: 1, text: [{str: 'Hi', x: 0, y: 0, h: 10}]}],
    page: async () => 'cG5n', close: () => events.push('close')}; };
  const read = electronPdfReader(null, {probe});
  const out = await read(['QQ==', 'Qg==']);
  assert.deepEqual(events, ['window', 'open', 'close']);
  assert.deepEqual(out.map(one => one.text), ['Hi', 'Hi']);
  // Stuck: an AiError within the limit, and the window is still closed.
  const stuckEvents = [];
  const stuck = async () => ({open: async () => {}, scan: () => new Promise(() => {}), page: async () => '', close: () => stuckEvents.push('close')});
  const began = Date.now();
  await assert.rejects(electronPdfReader(null, {probe: stuck, timeoutMs: 50})(['QQ==']), error => error instanceof AiError && error.message === TIMEOUT_TEXT);
  assert.ok(Date.now() - began < 2000);
  assert.deepEqual(stuckEvents, ['close']);
});

test('OpenAI API streams like the Anthropic SDK (the strategy draft\'s progress bar), and the cheap test model maps to the small tier', async () => {
  const sent = [];
  const events = [{type: 'response.created'}, {type: 'response.output_text.delta', delta: '{"summary":'}, {type: 'response.output_text.delta', delta: '"done","note":null}'},
    {type: 'response.completed', response: {model: 'gpt-6-luna', status: 'completed', output_text: '{"summary":"done","note":null}', usage: {input_tokens: 50, output_tokens: 9}}}];
  const sdk = {responses: {create: async params => { sent.push(params); return (async function* () { yield* events; })(); }}};
  const client = new OpenAiApi({sdk, env: {}});
  const stream = client.messages.stream({model: 'claude-haiku-5-5', max_tokens: 100, messages: [{role: 'user', content: 'x'}],
    output_config: {format: {type: 'json_schema', schema: SCHEMA}}});
  const seen = [];
  stream.on('text', (delta, snapshot) => seen.push(snapshot));
  const answer = await stream.finalMessage();
  assert.equal(sent[0].stream, true);
  assert.equal(sent[0].model, 'gpt-6-luna', 'CI\'s claude-haiku-5-5 override runs the small OpenAI model');
  assert.deepEqual(seen, ['{"summary":', '{"summary":"done","note":null}']);
  assert.deepEqual(JSON.parse(answer.content[0].text), {summary: 'done'});
  assert.equal(answer.usage.billing, 'api');
  assert.equal(await stream.finalMessage(), answer, 'asked twice, run once');
  const failing = new OpenAiApi({env: {}, sdk: {responses: {create: async () => { throw Object.assign(new Error('quota'), {status: 429, code: 'insufficient_quota'}); }}}});
  await assert.rejects(failing.messages.stream({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'x'}]}).finalMessage(), AiLimit);
  const cut = new OpenAiApi({env: {}, sdk: {responses: {create: async () => (async function* () { yield {type: 'response.output_text.delta', delta: 'x'}; })()}}});
  await assert.rejects(cut.messages.stream({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'x'}]}).finalMessage(), AiUnavailable);
  assert.throws(() => client.messages.stream({model: 'm', temperature: 1, messages: []}), /not part of the AI contract/);
});

// The Anthropic API refuses maxItems/minItems in a structured-output schema (400 invalid_request_error, 3 Oct 2026; again 12 Oct 2026 for the
// page-kind digest on the Ocado row in CI). Callers write them to cap their own lists; the one place every API ask passes through takes them out.
test('the Anthropic API engine never sends maxItems or minItems: create and stream, nested, for every schema the app builds', async () => {
  const {DIGEST_SCHEMA} = await import('../lib/ladder/rung3-digest.js');
  const nested = {type: 'object', properties: {list: {type: 'array', minItems: 1, maxItems: 3, items: {type: 'object', properties: {inner: {type: 'array', maxItems: 2, items: {type: 'string'}}}}}}};
  for (const schema of [DIGEST_SCHEMA, nested, SCHEMA]) {
    const sent = [];
    const sdk = {messages: {create: async body => { sent.push(body); return {content: [], usage: {}}; }, stream: body => { sent.push(body); return {}; }}};
    const api = new AnthropicApi({sdk});
    const ask = {...params(), output_config: {format: {type: 'json_schema', schema}, effort: 'low'}};
    await api.messages.create(ask);
    api.messages.stream(ask);
    assert.equal(sent.length, 2);
    for (const body of sent) {
      assert.doesNotMatch(JSON.stringify(body.output_config), /maxItems|minItems/, 'a limit reached the API');
      assert.equal(body.output_config.effort, 'low', 'the rest of output_config is kept');
      assert.deepEqual(body.system, ask.system, 'cache_control and the rest are as the caller wrote them');
    }
    assert.match(JSON.stringify(ask.output_config), schema === SCHEMA ? /^(?!.*maxItems)/ : /maxItems/, 'the caller\'s own schema is not changed');
  }
});

test('the step that asks (x-jp-action) reaches the Anthropic SDK as a header, and every writing call site names one', async () => {
  const seen = [];
  const api = new AnthropicApi({sdk: {messages: {create: async (params, options) => { seen.push(options); return {content: [{type: 'text', text: 'x'}], usage: {input_tokens: 1, output_tokens: 1}}; }}}});
  const ask = {model: 'm', max_tokens: 5, messages: [{role: 'user', content: 'hi'}]};
  await api.messages.create(ask, {headers: {'x-jp-action': 'tailor'}});
  await api.messages.create(ask);
  assert.deepEqual(seen, [{headers: {'x-jp-action': 'tailor'}}, undefined]);
  // The class: every call site that writes prose for the person (and the form-answer call) names its step.
  const named = {'lib/cv.js': 'tailor', 'lib/cv-change.js': 'tailor', 'lib/cv-check.js': 'tailor', 'lib/cover-letter.js': 'cover_letter', '../app-core/src/extension.js': 'answer', '../app-core/src/written-answer.js': 'answer_review'};
  for (const [file, action] of Object.entries(named)) assert.match(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), new RegExp(`'x-jp-action': '${action}'`), file);
});
