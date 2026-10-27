// The AI engine the user chose (lib/claude-code.js) and its chooser's states (renderer/ai-engine-view.js), with a FAKE
// `claude` script: no real Claude Code, no API call, no key.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

import * as claudeCode from '../lib/claude-code.js';
import * as history from '../lib/run-history.js';
import * as pipeline from '../lib/pipeline.js';
import * as view from '../renderer/ai-engine-view.js';

const storage = (settings = {}, secrets = {}) => {
  let s = {...settings};
  return {settings: () => s, saveSettings: part => { s = {...s, ...part}; }, secret: name => secrets[name] || '',
    path: name => path.join(os.tmpdir(), name)};
};

// A fake `claude`: --version, --help, and `-p` answers as FAKE_MODE says; each call's args, stdin, folder and the
// auth variables it saw are appended to calls.json.
// POSIX only: the fake is a script with a shebang, and Windows runs a program only with a real extension. Its
// claude.exe (the native installer, what claudeBinary prefers there) cannot be faked in a test, and npm's claude.cmd
// cannot be launched at all without cmd.exe quoting this integration cannot do for a system prompt and a JSON schema
// (lib/claude-code.js runs it with execFile/spawn; lib/claude-session.js:107 says the same for its long argument).
// So the three tests that need a RUNNING Claude Code are Mac/Linux; the Windows discovery path is in app.test.js
// ("claudeBinary ... claude.cmd"), and Windows runs the app's own smoke test after build.
const FAKE_ONLY_POSIX = process.platform === 'win32' && 'the fake is a shebang script: Windows runs .exe/.cmd only';
function fakeClaude(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
  const file = path.join(dir, 'claude'), log = path.join(dir, 'calls.json');
  fs.writeFileSync(file, `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('2.1.7 (Claude Code)'); process.exit(0); }
if (args[0] === '--help') { console.log('--output-format --model --tools --allowedTools --permission-mode --json-schema --no-session-persistence --disable-slash-commands --setting-sources'); process.exit(0); }
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const calls = fs.existsSync(${JSON.stringify(log)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(log)}, 'utf8')) : [];
  calls.push({args, input, cwd: process.cwd(), files: fs.readdirSync('.').sort(), key: process.env.ANTHROPIC_API_KEY || null, base: process.env.ANTHROPIC_BASE_URL || null});
  fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(calls));
  const usage = {input_tokens: 9, output_tokens: 4};
  const mode = ${JSON.stringify(mode)};
  if (mode === 'ok') console.log(JSON.stringify({type: 'result', subtype: 'success', is_error: false, result: 'OK', usage}));
  if (mode === 'schema') console.log(JSON.stringify({type: 'result', subtype: 'success', is_error: false, result: '', structured_output: {summary: 'done'}, usage}));
  if (mode === 'repair') console.log(JSON.stringify({type: 'result', subtype: 'success', is_error: false, usage,
    result: calls.length === 1 ? 'no json here' : '{"summary": "fixed"}'}));
  if (mode === 'signed-out') { console.log(JSON.stringify({type: 'result', is_error: true, result: 'Invalid API key · Please run /login'})); process.exit(1); }
  if (mode === 'limit') { console.log(JSON.stringify({type: 'result', is_error: true, result: 'Claude AI usage limit reached|1760000000'})); process.exit(1); }
});
`, {mode: 0o755});
  return {file, calls: () => (fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : []), cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}

test('the engine is the user\'s choice; an install with a key from before keeps the API; nothing chosen is null', () => {
  assert.equal(claudeCode.engine({}, false), null);
  assert.equal(claudeCode.engine({}, true), 'api');
  assert.equal(claudeCode.engine({aiEngine: 'cli'}, true), 'cli');
  assert.equal(claudeCode.engine({aiEngine: 'api'}, false), 'api');
  assert.equal(claudeCode.aiReady({aiEngine: 'cli'}, false), true);
  assert.equal(claudeCode.aiReady({aiEngine: 'api'}, false), false);
});

test('jobs on this Mac get the choice; the plan-limit fallback only when ticked and a key exists', () => {
  assert.deepEqual(claudeCode.pipelineVariables({}, true), {JOB_PILOTTO_AI_ENGINE: 'api'});
  // Free AI or a key answers, the user's plan is signed in: its CLI does the web searches (owner, 26 Oct 2026)
  const signedIn = {claudeCode: {authenticated: true, path: '/x/claude'}, codex: {authenticated: true, path: '/x/codex'}};
  assert.deepEqual(claudeCode.pipelineVariables({aiEngine: 'api', ...signedIn}, true),
    {JOB_PILOTTO_AI_ENGINE: 'api', JOB_PILOTTO_PLAN_SEARCH: 'claude', JOB_PILOTTO_CLAUDE_BIN: '/x/claude'});
  assert.deepEqual(claudeCode.pipelineVariables({aiEngine: 'api', codex: signedIn.codex, claudeCode: {authenticated: false, path: '/x/claude'}}, true),
    {JOB_PILOTTO_AI_ENGINE: 'api', JOB_PILOTTO_PLAN_SEARCH: 'codex', JOB_PILOTTO_CODEX_BIN: '/x/codex'});
  assert.deepEqual(claudeCode.pipelineVariables({aiEngine: 'api', claudeCode: {installed: true, path: '/x/claude'}}, true), {JOB_PILOTTO_AI_ENGINE: 'api'}, 'signed out: no plan search');
  assert.deepEqual(claudeCode.pipelineVariables({aiEngine: 'cli', claudeCode: {path: '/x/claude'}}, true),
    {JOB_PILOTTO_AI_ENGINE: 'cli', JOB_PILOTTO_CLAUDE_BIN: '/x/claude'});
  assert.deepEqual(claudeCode.pipelineVariables({aiEngine: 'cli', aiFallback: true}, true), {JOB_PILOTTO_AI_ENGINE: 'cli', JOB_PILOTTO_AI_FALLBACK: 'api'});
  assert.deepEqual(claudeCode.pipelineVariables({aiEngine: 'cli', aiFallback: true}, false), {JOB_PILOTTO_AI_ENGINE: 'cli'});
  // pipelineEnv: Claude Code without a key still gets the models, so the AI steps run.
  const env = pipeline.pipelineEnv(storage({aiEngine: 'cli', claudeCode: {path: '/x/claude'}}), {PATH: '/usr/bin'});
  assert.equal(env.JOB_PILOTTO_AI_ENGINE, 'cli');
  assert.equal(env.JOB_PILOTTO_SCORE_MODEL, 'claude-sonnet-5-5');
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  // Claude Code's headless sign-in reaches the engine (a runner or Linux has no Keychain sign-in); absent, nothing is added.
  assert.equal(pipeline.pipelineEnv(storage({aiEngine: 'cli', claudeCode: {path: '/x/claude'}}), {PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 't'}).CLAUDE_CODE_OAUTH_TOKEN, 't');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.ok(pipeline.dailyArgs(storage({aiEngine: 'cli'}), {mode: 'run'}).includes('--score-max'));
  assert.ok(!pipeline.dailyArgs(storage({}), {mode: 'run'}).includes('--score-max'));
});

test('Claude Code gets the user\'s own environment: never the app\'s API key or the credit relay', () => {
  const env = claudeCode.cleanEnv({PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'sk-x', ANTHROPIC_BASE_URL: 'https://relay'});
  assert.deepEqual(env, {PATH: '/bin', HOME: '/h'});
});

test('detect: installed with its version and path; missing', {skip: FAKE_ONLY_POSIX}, async () => {
  const fake = fakeClaude('ok');
  try {
    assert.deepEqual(await claudeCode.detect({binary: () => fake.file}), {installed: true, path: fake.file, version: '2.1.7'});
    assert.deepEqual(await claudeCode.detect({binary: () => ''}), {installed: false, path: '', version: null});
  } finally { fake.cleanup(); }
});

test('verify: one tiny haiku call, no tools; signed in, signed out, over the limit, not installed', {skip: FAKE_ONLY_POSIX}, async () => {
  for (const [mode, authenticated, error] of [['ok', true, ''], ['signed-out', false, /run claude in Terminal|sign in/i], ['limit', true, /usage window/]]) {
    const fake = fakeClaude(mode), st = storage({}, {ANTHROPIC_API_KEY: 'sk-test'});
    try {
      const result = await claudeCode.verify(st, {binary: () => fake.file});
      assert.equal(result.authenticated, authenticated, mode);
      if (error) assert.match(result.error, error); else assert.equal(result.error, '');
      const [call] = fake.calls();
      assert.deepEqual(call.args.slice(0, 5), ['-p', '--output-format', 'json', '--model', 'haiku']);
      assert.equal(call.args[call.args.indexOf('--tools') + 1], '');
      assert.equal(call.key, null);  // the API key is never handed to Claude Code
      assert.equal(st.settings().claudeCode.version, '2.1.7');
      assert.equal(st.settings().claudeCode.authenticated, authenticated);
      assert.ok(!JSON.stringify(st.settings()).includes('sk-test'));
    } finally { fake.cleanup(); }
  }
  const st = storage();
  const missing = await claudeCode.verify(st, {binary: () => ''});
  assert.equal(missing.installed, false);
  assert.match(missing.error, /not installed/);
});

test('the app\'s own calls on Claude Code: a PDF becomes a file only Read may open; structured answers; one repair', {skip: FAKE_ONLY_POSIX}, async () => {
  const fake = fakeClaude('schema');
  try {
    const client = claudeCode.cliClient(fake.file);
    const response = await client.messages.create({model: 'claude-sonnet-5-5', system: 'Read the CV.', messages: [{role: 'user', content: [
      {type: 'document', source: {type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF fake').toString('base64')}},
      {type: 'text', text: 'Draft it.'}]}], output_config: {format: {type: 'json_schema', schema: {type: 'object', required: ['summary']}}}});
    assert.deepEqual(JSON.parse(response.content[0].text), {summary: 'done'});
    assert.equal(response.usage.billing, 'subscription');
    const [call] = fake.calls();
    assert.deepEqual(call.files, ['document-1.pdf']);
    assert.equal(call.args[call.args.indexOf('--tools') + 1], 'Read');
    assert.equal(call.args[call.args.indexOf('--allowedTools') + 1], 'Read(./**)');
    assert.equal(call.args[call.args.indexOf('--permission-mode') + 1], 'dontAsk');
    assert.equal(call.args[call.args.indexOf('--model') + 1], 'sonnet');
    assert.ok(call.args.includes('--json-schema'));
    // lean by default: no skills, slash commands or user settings loaded into a call that needs none (7,473 -> 651 tokens of context, about 0.4 s)
    assert.ok(call.args.includes('--disable-slash-commands'));
    assert.equal(call.args[call.args.indexOf('--setting-sources') + 1], '');
    assert.match(call.input, /\.\/document-1\.pdf/);
    assert.ok(!call.args.includes('--dangerously-skip-permissions'));
    assert.ok(!fs.existsSync(call.cwd));
  } finally { fake.cleanup(); }
  const repair = fakeClaude('repair');
  try {
    const response = await claudeCode.cliClient(repair.file).messages.create({model: 'claude-haiku-4-5', messages: [{role: 'user', content: 'x'}],
      output_config: {format: {type: 'json_schema', schema: {type: 'object', required: ['summary']}}}});
    assert.deepEqual(JSON.parse(response.content[0].text), {summary: 'fixed'});
    assert.equal(repair.calls().length, 2);
  } finally { repair.cleanup(); }
  const out = fakeClaude('limit');
  try {
    await assert.rejects(claudeCode.cliClient(out.file).messages.create({model: 'claude-haiku-4-5', messages: [{role: 'user', content: 'x'}]}),
      error => error.kind === 'limit' && /usage window/.test(error.message));
  } finally { out.cleanup(); }
  const client = claudeCode.client(storage({aiEngine: 'api'}, {ANTHROPIC_API_KEY: 'k'}));
  assert.equal(client, null);  // the API chosen: the callers use the key, as before
  assert.equal(claudeCode.client(storage({aiEngine: 'cli', claudeCode: {path: '/x/claude'}})).engine, 'cli');
});

test('the chooser: nothing picked in the wizard, the key kept in Settings, Continue only when it can run', () => {
  assert.equal(view.chosen({}, true, 'wizard'), null);
  assert.equal(view.chosen({}, false, 'settings'), null);
  assert.equal(view.chosen({}, true, 'settings'), 'api');  // existing installs: unchanged
  assert.equal(view.chosen({aiEngine: 'cli'}, true, 'wizard'), 'cli');
  const verified = {installed: true, version: '2.1.7', path: '/x/claude', authenticated: true, checkedAt: 'now'};
  assert.equal(view.canContinue({picked: null, status: verified}), false);
  assert.equal(view.canContinue({picked: 'cli', status: verified}), true);
  assert.equal(view.canContinue({picked: 'cli', status: {...verified, authenticated: false}}), false);
  assert.equal(view.canContinue({picked: 'api'}), false);
  assert.equal(view.canContinue({picked: 'api', keyTyped: true}), true);
  assert.equal(view.canContinue({picked: 'api', hasKey: true}), true);
  assert.deepEqual(view.cliStatus(verified).lines.map(line => line.text), ['Installed v2.1.7', 'Authenticated']);
  assert.match(view.cliStatus({installed: false}).lines[0].text, /Not installed/);
  assert.match(view.cliStatus({installed: true, version: '2.1.7'}).lines[1].text, /Not verified/);
  assert.equal(view.showFallback('cli', true), true);
  assert.equal(view.showFallback('cli', false), false);
  assert.equal(view.fallbackOn({}), false);  // off by default
  assert.equal(view.showOffer({}, true, {installed: true}), true);
  assert.equal(view.showOffer({aiEngineOffered: true}, true, {installed: true}), false);
  assert.equal(view.showOffer({aiEngine: 'api'}, true, {installed: true}), false);
  assert.equal(view.needsNotice({}), true);
  assert.equal(view.needsNotice({claudeCodeNotice: true}), false);
  assert.equal(view.TEXT.notice, claudeCode.NOTICE);
});

test('Recent activity says "Claude Code · your plan" for runs on the plan, dollars for the API', () => {
  const row = billed => ({id: 'r1', url: 'u', created_time: '2026-09-28T10:00:00Z', properties: {
    Started: {date: {start: '2026-09-28T10:00:00Z'}}, Mode: {select: {name: 'insight'}}, Status: {select: {name: 'OK'}},
    Summary: {rich_text: [{plain_text: 'Insight sent (Claude Code, your plan)'}]}, 'Duration (s)': {number: 5}, 'AI cost (USD)': {number: 0},
    'Billed to': billed ? {select: {name: billed}} : {select: null}}});
  const run = history.fromRow(row('Claude subscription'));
  assert.equal(run.billing, 'Claude subscription');
  assert.equal(run.result, 'Insight sent');
  assert.equal(view.billingLabel(run), 'Claude Code · your plan');
  assert.equal(view.billingLabel(history.fromRow(row(null))), null);
});

test('Always on (GitHub) never gets the Claude Code engine: it runs on the API key', async () => {
  const github = await import('../lib/github.js');
  const st = {settings: () => ({aiEngine: 'cli', aiFallback: true, claudeCode: {path: '/x/claude'}}), saveSettings: () => {},
    secret: name => ({ANTHROPIC_API_KEY: 'sk-test', NOTION_TOKEN: 'ntn'})[name] || '', readText: () => ''};
  const {variables, secrets} = github.payload(st);
  for (const name of ['JOB_PILOTTO_AI_ENGINE', 'JOB_PILOTTO_CLAUDE_BIN', 'JOB_PILOTTO_AI_FALLBACK']) assert.ok(!(name in variables), name);
  assert.equal(secrets.ANTHROPIC_API_KEY, 'sk-test');
});

// The Free card: chosen again when Free AI is on (wizard and Settings); Continue needs nothing typed.
test('Free card: chosen when on, Continue without a key', () => {
  assert.equal(view.chosen({aiFree: true}, true, 'wizard'), 'free');
  assert.equal(view.chosen({aiFree: true}, true, 'settings'), 'free');
  // Free is an Anthropic API engine: a later pick of another engine wins over a leftover aiFree flag.
  for (const aiEngine of ['cli', 'codex', 'openai']) assert.equal(view.chosen({aiFree: true, aiEngine}, true, 'wizard'), aiEngine);
  assert.equal(view.chosen({aiFree: true, aiEngine: 'api'}, true, 'wizard'), 'free');
  assert.equal(view.canContinue({picked: 'free'}), true);
});
