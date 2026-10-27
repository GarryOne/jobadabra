// The UI loop's verdicts as plain AI calls (lib/judge-call.mjs), in place of the claude-code-action agent sessions (owner, 27 Oct 2026: "Free AI, own key";
// "a combination of Free AI with Haiku 5.5 if that gives us better results"):
//   node judge.mjs --pending .heal/pending.json --out .heal/verdicts.json [--lessons .heal/lessons.md]       ui-findings.yml: judge before filing
//   node judge.mjs --issue <n> [--screenshot .heal/screenshot.png] --out .heal/verdict.md [--lessons ...]      ui-verdict.yml: one filed finding
//   node judge.mjs --exam --out .heal/verdicts.json                                                            judge-exam.yml: the planted findings, their code as of their build
// UI_JUDGE_SETUP = haiku (the owner's pick, 27 Oct 2026: Haiku, Free AI when Haiku is refused) | free | free+haiku (lib/judge-ask.mjs); without UI_LOOP_ANTHROPIC_KEY every
// setup is Free AI alone. A finding is dropped only when the judge is sure it is false (lib/judge-call.mjs safeToDrop). The run's cost, calls and any
// provider limit go to $RUNNER_TEMP/judge-run.json, read by ai-budget.mjs --judge (the breaker) and ai-cost-report.mjs --file. Guarded by test/judge-run.test.mjs.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {judgeRequest, loadRules, safeToDrop, verdictText} from './lib/judge-call.mjs';
import {excerptsFor} from './lib/judge-excerpts.mjs';
import {askFreeJudge, askHaikuApi, judgeWith, SETUPS} from './lib/judge-ask.mjs';
import {examCases, findingOf} from './lib/judge-cases.mjs';
import {loadExam} from './lib/judge-exam.mjs';

export const setupOf = (env = process.env) => {
  const asked = SETUPS.includes(env.UI_JUDGE_SETUP) ? env.UI_JUDGE_SETUP : 'free';
  return asked !== 'free' && !env.UI_LOOP_ANTHROPIC_KEY ? 'free' : asked;
};
const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const picture = file => (file && fs.existsSync(file) ? fs.readFileSync(file).toString('base64') : '');

// items: [{key, finding, png, logs}] -> {verdicts: {key: text}, run: {usd, calls, by, failed, limit, setup}}. Stops asking at the first provider limit.
// excerpts(finding, words?) -> the code shown: the finding's own words, or the words the judge asked for in its second round.
export async function judgeAll(items, {setup, rules, lessons = '', ask, cwd = process.cwd(), excerpts = (finding, words = null) => excerptsFor(finding, {cwd, ...(words ? {words, max: 6} : {})})}) {
  const verdicts = {}, run = {setup, usd: 0, usdBy: {free: 0, haiku: 0}, calls: 0, by: {}, failed: [], limit: ''};
  for (const item of items) {
    if (run.limit) { run.failed.push(`${item.key}: not asked (limit reached)`); continue; }
    const shown = excerpts(item.finding), base = {finding: item.finding, rules, lessons, logs: item.logs, png: item.png};
    const more = need => { const all = [...shown, ...excerpts(item.finding, need)]; return {excerpts: all, request: judgeRequest({...base, excerpts: all, last: true})}; };
    const result = await judgeWith(setup, judgeRequest({...base, excerpts: shown}), shown, ask, more);
    run.usd += result.usd; run.calls += result.calls;
    for (const who of ['free', 'haiku']) run.usdBy[who] += result.usdBy?.[who] || 0;
    if (!result.judged) { run.failed.push(`${item.key}: ${result.failed}`); if (result.limit) run.limit = result.failed; continue; }
    run.by[result.by] = (run.by[result.by] || 0) + 1;
    if (result.haikuFailed) run.failed.push(`${item.key}: Haiku refused (${result.haikuFailed.slice(0, 80)}), Free AI judged it`);
    verdicts[item.key] = verdictText(safeToDrop(result.judged), result.by === 'haiku' ? 'Haiku 5.5' : 'Free AI');
  }
  return {verdicts, run};
}

async function main(args) {
  const at = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
  const setup = setupOf(), rules = loadRules(), lessons = read(at('--lessons'));
  const ask = {free: request => askFreeJudge(request), haiku: request => askHaikuApi(request)};
  const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
  let items, excerpts;
  if (args.includes('--exam')) {
    // The exam judges with the code it carries (fixtures/judge-exam), never today's repository; a second-round ask gets nothing more.
    const cases = examCases(loadExam(), file => fs.readFileSync(file, 'utf8'));
    const shown = new Map(cases.map(item => [item.finding.id, item.excerpts]));
    items = cases.map(item => ({key: item.number, finding: item.finding, logs: '', png: ''}));
    excerpts = (finding, words = null) => (words ? [] : shown.get(finding.id) || []);
  } else if (at('--issue')) {
    const issue = JSON.parse(execFileSync('gh', ['issue', 'view', at('--issue'), '--json', 'number,title,body,labels,createdAt'], {encoding: 'utf8'}));
    const {finding, logs} = findingOf(issue);
    items = [{key: String(issue.number), finding, logs, png: picture(at('--screenshot'))}];
  } else {
    items = JSON.parse(read(at('--pending')) || '[]').map(item => ({key: item.id, finding: item, png: picture(item.screenshot),
      logs: (item.logs || []).map(file => `${path.basename(file)}:\n${read(file).slice(-3000)}`).join('\n\n')}));
  }
  const {verdicts, run} = await judgeAll(items, {setup, rules, lessons, ask, cwd: repo, ...(excerpts ? {excerpts} : {})});
  if (at('--issue')) { if (verdicts[items[0].key]) fs.writeFileSync(at('--out'), `${verdicts[items[0].key]}\n`); } else fs.writeFileSync(at('--out'), JSON.stringify(verdicts, null, 2));
  const temp = process.env.RUNNER_TEMP || os.tmpdir();
  fs.writeFileSync(path.join(temp, 'judge-run.json'), JSON.stringify(run));
  // /ai-cost counts Anthropic spend: the Haiku part, as {usd, calls} for ai-cost-report.mjs --file. Free AI's part is in the line below and the run's record.
  fs.writeFileSync(path.join(temp, 'judge-haiku-cost.json'), JSON.stringify({usd: run.usdBy.haiku, calls: run.by.haiku || 0}));
  console.log(`${Object.keys(verdicts).length} of ${items.length} finding(s) judged (${setup}: ${Object.entries(run.by).map(([who, n]) => `${who} ${n}`).join(', ') || 'none'}), $${run.usd.toFixed(4)} in ${run.calls} call(s): Free AI $${run.usdBy.free.toFixed(4)}, Haiku $${run.usdBy.haiku.toFixed(4)}`);
  for (const line of run.failed) console.log(`not judged: ${line}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
