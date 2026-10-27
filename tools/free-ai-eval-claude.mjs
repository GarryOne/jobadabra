// Claude through the user's own subscription (`claude -p`) as a backend of the Free AI quality tool (tools/free-ai-eval.mjs), for the Haiku/Sonnet/Opus comparison on the same cases.
// By default never an API key (removed from the environment); `apiKey` (the PR checks, owner 27 Oct 2026: "Haiku on an API key") makes it the ONLY credential: the plan's sign-in is removed and each call's cost goes to `onCost`; nothing but the answer is loaded: no tools, MCP servers, skills or saved session, run from an empty folder (a bare call otherwise carries ~160k tokens of context).
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const isClaude = name => String(name).startsWith('claude:');

// The case's request in Workers AI shape (system message, user message, response_format) -> the claude arguments; the user text goes in on stdin.
export function claudeArgs(model, input) {
  const system = input.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const schema = input.response_format?.json_schema?.schema;
  return ['-p', '--model', model, '--tools', '', '--max-turns', '3', '--no-session-persistence', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--disable-slash-commands', '--setting-sources', '', '--output-format', 'json', ...(schema ? ['--json-schema', JSON.stringify(schema)] : []), '--system-prompt', system];
}

const spawnExec = (file, args, {cwd, env, stdin}) => new Promise((resolve, reject) => {
  const child = spawn(file, args, {cwd, env, stdio: ['pipe', 'pipe', 'pipe']});
  let out = '', err = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.stderr.on('data', chunk => { err += chunk; });
  child.on('error', reject);
  child.on('close', code => (code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 300)}`))));
  child.stdin.end(stdin);
});

// run(name, input) -> an answer in the shape evaluate() reads. `name` is 'claude:<alias>' (haiku, sonnet, opus).
export const claudeRun = ({exec = spawnExec, env = process.env, cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'free-ai-eval-claude-')), apiKey = '', onCost = () => {}} = {}) => async (name, input) => {
  const {ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, PR_PROOF_ANTHROPIC_KEY, ...rest} = env;   // eslint-disable-line no-unused-vars
  const clean = apiKey ? {...rest, ANTHROPIC_API_KEY: apiKey, MAX_THINKING_TOKENS: '0'} : {...rest, ...(CLAUDE_CODE_OAUTH_TOKEN ? {CLAUDE_CODE_OAUTH_TOKEN} : {})};
  const stdin = input.messages.filter(m => m.role !== 'system').map(m => m.content).join('\n\n');
  const reply = JSON.parse(await exec('claude', claudeArgs(name.slice('claude:'.length), input), {cwd, env: clean, stdin}));
  onCost(Number(reply.total_cost_usd) || 0);
  if (reply.is_error) throw new Error(`claude: ${String(reply.result).slice(0, 200)}`);
  const text = reply.structured_output !== undefined ? JSON.stringify(reply.structured_output) : String(reply.result ?? '');
  const u = reply.usage || {};
  return {choices: [{message: {content: text}, finish_reason: 'stop'}], model: Object.keys(reply.modelUsage || {})[0],
    usage: {prompt_tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), completion_tokens: u.output_tokens || 0}};
};
