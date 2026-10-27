// Free (Workers AI, Qwen3-30B) against Claude Sonnet on written text, judged blind by the rubric (tools/free-ai-writing-judge.mjs). Prints a markdown table per feature and saves every raw answer.
//   node tools/free-ai-writing-eval.mjs --out <dir> [--features letter,review,prep,weekly,rejection] [--sonnet-from <raw.json>] [--allow-production --max-calls <n>] [--account <id>]
// Free calls draw on the production allowance: --allow-production needs the hard --max-calls cap (a call per case). Sonnet and the judge run on the subscription (`claude -p`), no key, no cost per call.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SMALL, STRONG, costUsd} from '../desktop/lib/free-ai-models.js';
import {fromWorkersAi, toWorkersAi} from '../desktop/lib/free-ai-translate.js';
import {claudeRun} from './free-ai-eval-claude.mjs';
import {guardAccount, guardCalls, rest} from './free-ai-eval.mjs';
import {CRITERIA, judge} from './free-ai-writing-judge.mjs';
import {allCases} from './free-ai-writing-cases.mjs';

const keychain = name => execFileSync('security', ['find-generic-password', '-a', 'job-pilotto', '-s', name, '-w'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
// The letter as the app shows it: the kit's code floors applied (src/ai/writing_floors.py), so the judge reads what a person would.
export const withFloors = (item, data, off = false) => {
  if (off || !['letter', 'prep', 'rejection'].includes(item.feature) || !data) return data;
  const ground = item.params.system.map(part => part.text).join('\n') + '\n' + item.params.messages.map(message => message.content).join('\n');
  return JSON.parse(execFileSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(path.dirname(fileURLToPath(import.meta.url)), 'free-ai-writing-floors.py')], {input: JSON.stringify({feature: item.feature, kit: structuredClone(data), ground}), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore']}));
};
const flagValue = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const FREE_CLAUDE = flagValue('free-claude');   // --free-claude opus: the "free" slot is a Claude alias on the plan (Sonnet against Opus), no Workers AI call, no cost
const MODEL = FREE_CLAUDE ? `claude:${FREE_CLAUDE}` : {small: SMALL, strong: STRONG}[flagValue('model')] || (String(flagValue('model')).startsWith('@cf/') ? flagValue('model') : SMALL);   // which Workers AI model plays "free": small, strong or any @cf/ id
const PRICE = (flagValue('price') || '').split(',').map(Number);   // USD per million tokens, input,output, for a model costUsd does not know
const cost = (model, usage) => (PRICE.length === 2 && PRICE.every(Number.isFinite) ? ((usage?.input_tokens || 0) * PRICE[0] + (usage?.output_tokens || 0) * PRICE[1]) / 1e6 : costUsd(model, usage));
const WRITING_STEP = 'kit';   // every feature here writes: the model's default temperature, as live (desktop/lib/free-ai-models.js temperatureFor)
const answer = async (item, run, model) => {
  try { const message = fromWorkersAi(await run(model, await toWorkersAi(item.params, async () => { throw new Error('no pdf'); }, WRITING_STEP)), model); return {data: JSON.parse(message.content[0].text), usage: message.usage}; } catch (error) { return {error: error.message}; }
};

// Per feature and writer: how many of its cases pass each criterion, and how many pass all six. `judged` = {caseId: {free: verdict|null, sonnet: verdict|null}}.
export function table(cases, judged) {
  const lines = ['| Feature | Writer | n | ' + Object.keys(CRITERIA).join(' | ') + ' | all six |', '|---|---|---|' + '---|'.repeat(Object.keys(CRITERIA).length + 1)];
  for (const feature of [...new Set(cases.map(item => item.feature))]) {
    for (const writer of ['free', 'sonnet']) {
      const rows = cases.filter(item => item.feature === feature).map(item => judged[item.id]?.[writer]).filter(Boolean);
      if (!rows.length) continue;
      const count = key => rows.filter(row => row[key] === 'yes').length;
      lines.push(`| ${feature} | ${writer} | ${rows.length} | ${Object.keys(CRITERIA).map(key => `${count(key)}/${rows.length}`).join(' | ')} | ${rows.filter(row => Object.keys(CRITERIA).every(key => row[key] === 'yes')).length}/${rows.length} |`);
    }
  }
  return lines.join('\n');
}

async function main(argv) {
  const option = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const out = option('out') || (() => { throw new Error('--out <dir> is required'); })();
  fs.mkdirSync(out, {recursive: true});
  const wanted = (option('features') || 'letter,review,prep,weekly,rejection').split(',');
  const cases = allCases().filter(item => wanted.includes(item.feature));
  const raw = {};
  const again = option('again') ? {raw: JSON.parse(fs.readFileSync(path.join(option('again'), 'raw.json'), 'utf8')), judged: JSON.parse(fs.readFileSync(path.join(option('again'), 'judged.json'), 'utf8'))} : null;   // judge only what has no verdict yet; no Free call
  const old = option('sonnet-from') ? JSON.parse(fs.readFileSync(option('sonnet-from'), 'utf8')) : {};
  const subscription = claudeRun();
  const {account, maxCalls} = again || FREE_CLAUDE ? {} : guardAccount({account: option('account'), 'allow-production': argv.includes('--allow-production'), 'max-calls': option('max-calls')});
  if (!again && !FREE_CLAUDE) guardCalls(cases.length, 1, maxCalls);
  const free = again ? null : FREE_CLAUDE ? subscription : rest({account, token: process.env.CF_API_TOKEN || keychain('job-pilotto.cloudflare.workers_ai_token')});
  const sonnetJudged = option('sonnet-judged-from') ? JSON.parse(fs.readFileSync(option('sonnet-judged-from'), 'utf8')) : {};   // Sonnet's verdicts from an earlier run: not judged twice
  let usd = 0;
  for (const item of cases) {
    if (again) { raw[item.id] = again.raw[item.id]; continue; }
    raw[item.id] = {sonnet: old[item.id]?.sonnet || await answer(item, subscription, `claude:${option('claude') || 'sonnet'}`), free: await answer(item, free, MODEL)};
    if (!FREE_CLAUDE) usd += cost(MODEL, raw[item.id].free.usage);
    console.error(`${item.id}: free ${raw[item.id].free.error ? 'ERROR ' + raw[item.id].free.error : 'ok'}, sonnet ${raw[item.id].sonnet.error ? 'ERROR' : 'ok'}`);
  }
  fs.writeFileSync(path.join(out, 'raw.json'), JSON.stringify(raw, null, 1));
  const judged = {};
  for (const item of cases) {
    judged[item.id] = {...again?.judged[item.id]};
    for (const writer of ['free', 'sonnet']) if (writer === 'sonnet' && sonnetJudged[item.id]?.sonnet) judged[item.id].sonnet = sonnetJudged[item.id].sonnet; else if (!judged[item.id][writer]) judged[item.id][writer] = raw[item.id][writer].data ? await judge(item, withFloors(item, raw[item.id][writer].data, argv.includes('--no-floors')), subscription, option('judge') || 'claude:sonnet') : null;
    console.error(`${item.id}: judged`);
  }
  fs.writeFileSync(path.join(out, 'judged.json'), JSON.stringify(judged, null, 1));
  const text = `${table(cases, judged)}\n\n${cases.length} Free calls, $${usd.toFixed(4)} on the production account (cap ${maxCalls ?? 'n/a'}), ${cases.length ? '$' + (usd / cases.length).toFixed(4) : ''} per call, model ${MODEL}. Judge: ${option('judge') || 'claude:sonnet'} via claude -p, blind to the writer.\n`;
  fs.writeFileSync(path.join(out, 'table.md'), text);
  process.stdout.write(text);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
