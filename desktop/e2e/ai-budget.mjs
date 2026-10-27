// The loop's AI budget, as a circuit breaker: when a job hits the provider's limit ("You have reached your specified API usage limits"), it opens one issue
// labelled ai-budget that tells the owner; every other AI job (fixer, verdicts, code review) skips while that issue is open and younger than 6 hours, then
// tries once; the first job whose call succeeds closes it. On 3-4 Oct 2026 the loop hit the limit twice and kept starting jobs that could not think.
//   node ai-budget.mjs --check                 -> GITHUB_OUTPUT skip=true|false
//   node ai-budget.mjs --after <execution.json> --job <name>   -> trips or clears the breaker from a Claude run's result, writes its cost to the summary
//   node ai-budget.mjs --judge <judge-run.json> --job <name>   -> the same from a plain-call judge run (judge.mjs: Free AI's or Anthropic's limit, 27 Oct 2026)
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const LABEL = 'ai-budget';
export const PAUSE_HOURS = 6;
export const LIMIT = /usage limits?|credit balance is too low|spend(?:ing)? limit/i;
const realGh = args => execFileSync('gh', args, {encoding: 'utf8'});

// A Claude run's outcome from claude-code-action's execution file: {usd, turns, error, limit}.
export function outcome(text) {
  let list = [];
  try { list = JSON.parse(text); } catch { return {usd: 0, turns: 0, error: 'no execution record', limit: false}; }
  const result = (Array.isArray(list) ? list : []).filter(item => item && item.type === 'result').at(-1) || {};
  const error = result.is_error ? String(result.result || 'error') : '';
  return {usd: Number(result.total_cost_usd) || 0, turns: Number(result.num_turns) || 0, error, limit: !!error && LIMIT.test(error)};
}

// A judge.mjs run's record -> the same outcome shape: a provider limit trips the breaker, a run with any verdict clears it.
export function judgeOutcome(text) {
  let run = null;
  try { run = JSON.parse(text); } catch { return {usd: 0, turns: 0, error: 'no judge record', limit: false, answered: false}; }
  const answered = Object.values(run.by || {}).some(n => n > 0);
  return {usd: Number(run.usd) || 0, turns: Number(run.calls) || 0, error: run.limit || '', limit: !!run.limit, answered};
}

export function shouldSkip(issues, now = Date.now()) {
  const open = (issues || []).find(issue => issue.state === 'OPEN');
  return !!open && now - Date.parse(open.updatedAt || open.createdAt) < PAUSE_HOURS * 3600000;
}

// What /self-healing says about the pause (24 Oct 2026: 22-24 Oct showed no judged real bug, and nothing on the page said the verdict pass was paused since 21 Oct):
// -> {paused, issue, since, until, waiting}; `until` is the date the provider's own message names, when it names one.
export function budgetState(issues, waiting = 0) {
  const open = (issues || []).find(issue => issue.state === 'OPEN');
  if (!open) return {paused: false, issue: null, since: '', until: '', waiting: 0};
  const until = /regain access on (\d{4}-\d{2}-\d{2})/.exec(`${open.body || ''} ${(open.comments || []).map(comment => comment.body).join(' ')}`)?.[1] || '';
  return {paused: true, issue: open.number, since: String(open.createdAt || '').slice(0, 10), until, waiting: Number(waiting) || 0};
}

const list = gh => JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number,state,createdAt,updatedAt']));

export function trip({gh = realGh, job, error}) {
  gh(['label', 'create', LABEL, '--force', '--color', 'B60205', '--description', 'The loop hit the AI provider limit: its AI jobs pause']);
  const [open] = list(gh);
  const line = `${new Date().toISOString().slice(0, 16)}Z · ${job}: ${String(error).slice(0, 200)}`;
  if (open) gh(['issue', 'comment', String(open.number), '--body', `Still at the limit: ${line}`]);
  else gh(['issue', 'create', '--label', LABEL, '--title', '💸 The AI limit is reached: the loop\'s AI jobs are paused', '--body',
    `The AI provider refused a call because the account's usage limit is reached.\n\n> ${line}\n\nThe fixer, the verdict pass and the code review skip while this is open (they try again every ${PAUSE_HOURS} hours). Raise the limit where the line above points: the Anthropic console (Settings → Limits) for Claude, the Cloudflare dashboard (Workers AI) for Free AI; the first job that gets through closes this issue.`]);
}

export function clear({gh = realGh, job}) {
  for (const issue of list(gh)) gh(['issue', 'close', String(issue.number), '--comment', `The AI answers again (${job}): the loop's AI jobs run as usual.`]);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2), at = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : ''; };
  const out = (key, value) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`); };
  const summary = line => console.log(line);
  if (args.includes('--check')) {
    let skip = false;
    try { skip = shouldSkip(list(realGh)); } catch { /* cannot tell: run */ }
    out('skip', String(skip));
    if (skip) summary(`Skipped: the AI limit was reached in the last ${PAUSE_HOURS} hours (issue labelled ${LABEL}); this job tries again later.`);
  } else if (args.includes('--judge')) {
    const result = judgeOutcome((() => { try { return fs.readFileSync(at('--judge'), 'utf8'); } catch { return ''; } })()), job = at('--job') || 'the judge';
    summary(`AI cost: $${result.usd.toFixed(4)} in ${result.turns} call(s) (${job}).`);
    try { if (result.limit) trip({job, error: result.error}); else if (result.answered) clear({job}); } catch (error) { console.log(`breaker not updated: ${error.message}`); }
  } else if (args.includes('--after')) {
    let text = '';
    try { text = fs.readFileSync(at('--after'), 'utf8'); } catch { /* none */ }
    const result = outcome(text), job = at('--job') || 'an AI job';
    // Outside the repository: written into the checkout, the fixer's guard took it for an edit and refused a good fix (#118, 4 Oct 2026).
    const costFile = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'ai-cost.json');
    fs.writeFileSync(costFile, JSON.stringify({job, usd: result.usd, turns: result.turns, at: new Date().toISOString(), limit: result.limit}));
    summary(`AI cost: $${result.usd.toFixed(3)} in ${result.turns} turn(s) (${job}).`);
    try { if (result.limit) trip({job, error: result.error}); else if (!result.error && text) clear({job}); } catch (error) { console.log(`breaker not updated: ${error.message}`); }
  }
}
