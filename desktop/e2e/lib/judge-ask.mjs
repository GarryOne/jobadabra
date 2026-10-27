// Who answers a one-call judgement (lib/judge-call.mjs), and the order: Free AI alone, Haiku alone, or Free AI first and Haiku only when Free AI is unsure
// (owner, 27 Oct 2026: "a combination of Free AI with Haiku 5.5 if that gives us better results"). Free AI is Workers AI on the UI loop's own token
// (UI_LOOP_FREE_AI_CF_TOKEN, never production's Worker or keys); Haiku is the Messages API on UI_LOOP_ANTHROPIC_KEY, or this Mac's `claude -p` (the plan, never a key) for a local eval.
// Every answer carries its cost and a `limit` flag the AI budget breaker (ai-budget.mjs) trips on. Guarded by test/judge-ask.test.mjs.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {askFree} from './review-free.mjs';
import {usageCost} from './vision.mjs';
import {readJudge, unsure} from './judge-call.mjs';

export const FREE_JUDGE = process.env.UI_JUDGE_FREE_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct';   // sees pictures
export const HAIKU = 'claude-haiku-5-5';
export const SETUPS = ['free', 'haiku', 'free+haiku'];
// A provider's "no more for you": Anthropic's credit/usage limits, Workers AI's daily allowance or a refused token. The breaker pauses the loop's AI on these.
export const LIMIT = /usage limits?|credit balance is too low|spend(?:ing)? limit|daily free allocation|neurons|quota|rate.?limit|\b429\b|authentication|invalid.*token/i;

const anthropicUrl = () => process.env.UI_JUDGE_ANTHROPIC_URL || 'https://api.anthropic.com';   // a test points this at a fake
export async function askHaikuApi(request, {key = process.env.UI_LOOP_ANTHROPIC_KEY, fetchImpl = fetch} = {}) {
  if (!key) return {ok: false, status: 'no-key', detail: 'UI_LOOP_ANTHROPIC_KEY is not set'};
  const response = await fetchImpl(`${anthropicUrl()}/v1/messages`, {method: 'POST', signal: AbortSignal.timeout(120000),
    headers: {'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'}, body: JSON.stringify({...request, model: HAIKU})}).catch(error => error);
  if (response instanceof Error) return {ok: false, status: 0, detail: `no answer: ${response.message}`};
  if (!response.ok) return {ok: false, status: response.status, detail: (await response.text().catch(() => '')).slice(0, 300)};
  const message = await response.json();
  return {ok: true, text: (message.content || []).filter(b => b.type === 'text').map(b => b.text).join(''), usd: usageCost(HAIKU, message.usage || {}) || 0, usage: message.usage};
}

// This Mac's Claude Code on the owner's plan (no key in the environment, nothing loaded but the call), with the picture: stream-json carries image blocks.
export async function askHaikuCli(request, {exec = spawnClaude} = {}) {
  const system = request.system.map(b => b.text).join('\n\n');
  const args = ['-p', '--model', HAIKU, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', '', '--no-session-persistence',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands', '--setting-sources', '', '--system-prompt', system];
  const input = `${JSON.stringify({type: 'user', message: {role: 'user', content: request.messages[0].content}})}\n`;
  let out;
  try { out = await exec(args, input); } catch (error) { return {ok: false, status: 0, detail: String(error.message).slice(0, 300)}; }
  const result = out.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(item => item?.type === 'result').at(-1);
  if (!result || result.is_error) return {ok: false, status: 0, detail: String(result?.result || 'no result').slice(0, 300)};
  return {ok: true, text: String(result.result || ''), usd: usageCost(HAIKU, result.usage || {}) || 0, usage: result.usage};   // what the API would have charged
}
const spawnClaude = (args, input) => new Promise((resolve, reject) => {
  const {ANTHROPIC_API_KEY, ...env} = process.env;   // eslint-disable-line no-unused-vars
  const child = spawn('claude', args, {cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'ui-judge-')), env, stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '', stderr = '';
  const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`claude exited ${code}: ${(stderr || stdout).slice(0, 300)}`)); });
  child.stdin.on('error', () => { /* claude quit before reading: its exit code and stderr say why (EPIPE crashed the whole eval, 27 Oct 2026) */ });
  child.stdin.end(input);
});

export async function askFreeJudge(request, {model = FREE_JUDGE, token = process.env.UI_LOOP_FREE_AI_CF_TOKEN, account = process.env.UI_LOOP_FREE_AI_CF_ACCOUNT_ID, fetchImpl} = {}) {
  if (!token || !account) return {ok: false, status: 'no-token', detail: 'UI_LOOP_FREE_AI_CF_TOKEN or UI_LOOP_FREE_AI_CF_ACCOUNT_ID is not set'};   // the UI loop's own secrets, not review-free's
  const answer = await askFree(request, {model, token, account, ...(fetchImpl ? {fetchImpl} : {})});
  return answer.ok ? {ok: true, text: answer.message.content[0].text, usd: answer.usd || 0, usage: answer.message.usage, cut: answer.message.stop_reason === 'max_tokens'} : answer;
}

// One finding through a setup -> {judged, by, usd, calls, failed?, limit?}. `ask` is {free, haiku}: (request) -> answer (tests pass fakes).
// `more(need)` -> {request, excerpts}: when a model asks for code (lib/judge-call.mjs `need`), code fetches it and the same model decides in a last round.
export async function judgeWith(setup, request, excerpts, ask, more = null) {
  let usd = 0, calls = 0;
  const usdBy = {free: 0, haiku: 0};
  const once = async who => {
    calls++;
    const answer = await ask[who](request);
    usd += answer.usd || 0; usdBy[who] += answer.usd || 0;
    if (!answer.ok) return {failed: `${who}: ${answer.status} ${answer.detail || ''}`.slice(0, 200), limit: LIMIT.test(`${answer.status} ${answer.detail}`)};
    const judged = readJudge(answer.text, {excerpts});
    if (!judged.need?.length || !more) return {judged, by: who};
    const next = more(judged.need);   // one more round, with the code it asked for
    calls++;
    const last = await ask[who](next.request);
    usd += last.usd || 0; usdBy[who] += last.usd || 0;
    if (!last.ok) return {failed: `${who}: ${last.status} ${last.detail || ''}`.slice(0, 200), limit: LIMIT.test(`${last.status} ${last.detail}`)};
    return {judged: readJudge(last.text, {excerpts: next.excerpts}), by: who, asked: judged.need};
  };
  const first = await once(setup === 'haiku' ? 'haiku' : 'free');
  if (setup === 'haiku') {   // Haiku judges; when it is refused or capped, Free AI does, so the run still sorts its findings (the breaker trips only if both fail)
    if (first.judged || !ask.free) return {...first, usd, usdBy, calls};
    const fallback = await once('free');
    return {...(fallback.judged ? fallback : first), usd, usdBy, calls, haikuFailed: first.failed, limit: fallback.judged ? false : first.limit || fallback.limit};
  }
  if (setup !== 'free+haiku' || (first.judged && !unsure(first.judged))) return {...first, usd, usdBy, calls};
  const second = await once('haiku');   // Free AI was unsure (or failed): Haiku decides
  return {...(second.judged ? second : first), usd, usdBy, calls, firstSaid: first.judged?.word || first.failed};
}
