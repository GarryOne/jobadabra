// The test code's way to ask a model: `claude -p` on a Mac (flags that keep the call small), the API in CI.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CLI_FLAGS, cliCall, messagesAnswer, modelClient, modelFetch} from '../lib/model.mjs';

const cli = () => 'cli';
const body = {model: 'claude-sonnet-5-5', max_tokens: 100, system: 'Be strict.', messages: [{role: 'user', content: 'Judge this.'}]};
const exec = result => async call => ({code: 0, stderr: '', stdout: JSON.stringify({result, usage: {input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 7}, ...call.extra}), call});

test('a Mac call strips the owner\'s MCP servers, skills, settings and tools, so it stays small', () => {
  for (const flag of ['--tools', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '--no-session-persistence']) assert.ok(CLI_FLAGS.includes(flag), flag);
  const {args, prompt} = cliCall(body);
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'claude-sonnet-5-5']);
  assert.equal(args[args.indexOf('--system-prompt') + 1], 'Be strict.');
  assert.match(prompt, /Judge this\./);
});

test('a system prompt sent as blocks (the form-answer ask, cached profile) reaches claude -p as its text, never "[object Object]"', () => {
  const {args} = cliCall({...body, system: [{type: 'text', text: 'Fill the form.'}, {type: 'text', text: '<profile>Zurich</profile>', cache_control: {type: 'ephemeral'}}]});
  const system = args[args.indexOf('--system-prompt') + 1];
  assert.ok(system.includes('Fill the form.\n<profile>Zurich</profile>'), system);
  assert.doesNotMatch(system, /object Object/);
});

test('through Claude Code the answer has the Messages shape the judges read', async () => {
  let seen;
  const response = await modelFetch('https://api.anthropic.com/v1/messages', {method: 'POST', body: JSON.stringify(body)}, {engine: cli, exec: async call => { seen = call; return exec('{"items":[]}')(call); }});
  const data = await response.json();
  assert.equal(response.ok, true);
  assert.equal(data.content[0].text, '{"items":[]}');
  assert.deepEqual(data.usage, {input_tokens: 15, output_tokens: 7});
  assert.ok(!seen.cwd.includes('job-pilotto'), 'the call runs in an empty folder, with no project around it');
});

test('a failing Claude Code is an error answer, never a pass', async () => {
  const response = await modelFetch('u', {body: JSON.stringify(body)}, {engine: cli, exec: async () => ({code: 1, stdout: '', stderr: 'not signed in'})});
  assert.equal(response.ok, false);
  assert.match((await response.json()).error.message, /no JSON.*not signed in/);
  const refused = await modelFetch('u', {body: JSON.stringify(body)}, {engine: cli, exec: async () => ({code: 0, stderr: '', stdout: JSON.stringify({is_error: true, result: 'limit reached'})})});
  assert.equal(refused.ok, false);
});

test('a tool-using caller (the explorer) gets a tool_use block back, and its history is sent as text', async () => {
  const tools = [{name: 'click', description: 'Press a control', input_schema: {type: 'object'}}];
  const request = {...body, tools, messages: [{role: 'user', content: 'start'}, {role: 'assistant', content: [{type: 'tool_use', name: 'click', input: {control: 2}}]}, {role: 'user', content: [{type: 'tool_result', content: 'page changed'}]}]};
  const {args, prompt} = cliCall(request);
  assert.match(args[args.indexOf('--system-prompt') + 1], /"tool": "<name>"/);
  assert.match(prompt, /you called click \{"control":2\}/);
  assert.match(prompt, /\[result\] page changed/);
  const answer = messagesAnswer({result: 'Sure. {"tool":"click","input":{"control":3}}', usage: {}}, request);
  assert.equal(answer.stop_reason, 'tool_use');
  assert.deepEqual([answer.content[0].name, answer.content[0].input], ['click', {control: 3}]);
});

test('a JSON-schema request is turned into an instruction, and modelClient has the SDK shape', async () => {
  const schema = {type: 'object', properties: {ok: {type: 'boolean'}}};
  assert.match(cliCall({...body, output_config: {format: {type: 'json_schema', schema}}}).args.join(' '), /matches this JSON schema/);
  const client = modelClient({engine: cli, exec: exec('{"ok":true}')});
  const result = await client.messages.create(body);
  assert.equal(result.content[0].text, '{"ok":true}');
});

test('in CI the call goes to the API untouched', async () => {
  const original = globalThis.fetch;
  let url;
  globalThis.fetch = async u => { url = u; return {ok: true}; };
  try { await modelFetch('https://api.anthropic.com/v1/messages', {body: '{}'}, {engine: () => 'api'}); } finally { globalThis.fetch = original; }
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
});

// CI on Free AI (owner, 26 Oct 2026: "Let's just switch to Free AI"): the judges' calls go to the relay on the runner with its JPF1 key, never to Anthropic with
// the Claude key; E2E_JUDGE_FAMILY=claude sends them back (lib/engine.mjs judgeFamily).
test('on Free AI the judges ask the relay with its own key; pinned to Claude they ask Anthropic as before', async () => {
  const original = globalThis.fetch, seen = [];
  globalThis.fetch = async (url, init) => { seen.push({url, key: init.headers['x-api-key']}); return new Response(JSON.stringify({content: [], usage: {}}), {status: 200}); };
  const relay = {CI: 'true', E2E_FREE_AI_URL: 'http://127.0.0.1:8787/api/ai', E2E_FREE_AI_KEY: 'JPF1.ci-e2e-x.t'};
  const ask = env => modelFetch('https://api.anthropic.com/v1/messages', {method: 'POST', headers: {'x-api-key': 'sk-ant-claude', 'content-type': 'application/json'}, body: '{}'}, {engine: () => 'api', env});
  try { await ask(relay); await ask({...relay, E2E_JUDGE_FAMILY: 'claude'}); } finally { globalThis.fetch = original; }
  assert.deepEqual(seen, [{url: 'http://127.0.0.1:8787/api/ai/v1/messages', key: 'JPF1.ci-e2e-x.t'}, {url: 'https://api.anthropic.com/v1/messages', key: 'sk-ant-claude'}]);
});

// The judges replay like the app (owner, 27 Oct 2026: "Code gate + AI rate"; "with the judges replaying in the gate too"): main's quality run asked its 21 judge
// calls live every time (0 replayed), so a judge's own wobble turned a gate red. A judge answer seen before is replayed; a fresh run (lib/ai-meter.mjs fresh) asks live.
test('a judge answer seen before is replayed, not asked again; a fresh run asks live', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-cache-'));
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({content: [{type: 'text', text: `verdict ${calls}`}], usage: {input_tokens: 5, output_tokens: 2}}), {status: 200, headers: {'content-type': 'application/json'}}); };
  const env = {CI: 'true', E2E_AI_REPLAY: '1', E2E_AI_CACHE: cache};
  const ask = (text, e = env) => modelFetch('https://api.anthropic.com/v1/messages', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({...body, messages: [{role: 'user', content: text}]})}, {engine: () => 'api', env: e}).then(r => r.json());
  try {
    assert.equal((await ask('Judge A.')).content[0].text, 'verdict 1');
    assert.equal((await ask('Judge A.')).content[0].text, 'verdict 1');   // replayed: the same answer, no second call
    assert.equal(calls, 1);
    assert.equal((await ask('Judge B.')).content[0].text, 'verdict 2');   // a new question is asked and kept
    assert.equal((await ask('Judge A.', {...env, E2E_AI_REPLAY: '0'})).content[0].text, 'verdict 3');   // fresh: asked live
  } finally { globalThis.fetch = original; fs.rmSync(cache, {recursive: true, force: true}); }
});
