// The Claude Code engine ('cli'): the app's own AI calls on the user's own signed-in `claude -p` (moved out of lib/claude-code.js,
// which re-exports cliClient, runJson, problem, cleanEnv, alias, promptAndFiles and parseJson so callers are unchanged). Each call: a
// fresh folder, only the Read tool and only inside it, the user's skills/slash commands/settings not loaded, the schema enforced by
// `--json-schema` when this Claude Code offers it. A page ask (lane 'page') reads its prompt as one stream-json message on a process started
// before it came (cli-spares.js). Billing 'subscription'. Guarded by test/claude-code.test.js, test/ai-contract.test.js and test/cli-spares.test.js.
import {execFile, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {usage as usageOf} from './contract.js';
import {CliAdapter, TIMEOUT_MS, cliError, conversation, runProcess, slots} from './cli-base.js';
import {sparePool} from './cli-spares.js';
export {parseJson} from './schema.js';

const ALIASES = [['claude-haiku', 'haiku'], ['claude-sonnet', 'sonnet'], ['claude-opus', 'opus']];
export const alias = model => ALIASES.find(([prefix]) => String(model).startsWith(prefix))?.[1] || model;

// Claude Code's own environment: the user's, minus what the app added for its API calls. Nothing is added.
export function cleanEnv(parent = process.env) {
  const env = {...parent};
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_BASE_URL;
  return env;
}

const SIGNED_OUT = /not logged in|please run \/login|run \/login|invalid api key|authentication_error|oauth token|not authenticated|login required/i;
const LIMIT = /usage limit|hit your (?:usage )?limit|limit reached|limit will reset|rate.?limit|out of (?:extra )?usage|too many requests|\b429\b/i;
export function problem(text) {
  if (SIGNED_OUT.test(text)) return {kind: 'signed-out', text: 'Claude Code is not signed in. Open Terminal, run claude and sign in with your Claude account, then Verify again.'};
  if (LIMIT.test(text)) return {kind: 'limit', text: 'Your Claude usage window is exhausted. Tasks are retried later, when your plan\'s limit resets.'};
  return {kind: 'failed', text: `Claude Code failed: ${String(text || 'no answer').trim().slice(0, 200)}`};
}

// A finished `claude -p --output-format json`: {data} or {error: {kind, text}}.
function resultOf({stdout, stderr, code}) {
  let data = null;
  try { data = JSON.parse(stdout); if (Array.isArray(data)) data = data.findLast(item => item.type === 'result'); }
  catch {   // --output-format stream-json: one event per line, the last 'result' is the answer
    data = String(stdout).split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).findLast(item => item?.type === 'result') || null;
  }
  if (!data) return {error: problem(`${stdout}\n${stderr}`.trim() || `exit code ${code}`)};
  if (data.is_error || code !== 0 || String(data.subtype || 'success').startsWith('error')) return {error: problem(`${data.result || ''}\n${stderr}\n${data.subtype || ''}`)};
  return {data};
}

// One `claude -p … --output-format json` run: {data} or {error: {kind, text}}. The prompt goes on stdin. (Verify uses it.)
export async function runJson(binary, args, prompt, {cwd, timeout = TIMEOUT_MS, spawnFn = spawn} = {}) {
  const finished = await runProcess(binary, ['-p', '--output-format', 'json', ...args], prompt, {cwd, env: cleanEnv(), timeout, spawnFn, tool: 'Claude Code'});
  return finished.error ? finished : resultOf(finished);
}

// The flags this Claude Code offers (`claude --help`), asked once per binary.
const helpCache = new Map();
function offered(binary, run = execFile) {
  if (!helpCache.has(binary)) {
    helpCache.set(binary, new Promise(resolve => {
      try { run(binary, ['--help'], {timeout: 30000, env: cleanEnv()}, (error, stdout, stderr) => resolve(new Set(`${stdout || ''}${stderr || ''}`.match(/--[a-z][a-z-]+/g) || []))); }
      catch { resolve(new Set()); }
    }));
  }
  return helpCache.get(binary);
}

const readFirst = (prompt, files) => (files.length ? `First read each attached file with the Read tool, in this order: ${files.map(f => `./${f}`).join(', ')}. Then answer.\n\n${prompt}` : prompt);

// The conversation as one prompt; PDFs and images written into folder (the only place it may read). Kept for callers of lib/claude-code.js.
export function promptAndFiles(messages, folder) {
  const files = [], parts = [];
  for (const message of messages) {
    const blocks = typeof message.content === 'string' ? [{type: 'text', text: message.content}] : message.content || [];
    const texts = [];
    for (const block of blocks) {
      if (block.type === 'text') texts.push(block.text);
      else if ((block.type === 'document' || block.type === 'image') && block.source?.type === 'base64') {
        const ext = {'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'}[block.source.media_type] || 'bin';
        const name = `${block.type}-${files.length + 1}.${ext}`;
        fs.writeFileSync(path.join(folder, name), Buffer.from(block.source.data, 'base64'));
        files.push(name);
        texts.push(`[attached file: ./${name}]`);
      }
    }
    parts.push(messages.length > 1 ? `${String(message.role || 'user').toUpperCase()}:\n${texts.join('\n\n')}` : texts.join('\n\n'));
  }
  return {files, prompt: readFirst(parts.join('\n\n'), files)};
}

export class ClaudeCode extends CliAdapter {
  static engine = 'cli';
  static family = 'claude';
  static label = 'Claude Code (your plan)';
  static fallbackLabel = 'your Anthropic API key';
  static tool = 'Claude Code';
  static folder = 'claude';
  static missingText = 'Claude Code is not installed on this Mac: install it, or switch to an API key in Settings → Connections → AI.';
  static queue = slots(2);
  static spares = sparePool();   // pre-started processes for the page's questions (cli-spares.js)

  constructor({run = execFile, ...options} = {}) { super(options); this.run = run; }

  env() { return cleanEnv(); }

  async build(request, folder, files) {
    const flags = await offered(this.binary, this.run);
    // A page ask (lane 'page', no file) reads its prompt as a stream-json message: a process started before the prompt waits for it (cli-spares.js);
    // with plain text on stdin `claude -p` gives up after 3 s without input.
    const streamed = this.lane === 'page' && !files.length && flags.has('--input-format');
    const args = ['-p', ...(streamed ? ['--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'] : ['--output-format', 'json']), '--model', alias(request.model)];
    if (request.system) args.push('--system-prompt', request.system);
    args.push('--tools', files.length ? 'Read' : '');
    if (files.length) args.push('--allowedTools', 'Read(./**)');
    if (flags.has('--permission-mode')) args.push('--permission-mode', 'dontAsk');
    const native = !!request.schema && flags.has('--json-schema');
    if (native) args.push('--json-schema', JSON.stringify(request.schema));
    if (request.effort && flags.has('--effort')) args.push('--effort', request.effort);
    for (const flag of ['--no-session-persistence', '--strict-mcp-config', '--safe-mode']) if (flags.has(flag)) args.push(flag);
    // Leaner by default (measured 8 Oct 2026, a one-word call on Haiku): the user's skills, slash commands and settings are not loaded into a call
    // that needs none of them: 7,473 -> 651 tokens of context and about 0.4 s less per call, on every page-kind, form and mail decision.
    if (flags.has('--disable-slash-commands')) args.push('--disable-slash-commands');
    if (flags.has('--setting-sources')) args.push('--setting-sources', '');
    return {args, prompt: readFirst(conversation(request, files), files), native};
  }

  // A page ask: the process started for its kind of question (same args) if one waits, and the next one started now for the next page.
  runCall(args, prompt, folder) {
    if (!args.includes('--input-format')) return super.runCall(args, prompt, folder);
    const key = `${this.binary}\0${JSON.stringify(args)}`, env = this.env();
    const started = this.constructor.spares.take(key);
    const message = `${JSON.stringify({type: 'user', message: {role: 'user', content: prompt}})}\n`;
    const answered = runProcess(this.binary, args, message, {cwd: folder, env, timeout: this.timeout, spawnFn: this.spawnFn, tool: this.constructor.tool, started});
    // The next one starts once this question is answered: started beside it, its ~2 s of start-up slowed this answer by ~0.5 s (replay, 11 Oct 2026).
    return answered.finally(() => this.constructor.spares.keep(key, () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jobadabra-claude-'));
      const child = this.spawnFn(this.binary, args, {cwd, env, stdio: ['pipe', 'pipe', 'pipe']});
      child.on?.('close', () => fs.rmSync(cwd, {recursive: true, force: true}));
      return child;
    }));
  }

  parse(finished) {
    const {data, error} = resultOf(finished);
    if (error) throw cliError(error);
    return {data, stop: data.subtype === 'error_max_turns' ? 'max_turns' : 'end_turn'};
  }

  answer(data, schema) { return schema && data.structured_output != null ? JSON.stringify(data.structured_output) : String(data.result || ''); }

  usage(data) {
    const used = data.usage || {};
    return usageOf({input: used.input_tokens || 0, output: used.output_tokens || 0, cacheRead: used.cache_read_input_tokens || 0,
      cacheWrite: used.cache_creation_input_tokens || 0, provider: 'anthropic'});
  }
}

// {messages: {create(params)}} on the user's Claude Code, answering like the SDK (lib/claude-code.js has always exported this).
export const cliClient = (binary, {spawnFn = spawn, run = execFile, timeout = TIMEOUT_MS, ...options} = {}) =>
  new ClaudeCode({binary, spawnFn, run, timeout, ...options});
