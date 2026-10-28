// How test code (the judges, the explorer) asks a model. CI posts to the Anthropic API with the test key; a Mac runs `claude -p` (this Mac's Claude Code, the plan's fixed price,
// never a key). `modelFetch` has fetch's shape for the Messages API, so a caller keeps its own request and answer handling and only the transport changes.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {capMessage, capReached, noteBrokerCapped, noteCapped} from './ai-cap.mjs';
import {aiProvider} from './ai-provider.mjs';
import {askBroker} from './broker-client.mjs';
import {judgeFamily, pickEngine} from './engine.mjs';
import {count, countReplay, keep, keepMiss, recall, requestKey, usageOf} from './ai-meter.mjs';
import {withoutWrappers} from './real-claude.mjs';   // never a terminal's claude wrapper (e2e/test/real-claude.test.mjs)

// A bare `claude -p` loads the owner's MCP servers, skills and settings: 106k tokens for a one-word answer. These flags leave about 400.
export const CLI_FLAGS = ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', ''];

const text = content => typeof content === 'string' ? content : (content || []).map(part => part.text ?? (part.type === 'tool_use' ? `[you called ${part.name} ${JSON.stringify(part.input)}]` : part.type === 'tool_result' ? `[result] ${typeof part.content === 'string' ? part.content : JSON.stringify(part.content)}` : '')).join('\n');

// A Messages request -> the arguments and the prompt for `claude -p`.
export function cliCall(body) {
  const schema = body.output_config?.format?.schema;
  const system = [text(body.system), ...(schema ? [`Reply with ONE JSON object that matches this JSON schema, and nothing else:\n${JSON.stringify(schema)}`] : []), ...(body.tools?.length ? [`You act by replying with ONE JSON object and nothing else: {"tool": "<name>", "input": {...}}, using exactly one of these tools:\n${JSON.stringify(body.tools.map(({name, description, input_schema}) => ({name, description, input_schema})))}`] : [])].filter(Boolean).join('\n\n');
  const prompt = body.messages.map(message => `${message.role === 'assistant' ? 'You' : 'User'}:\n${text(message.content)}`).join('\n\n');
  return {args: [...CLI_FLAGS, '--model', body.model, ...(system ? ['--system-prompt', system] : [])], prompt};
}

// The CLI's JSON -> a Messages answer (a tool call becomes a tool_use block).
export function messagesAnswer(out, body) {
  const result = String(out.result ?? '').trim();
  let content = [{type: 'text', text: result}];
  if (body.tools?.length) {
    try {
      const call = JSON.parse(result.slice(result.indexOf('{'), result.lastIndexOf('}') + 1));
      if (call && typeof call.tool === 'string') content = [{type: 'tool_use', id: `cli_${Date.now()}`, name: call.tool, input: call.input || {}}];
    } catch { /* plain text: the caller decides what that means */ }
  }
  const usage = out.usage || {};
  return {content, stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn', usage: {input_tokens: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0), output_tokens: usage.output_tokens || 0}};
}

const run = ({args, prompt, cwd, timeoutMs}) => new Promise(resolve => {
  const child = spawn('claude', args, {cwd, env: withoutWrappers(), stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '', stderr = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', error => { clearTimeout(timer); resolve({code: 1, stdout, stderr: error.message}); });
  child.on('close', code => { clearTimeout(timer); resolve({code, stdout, stderr}); });
  child.stdin.end(prompt);
});

// What the SDK's `client.messages.create(body)` is for code that takes a client (desktop/lib/match-check.js): the same call through `modelFetch`.
export const modelClient = ({key = '', ...options} = {}) => ({messages: {create: async body => {
  const response = await modelFetch('https://api.anthropic.com/v1/messages', {method: 'POST', headers: {'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01'}, body: JSON.stringify(body)}, options);
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${data?.error?.message || ''}`);
  return data;
}}});

const reply = (status, data) => ({ok: status < 400, status, json: async () => data});

// fetch-shaped. `engine`/`exec` can be replaced by a test.
// CI on Free AI (lib/engine.mjs judgeFamily): the same Messages call goes to the relay on the runner with its JPF1 key instead of Anthropic with the Claude key.
export function judgeTarget(url, init, env = process.env) {
  if (judgeFamily(env) !== 'free') return {url, init};
  return {url: String(url).replace(/^https:\/\/api\.anthropic\.com/, env.E2E_FREE_AI_URL), init: {...init, headers: {...init.headers, 'x-api-key': env.E2E_FREE_AI_KEY}}};
}

export async function modelFetch(url, init, {engine = () => pickEngine({family: 'claude'}), exec = run, timeoutMs = 5 * 60 * 1000, env = process.env} = {}) {
  if (engine() === 'api') {   // paid: counted for /ai-cost as the judges' spend (lib/ai-meter.mjs)
    // A judge answer seen before is replayed like the app's (owner, 27 Oct 2026: "with the judges replaying in the gate too"); a fresh run asks live.
    const body = Buffer.from(String(init?.body ?? '')), key = requestKey(`judge ${judgeFamily(env)} ${new URL(url).pathname}`, body);
    const kept = recall(key, env);
    if (kept) {
      try { countReplay('judges', usageOf(kept.body.toString('utf8'), kept.contentType || '')); } catch { /* counting never breaks the call */ }
      return new Response(kept.body, {status: kept.status, headers: {'content-type': kept.contentType || 'application/json'}});
    }
    keepMiss(key, `judge ${new URL(url).pathname}`, body, env);
    if (aiProvider(env, 'judges').provider === 'codex') {   // the owner's Codex plan through the broker (lib/broker-client.mjs); a refusal is a skip with its reason, never another provider
      const asked = await askBroker(JSON.parse(init.body), {env});
      if (!asked.ok) {
        if (asked.status === 'capped') noteBrokerCapped(asked.detail, env);
        return new Response(JSON.stringify({type: 'error', error: {type: 'api_error', message: asked.status === 'capped' ? capMessage(null, env, asked.detail) : asked.detail}}), {status: 503, headers: {'content-type': 'application/json'}});
      }
      const answer = JSON.stringify({type: 'message', role: 'assistant', model: asked.model, ...asked.message});   // TODO(AI): count the broker's calls in the judges' ai-meter and /admin/ai-cost (spec PR 7, 28 Oct 2026)
      keep(key, {status: 200, contentType: 'application/json', body: Buffer.from(answer)}, env);
      return new Response(answer, {status: 200, headers: {'content-type': 'application/json'}});
    }
    if (judgeFamily(env) === 'free') {   // the day's cap on CI's Workers AI neurons (lib/ai-cap.mjs)
      const cap = await capReached({env});
      if (cap.capped) { noteCapped(cap.neurons, env); return new Response(JSON.stringify({type: 'error', error: {type: 'api_error', message: capMessage(cap.neurons, env)}}), {status: 503, headers: {'content-type': 'application/json'}}); }
    }
    const target = judgeTarget(url, init, env);
    const response = await fetch(target.url, target.init);
    try {
      if (response.ok) {
        const text = await response.clone().text(), contentType = response.headers.get('content-type') || '';
        count('judges', usageOf(text, contentType));
        keep(key, {status: response.status, contentType, body: Buffer.from(text)}, env);
      }
    } catch { /* counting and keeping never break the call */ }
    return response;
  }
  const body = JSON.parse(init.body);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-model-'));   // no project, no CLAUDE.md, no hooks around the call
  try {
    const {args, prompt} = cliCall(body);
    const done = await exec({args, prompt, cwd: dir, timeoutMs});
    let out;
    try { out = JSON.parse(done.stdout); } catch { return reply(500, {error: {message: `Claude Code gave no JSON (exit ${done.code}): ${(done.stderr || done.stdout).trim().slice(0, 200)}`}}); }
    if (done.code !== 0 || out.is_error) return reply(500, {error: {message: `Claude Code failed: ${String(out.result || done.stderr).slice(0, 200)}`}});
    return reply(200, messagesAnswer(out, body));
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}
