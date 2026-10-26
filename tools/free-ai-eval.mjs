#!/usr/bin/env node
// The Free AI quality table (private spec jobadabra-lab:docs/specs/2026-10-16-free-workers-ai.md "Quality"): runs Anthropic-shaped cases through the site's own
// translation (shared/free-ai-translate.js) on Workers AI models and prints a markdown table: valid JSON, schema, rank against Claude's scores, cost.
//   node tools/free-ai-eval.mjs --cases <cases.json> [--models small,strong] [--backend rest|mock] [--out table.md]
// Cases (made by tools/free-ai-cases.py, fictional data only): [{id, action, params: <Anthropic request>, baseline?: <Claude's score>}].
// rest: needs a token with Account > Workers AI > Read + Edit: CF_API_TOKEN or the Keychain item job-pilotto.cloudflare.workers_ai_token; --account <id> names the Cloudflare account the token belongs to, never the production one (its free daily allowance is the live Free AI's). A few hundred calls cost cents.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {costUsd, SMALL, STRONG} from '../desktop/lib/free-ai-models.js';
import {fromWorkersAi, toWorkersAi} from '../desktop/lib/free-ai-translate.js';
import {claudeRun, isClaude} from './free-ai-eval-claude.mjs';
import {answerProblems, factProblems, kitProblems, schemaProblems, summarize, table} from './free-ai-eval-metrics.mjs';

const MODELS = {small: SMALL, strong: STRONG};
const keychain = name => { try { return execFileSync('security', ['find-generic-password', '-a', 'job-pilotto', '-s', name, '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return ''; } };

// The REST backend: Cloudflare's OpenAI-compatible chat route for one model. -> the answer in Workers AI's chat shape.
export const rest = ({account, token, fetcher = fetch}) => async (model, input) => {
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`, {method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${token}`}, body: JSON.stringify({model, ...input})});
  if (!response.ok) throw new Error(`Workers AI ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
};

// Runs every case on one model. `run(model, input)` is the backend. Never throws on one bad answer: it is a row that failed.
export async function evaluate(cases, model, run, now = () => Date.now()) {
  const results = [];
  for (const item of cases) {
    const started = now();
    const row = {id: item.id, baseline: item.baseline, ...(item.expect ? {right: false} : {}), valid: false, schemaOk: false, score: NaN, usage: {}, ms: NaN};
    try {
      const message = fromWorkersAi(await run(model, await toWorkersAi(item.params, async () => { throw new Error('PDF cases need the site route'); }, item.action)), model);
      row.usage = message.usage; row.ms = now() - started;
      const data = JSON.parse(message.content[0].text);
      row.valid = true; row.reply = data;
      const schema = item.params.output_config?.format?.schema;
      row.schemaOk = !schema || schemaProblems(data, schema).length === 0;
      row.score = Number(data.score);
      if (item.expect) { row.problems = 'eligible' in item.expect ? kitProblems(data, item.expect, item.ground) : item.expect.paths || item.expect.has ? factProblems(data, item.expect) : answerProblems(data, item.expect); row.right = row.schemaOk && !row.problems.length; }
    } catch (error) { row.error = error.message; }
    results.push(row);
  }
  return results;
}

// The REST calls draw on the same free daily allowance as the production Free AI: a day of tuning once left every user at "busy today" (16 Oct 2026).
// So a run names a separate account (--account <id>), or the production one only with --allow-production and a hard --max-calls cap (the account is on Workers Paid; a capped run costs cents).
export const PRODUCTION_ACCOUNTS = ['f192582d62c440f34f9ca7997558cee3'];
export function guardAccount(flags) {
  if (flags['allow-production']) {
    const maxCalls = Number(flags['max-calls']);
    if (!(maxCalls > 0)) throw new Error('--allow-production needs a hard call cap: --max-calls <n>.');
    return {account: flags.account || PRODUCTION_ACCOUNTS[0], maxCalls, production: PRODUCTION_ACCOUNTS.includes(flags.account || PRODUCTION_ACCOUNTS[0])};
  }
  if (!flags.account) throw new Error('Name the Cloudflare account to measure on with --account <id>: never the production one, whose daily allowance the live Free AI shares.');
  if (PRODUCTION_ACCOUNTS.includes(flags.account)) throw new Error('That is the production Cloudflare account, which the live Free AI shares. Use a separate account (--account <id>), or --allow-production --max-calls <n>.');
  return {account: flags.account, maxCalls: Number(flags['max-calls']) || undefined, production: false};
}
export function guardCalls(cases, models, maxCalls) {
  if (maxCalls && cases * models > maxCalls) throw new Error(`This run would make ${cases * models} calls (${cases} cases x ${models} models), over the cap of ${maxCalls}.`);
}
export const closing = (calls, usd, production) => `${calls} calls, $${usd.toFixed(4)}${production ? ' on the production account' : ''}.`;

// One line per case that was not right (an error, or the problems found in its reply), so a low "Right answers" can be read, not guessed at.
export const failureLines = (model, results) => results.flatMap(r => (r.error ? [`${model} ${r.id}: ${r.error}`] : r.right === false ? [`${model} ${r.id}: ${(r.problems || []).join('; ')}`] : []));

// A deterministic stand-in for Workers AI (the tests, and a dry run with no key): the score follows the case's baseline, a little off.
export const mock = cases => async (model, input) => {
  const item = cases.find(each => input.messages.at(-1).content.includes(each.id)) || cases[0];
  const score = Math.max(0, Math.min(100, Math.round((item.baseline ?? 50) + (model === STRONG ? 1 : 4))));
  return {choices: [{message: {content: JSON.stringify({score, tier: 'B', components: {role_fit: score, location: score, compensation: null, growth: null, risk: 30},
    basis: {salary_stated: false, level_stated: true}, reason: 'mock', strengths: [], gaps: [], confidence: 'medium'})}, finish_reason: 'stop'}],
  usage: {prompt_tokens: 1500, completion_tokens: 200}};
};

// Scores the replies a run kept (--raw) again against the cases' current expectations: no model call, no cost. Several --raw lines of one model (a re-run) -> the last wins.
export function rescore(cases, rawText, out) {
  const byModel = new Map();
  for (const line of rawText.split('\n').filter(Boolean)) { const {model, results} = JSON.parse(line); byModel.set(model, results); }
  const rows = [], misses = [];
  for (const [model, results] of byModel) {
    const scored = results.map(r => {
      const item = cases.find(c => c.id === r.id), problems = r.reply ? answerProblems(r.reply, item.expect) : ['no reply'];
      if (problems.length) misses.push(`${model} ${r.id}: ${problems.join('; ')}`);
      return {id: r.id, valid: !!r.reply, schemaOk: !!r.reply, right: !problems.length, usage: {}, ms: NaN};
    });
    rows.push(summarize(model, scored));
  }
  const text = `${table(rows)}\n\n${cases.length} cases per model.\n`;
  if (out) fs.writeFileSync(out, text);
  process.stdout.write(`${misses.join('\n')}\n\n${text}`);
}

async function main(argv) {
  const option = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const cases = JSON.parse(fs.readFileSync(option('cases') || (() => { throw new Error('--cases <file> is required'); })(), 'utf8'));
  const names = (option('models') || 'small').split(',').map(name => MODELS[name] || name);
  if (option('rescore')) return rescore(cases, fs.readFileSync(option('rescore'), 'utf8'), option('out'));
  let run, account, maxCalls, production = false;
  if ((option('backend') || 'rest') === 'mock') run = mock(cases);
  else if (names.every(isClaude)) run = claudeRun();   // the user's own subscription: nothing reaches Cloudflare, no account guard
  else {
    const cloud = names.filter(name => !isClaude(name));
    const token = process.env.CF_API_TOKEN || keychain('job-pilotto.cloudflare.workers_ai_token');
    ({account, maxCalls, production} = guardAccount({account: option('account'), 'allow-production': argv.includes('--allow-production'), 'max-calls': option('max-calls')}));
    if (!token) throw new Error('No Workers AI token: set CF_API_TOKEN or the Keychain item job-pilotto.cloudflare.workers_ai_token (one made in the --account account), or use --backend mock.');
    guardCalls(cases.length, cloud.length, maxCalls);
    const cloudRun = rest({account, token}), subscription = claudeRun();
    run = (model, input) => (isClaude(model) ? subscription(model, input) : cloudRun(model, input));
  }
  const rows = [], usd = {};
  for (const model of names) {
    const results = await evaluate(cases, model, run);
    const row = summarize(model, results);
    if (option('raw')) fs.appendFileSync(option('raw'), `${JSON.stringify({model, results: results.map(({id, reply, problems, right}) => ({id, reply, problems, right}))})}\n`);
    rows.push(row); usd[model] = isClaude(model) ? 0 : costUsd(model, {input_tokens: row.tokensIn, output_tokens: row.tokensOut});   // Claude: your subscription, no per-call cost
    for (const line of failureLines(model, results)) console.error(line);
  }
  const text = `${table(rows, usd)}\n\n${cases.length} cases per model. ${cases.some(c => c.expect) ? 'A case is right when every field matches what the case expects.' : `Baseline: ${cases.some(c => c.baseline != null) ? 'the cases\' designed scores (not Claude\'s)' : 'none (rank columns are n/a)'}.`}\n`;
  const done = `${closing(cases.length * names.filter(name => !isClaude(name)).length, Object.values(usd).reduce((a, b) => a + b, 0), production)}\n`;
  if (option('out')) fs.writeFileSync(option('out'), text + done);
  process.stdout.write(text + done);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
