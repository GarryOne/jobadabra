// Scores the one-call judge (lib/judge-call.mjs) on the findings people already settled: every closed auto-ui issue labelled resolution:fixed (real) or
// resolution:by-design / resolution:fp:* (false). Each setup (Free AI, Haiku, Free AI then Haiku when unsure) judges the same finding, screenshot and code
// excerpts at the tested build; the table says, per detector, how often it agreed with the person. Answers are kept in <out>/answers.jsonl: a re-run only asks what is new.
//   gh issue list -R GarryOne/jobadabra --label auto-ui --state closed --limit 1000 --json number,title,labels,body,createdAt > issues.json
//   UI_LOOP_FREE_AI_CF_TOKEN=… UI_LOOP_FREE_AI_CF_ACCOUNT_ID=… node judge-eval.mjs --issues issues.json --out <dir> [--lessons lessons.md] [--ask free,haiku]
//     [--haiku cli|api] [--max-calls n] [--only 1791,1790] [--free-model @cf/...] [--no-picture] [--more]
//   node judge-eval.mjs --exam --out <dir> [...]   the judge exam's curated findings with their code as of their build (fixtures/judge-exam)
// --haiku cli = this Mac's Claude plan ($0 API; the cost shown is what the API would charge). Guarded by test/judge-eval.test.mjs (the pure parts: lib/judge-cases.mjs).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {judgeRequest, loadRules, unsure} from './lib/judge-call.mjs';
import {excerptsFor} from './lib/judge-excerpts.mjs';
import {askFreeJudge, askHaikuApi, askHaikuCli, FREE_JUDGE, judgeWith} from './lib/judge-ask.mjs';
import {casesFrom, examCases, lessonsWithout, scoreTable} from './lib/judge-cases.mjs';
import {loadExam} from './lib/judge-exam.mjs';

const arg = (name, fallback = '') => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const OUT = arg('out'), ISSUES = arg('issues');
const EXAM = process.argv.includes('--exam');   // the judge exam's curated findings and code (fixtures/judge-exam) instead of the issues
if (!OUT || (!ISSUES && !EXAM)) { console.error('usage: node judge-eval.mjs --issues <issues.json> --out <dir> [--ask free,haiku] [--haiku cli|api] [--max-calls n]'); process.exit(2); }
const ASK = arg('ask', 'free').split(','), HAIKU = arg('haiku', 'cli'), MAX_CALLS = Number(arg('max-calls', 0)) || Infinity, FREE_MODEL = arg('free-model', FREE_JUDGE);
const NO_PICTURE = process.argv.includes('--no-picture');
const MORE = process.argv.includes('--more');   // the judge may ask once for the code it lacks (lib/judge-ask.mjs judgeWith `more`)   // a text-only Free AI model: the finding's words stand in for the screenshot
const ONLY = arg('only') ? arg('only').split(',').map(Number) : null;
const repo = path.resolve(new URL('.', import.meta.url).pathname, '..', '..');
const git = args => execFileSync('git', args, {cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
fs.mkdirSync(path.join(OUT, 'shots'), {recursive: true});

const rules = loadRules(), lessons = arg('lessons') && fs.existsSync(arg('lessons')) ? fs.readFileSync(arg('lessons'), 'utf8') : '';
const cases = (EXAM ? examCases(loadExam(), file => fs.readFileSync(file, 'utf8')) : casesFrom(JSON.parse(fs.readFileSync(ISSUES, 'utf8')))).filter(item => !ONLY || ONLY.includes(item.number));
const answersFile = path.join(OUT, 'answers.jsonl');
const kept = new Map((fs.existsSync(answersFile) ? fs.readFileSync(answersFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []).map(row => [`${row.number}|${row.who}`, row]));
console.log(`${cases.length} settled findings (${cases.filter(c => c.truth === 'real').length} real, ${cases.filter(c => c.truth === 'false').length} false); asking: ${ASK.join(', ')}; ${kept.size} answers kept`);

// The tested build, or the last main commit before the issue opened when that commit is not here.
const buildOf = item => { for (const ref of [item.sha]) { try { if (ref && git(['cat-file', '-t', ref]) === 'commit') return ref; } catch { /* missing */ } }
  try { return git(['rev-list', '-1', `--before=${item.createdAt}`, 'origin/main']); } catch { return ''; } };
async function shot(item) {
  if (!item.png) return '';
  const file = path.join(OUT, 'shots', `${item.number}.png`);
  if (!fs.existsSync(file)) { const response = await fetch(item.png).catch(() => null); if (!response?.ok) return ''; fs.writeFileSync(file, Buffer.from(await response.arrayBuffer())); }
  return fs.readFileSync(file).toString('base64');
}
const ask = {free: request => askFreeJudge(request, {model: FREE_MODEL}), haiku: HAIKU === 'api' ? askHaikuApi : askHaikuCli};
let calls = 0;
for (const item of cases) {
  const todo = ASK.filter(who => !kept.has(`${item.number}|${who}`));
  if (!todo.length) continue;
  const ref = item.excerpts ? '' : buildOf(item), excerpts = item.excerpts || excerptsFor(item.finding, {ref, cwd: repo}), png = NO_PICTURE ? '' : await shot(item);
  const base = {finding: item.finding, rules, lessons: lessonsWithout(lessons, item.number), logs: item.logs, png, model: ''};
  const request = judgeRequest({...base, excerpts});
  const more = need => { const all = [...excerpts, ...excerptsFor(item.finding, {ref, cwd: repo, words: need, max: 6})]; return {excerpts: all, request: judgeRequest({...base, excerpts: all, last: true})}; };
  for (const who of todo) {
    if (calls >= MAX_CALLS) { console.log(`stopped at the call cap (${MAX_CALLS})`); break; }
    calls++;
    const result = await judgeWith(who === 'free' ? 'free' : 'haiku', request, excerpts, ask, MORE ? more : null);
    const row = {number: item.number, who, model: who === 'free' ? FREE_MODEL : 'claude-haiku-5-5', ok: !!result.judged, usd: result.usd || 0, calls: result.calls, excerpts: excerpts.length, png: !!png, ref,
      ...(result.judged ? {judged: result.judged, asked: result.asked || []} : {failed: result.failed})};
    fs.appendFileSync(answersFile, `${JSON.stringify(row)}\n`);
    kept.set(`${item.number}|${who}`, row);
    console.log(`  #${item.number} ${item.finding.source.padEnd(17)} ${item.truth.padEnd(5)} ${who.padEnd(5)} ${row.ok ? `${row.judged.word} (${row.judged.sure})${row.asked.length ? ` after asking for ${row.asked.length}` : ''}` : `FAILED ${row.failed.slice(0, 60)}`} $${row.usd.toFixed(4)}`);
  }
  if (calls >= MAX_CALLS) break;
}
const table = scoreTable(cases, kept, {unsure});
fs.writeFileSync(path.join(OUT, 'judge-eval.md'), table);
console.log(`\n${table}`);
