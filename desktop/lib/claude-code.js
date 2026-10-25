// The AI engine the user chose (Settings → Connections → AI, and the setup wizard's AI step): their Anthropic or OpenAI API key,
// or their own Claude Code or Codex on this Mac (the engines and the one client factory: lib/ai/index.js) (src/ai/engine.py runs it for the Python jobs; client() below for the app's own
// calls: the strategy draft, CV tailoring, form learning). Here: is Claude Code installed, which version, is it signed in
// (one tiny `claude -p` call, on the user's plan), and the environment a job on this Mac gets for the choice.
// Jobadabra runs the user's OWN, unmodified, signed-in `claude`, exactly as they could run it themselves. It never
// reads, stores, logs or forwards Claude credentials, never signs in for the user, never sets auth variables for it
// (it drops the API key and the Free AI relay the app gives its own calls), and is never used by GitHub runs.
import {execFile, spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ai from './ai/index.js';
import {cleanEnv, runJson} from './ai/claude-code-cli.js';
// Moved to lib/ai/claude-code-cli.js (9 Oct 2026), re-exported so callers are unchanged.
export {alias, cleanEnv, cliClient, parseJson, problem, promptAndFiles, runJson} from './ai/claude-code-cli.js';

// Found where Apply with Claude finds it (apply.js claudeBinary), imported when needed: pipeline.js imports this module,
// and apply.js imports pipeline.js.
const claudeBinary = async () => (await import('./apply.js')).claudeBinary();

export const NOTICE = 'Jobadabra will run your own Claude Code on this Mac. It uses your Claude plan\'s usage limits, not API credits. '
  + 'Scheduled runs in your GitHub repository (Always on) still use your API key. '
  + 'You stay in control: switch back to an API key any time.';
export const ENGINES = ai.NAMES;
const VERIFY_TIMEOUT_MS = 90 * 1000;

// The engine for this user: what they chose; an install that had an API key before the choice existed keeps 'api'
// (nothing is migrated); nothing chosen and no key: null (the wizard asks).
export const engine = (settings = {}, hasKey = false) => ai.chosen(settings, {ANTHROPIC_API_KEY: hasKey});
// Can AI steps run: a CLI engine chosen (Claude Code, Codex), or the chosen API engine's key saved.
export const aiReady = (settings, hasKey, hasOpenAiKey = false) => ai.ready(settings, {ANTHROPIC_API_KEY: hasKey, OPENAI_API_KEY: hasOpenAiKey});

// What a job on this Mac gets for the choice (lib/pipeline.js pipelineEnv). GitHub runs never get these: 'api' or 'openai' there.
// Another engine answers (Free AI, an API key) but the user's own plan is signed in on this Mac: its CLI still does the web searches that find
// job boards and employers (owner, 26 Oct 2026: "The Free AI should have no limitation"), free beyond the plan. Claude Code first, then Codex.
export function planSearch(settings = {}) {
  if (settings.claudeCode?.authenticated && settings.claudeCode?.path) return {JOB_PILOTTO_PLAN_SEARCH: 'claude', JOB_PILOTTO_CLAUDE_BIN: settings.claudeCode.path};
  if (settings.codex?.authenticated && settings.codex?.path) return {JOB_PILOTTO_PLAN_SEARCH: 'codex', JOB_PILOTTO_CODEX_BIN: settings.codex.path};
  return {};
}

export function pipelineVariables(settings = {}, hasKey = false, hasOpenAiKey = false) {
  const chosen = engine(settings, hasKey);
  if (chosen === 'openai') return {JOB_PILOTTO_AI_ENGINE: 'openai', ...planSearch(settings)};
  if (chosen === 'codex') return {JOB_PILOTTO_AI_ENGINE: 'codex', ...(settings.codex?.path ? {JOB_PILOTTO_CODEX_BIN: settings.codex.path} : {}),
    ...(settings.aiFallback && hasOpenAiKey ? {JOB_PILOTTO_AI_FALLBACK: 'openai'} : {})};
  if (chosen !== 'cli') return {JOB_PILOTTO_AI_ENGINE: 'api', ...planSearch(settings)};
  return {JOB_PILOTTO_AI_ENGINE: 'cli', ...(settings.claudeCode?.path ? {JOB_PILOTTO_CLAUDE_BIN: settings.claudeCode.path} : {}),
    ...(settings.aiFallback && hasKey ? {JOB_PILOTTO_AI_FALLBACK: 'api'} : {})};
}

// `claude --version` -> "2.1.3", or null.
export function version(binary, run = execFile) {
  return new Promise(resolve => {
    try {
      run(binary, ['--version'], {timeout: 15000, env: cleanEnv()}, (error, stdout) => resolve(error ? null : (/(\d+\.\d+\.\d+)/.exec(String(stdout))?.[1] || null)));
    } catch { resolve(null); }
  });
}
export async function detect({binary = claudeBinary, run = execFile} = {}) {
  const file = await binary();
  if (!file) return {installed: false, path: '', version: null};
  const found = await version(file, run);
  return {installed: !!found, path: file, version: found};
}

const freshFolder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'job-pilotto-claude-'));

// Windows: the Claude Desktop app is a chat app and does not include Claude Code (the `claude` command); what installs it is told here.
const hint = (platform = process.platform) => platform === 'win32'
  ? ' The Claude Desktop app does not include Claude Code: in a Command Prompt run  winget install Anthropic.ClaudeCode  (answer Y to the terms), then restart Jobadabra and press Verify.' : '';
// Where it looked, so a miss can be told from a stale PATH or an unusual install (a few folders; shown only in the user's own window).
async function looked() {
  try { const dirs = (await import('./apply.js')).claudeSearchDirs(); return ` Looked in: ${[...new Set(dirs)].slice(0, 8).join(', ')}.`; } catch { return ''; }
}
// Installed? Signed in? One tiny call (the haiku model, one word, no tools), on the user's own plan. The result is
// kept on this Mac (settings.claudeCode) for the status block and for jobs: the path, the version, when, ok.
export async function verify(storage, {binary = claudeBinary, run = execFile, spawnFn = spawn, now = () => new Date()} = {}) {
  const found = await detect({binary, run});
  let result;
  if (!found.installed) {
    result = {...found, authenticated: false, error: found.path ? 'Claude Code did not start (claude --version failed).'
      : `Claude Code is not installed on this Mac. Install it from claude.com/claude-code, sign in, then Verify.${hint()}${await looked()}`};
  } else {
    const cwd = freshFolder();
    try {
      const answer = await runJson(found.path, ['--model', 'haiku', '--tools', '', '--max-turns', '1', '--no-session-persistence'],
        'Reply with the single word OK.', {cwd, timeout: VERIFY_TIMEOUT_MS, spawnFn});
      // Over the plan's limit still means installed and signed in: say so, it works again later.
      result = {...found, authenticated: !answer.error || answer.error.kind === 'limit', error: answer.error?.text || ''};
    } finally { fs.rmSync(cwd, {recursive: true, force: true}); }
  }
  storage.saveSettings({claudeCode: {installed: result.installed, path: result.path, version: result.version,
    authenticated: result.authenticated, error: result.error, checkedAt: now().toISOString()}});
  return result;
}

// The app's own AI client for this user when they chose an engine other than the Anthropic API key (Claude Code, OpenAI, Codex), else null
// (the caller uses the Anthropic key, as before). lib/ai/index.js client() is the factory; this keeps the old callers' meaning.
export const client = (storage, options = {}) => ai.client(storage, {only: ['cli', 'openai', 'codex'], ...options});
