// Scores a screenshot reviewer on the issues people already judged (owner, 26 Oct 2026: keep the scorecard's precision visible before/after, so a weaker
// judge shows): every AI-review issue closed as resolution:fixed (a real bug: did the reviewer see it again?) or resolution:by-design (a false alarm: did it
// raise it again?), on the issue's own screenshot. "The same problem" is judged by a small Workers AI text model, never by word matching.
//   CI_FREE_AI_CF_TOKEN=… CI_FREE_AI_CF_ACCOUNT_ID=… GITHUB_TOKEN=… node review-eval.mjs --out <dir> [--models a,b] [--lessons both|on|off] [--limit n]
// A claude-* model is asked on E2E_ANTHROPIC_KEY (CI only: .github/workflows/review-eval.yml, by hand); the judge stays a small Workers AI text model.
// Each by-design issue is scored with the lessons of the OTHER issues only (lib/review-lessons.mjs, exclude), so a lesson never grades itself.
// Writes <dir>/review-eval.json and prints one table. Costs about $0.002 a screenshot per model on CI's Workers AI token (measured, Oct 2026).
import fs from 'node:fs';
import path from 'node:path';
import {DESKTOP} from './lib/app.mjs';
import {buildRequest, parseFindings, usageCost} from './lib/vision.mjs';
import {FREE_MODEL, askFree} from './lib/review-free.mjs';
import {checklistRequest, checksToFindings} from './lib/review-checklist.mjs';
import {fetchLessons, lessonsFor, lessonsText} from './lib/review-lessons.mjs';

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const OUT = arg('out');
if (!OUT) { console.error('usage: node review-eval.mjs --out <dir> [--models a,b] [--lessons both|on|off] [--limit n]'); process.exit(2); }
const MODELS = arg('models', FREE_MODEL).split(',');   // a claude-* model may carry its effort and the checklist prompt: claude-haiku-5-5:high, claude-haiku-5-5+checklist
const LESSONS = arg('lessons', 'both'), LIMIT = Number(arg('limit', 0)) || Infinity;
const JUDGE = process.env.E2E_REVIEW_EVAL_JUDGE || '@cf/qwen/qwen3-30b-a3b-fp8';
const REPO = process.env.GITHUB_REPOSITORY || 'GarryOne/jobadabra';
// A Claude model answers in the same shape as askFree: {ok, message, usd} or {ok: false, status, detail}.
async function askClaude(request, {model}) {
  const response = await fetch(`${process.env.E2E_ANTHROPIC_URL || 'https://api.anthropic.com'}/v1/messages`, {method: 'POST', signal: AbortSignal.timeout(120000),
    headers: {'x-api-key': process.env.E2E_ANTHROPIC_KEY || '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json'}, body: JSON.stringify({...request, model})}).catch(error => error);
  if (response instanceof Error) return {ok: false, status: 0, detail: response.message};
  if (!response.ok) return {ok: false, status: response.status, detail: (await response.text().catch(() => '')).slice(0, 300)};
  const message = await response.json();
  return {ok: true, message: {...message, content: (message.content || []).filter(block => block.type === 'text')}, usd: usageCost(model, message.usage || {}) || 0};
}
const ask = (request, {model}) => (model.startsWith('claude-') ? askClaude(request, {model}) : askFree(request, {model}));
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
fs.mkdirSync(path.join(OUT, 'shots'), {recursive: true});
const skill = path.resolve(DESKTOP, '..', '.claude', 'skills', 'ui-look-and-feel', 'SKILL.md');
const rules = fs.existsSync(skill) ? fs.readFileSync(skill, 'utf8').replace(/^---[\s\S]*?---/, '') : '';

async function github(url) {
  const response = await fetch(url, {headers: {accept: 'application/vnd.github+json', ...(token ? {authorization: `Bearer ${token}`} : {})}});
  if (!response.ok) throw new Error(`GitHub ${response.status} on ${url}`);
  return response.json();
}
const label = (issue, prefix) => issue.labels.map(item => item.name).find(name => name.startsWith(prefix));
const issues = [];
for (let page = 1; page < 10; page++) {
  const got = await github(`https://api.github.com/repos/${REPO}/issues?state=all&labels=source:ai-review&per_page=100&page=${page}`);
  issues.push(...got.filter(item => !item.pull_request));
  if (got.length < 100) break;
}
const cases = issues.map(issue => ({number: issue.number, resolution: label(issue, 'resolution:'), view: issue.body?.match(/Page `([^`]+)`/)?.[1],
  png: issue.body?.match(/!\[[^\]]*\]\((https:\/\/raw\.githubusercontent\.com\/[^)]+\.png)\)/)?.[1], title: issue.title.replace(/^\[auto-ui\]\s*[^:]*:\s*/, ''),
  found: (issue.body?.match(/### What was found\n+([\s\S]*?)\n###/)?.[1] || '').trim().slice(0, 600)}))
  .filter(item => ['resolution:fixed', 'resolution:by-design'].includes(item.resolution) && item.view && item.png).slice(0, LIMIT);
const lessons = LESSONS === 'off' ? [] : await fetchLessons({repo: REPO, token});
console.log(`${cases.length} labelled screenshots (${cases.filter(c => c.resolution === 'resolution:fixed').length} fixed, ${cases.filter(c => c.resolution === 'resolution:by-design').length} by design), ${lessons.length} lessons, models: ${MODELS.join(', ')}`);

async function shot(item) {
  const file = path.join(OUT, 'shots', `${item.number}.png`);
  if (!fs.existsSync(file)) {
    const response = await fetch(item.png);
    if (!response.ok) return null;
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  return fs.readFileSync(file).toString('base64');
}

// Same problem? A yes/no from a small text model; its cost is added to the run's.
async function same(item, findings) {
  if (!findings.length) return {same: false, usd: 0};
  const request = {system: [{type: 'text', text: 'You compare bug reports about one screenshot of an app. Answer with ONE JSON object: {"same": true} when any NEW finding reports the same problem as the EARLIER report (the same element and the same complaint, in any words), else {"same": false}.'}],
    messages: [{role: 'user', content: [{type: 'text', text: `EARLIER report: ${item.title}\n${item.found}\n\nNEW findings:\n${findings.map(f => `- ${f.title}: ${f.detail}`).join('\n')}`}]}]};
  const answer = await askFree(request, {model: JUDGE});
  const text = answer.ok ? answer.message.content[0].text : '';
  return {same: /"same"\s*:\s*true/.test(text.replace(/<think>[\s\S]*?<\/think>/, '')), usd: answer.usd || 0, failed: !answer.ok};
}

const runs = [];
for (const model of MODELS) for (const withLessons of LESSONS === 'both' ? [false, true] : [LESSONS === 'on']) {
  const run = {model, lessons: withLessons, usd: 0, rows: []};
  for (const item of cases) {
    const pngBase64 = await shot(item);
    if (!pngBase64) { run.rows.push({...item, gone: true}); continue; }
    const extra = withLessons ? lessonsText(lessonsFor(lessons, item.view, {exclude: item.number})) : '';
    const checklist = model.startsWith('claude-') && model.includes('+checklist');
    const [name, effort = ''] = model.startsWith('claude-') ? model.replace('+checklist', '').split(':') : [model];
    const answer = await ask(checklist ? checklistRequest({view: item.view, pngBase64, lessons: extra, model: name, effort}) : buildRequest({view: item.view, pngBase64, rules, lessons: extra, model: name, effort}), {model: name});
    if (answer.ok && answer.message.stop_reason === 'max_tokens') { run.usd += answer.usd || 0; run.rows.push({...item, failed: 'cut off'}); console.log(`  #${item.number} ${model}: cut off`); continue; }
    if (!answer.ok) { run.rows.push({...item, failed: `${answer.status} ${answer.detail}`.slice(0, 160)}); console.log(`  #${item.number} ${model}: failed ${answer.status}`); continue; }
    const findings = checklist ? checksToFindings(answer.message.content[0].text) : parseFindings(answer.message.content[0].text, item.view), judged = await same(item, findings);
    run.usd += (answer.usd || 0) + judged.usd;
    run.rows.push({number: item.number, resolution: item.resolution, view: item.view, findings: findings.length, same: judged.same});
    console.log(`  #${item.number} ${item.resolution.slice(11).padEnd(9)} ${String(findings.length).padStart(2)} finding(s)${judged.same ? ', the same problem again' : ''}${judged.failed ? ' (judge failed)' : ''}`);
  }
  runs.push(run);
}

const score = run => {
  const done = run.rows.filter(row => typeof row.same === 'boolean'), fixed = done.filter(row => row.resolution === 'resolution:fixed'), design = done.filter(row => row.resolution === 'resolution:by-design');
  const seen = fixed.filter(row => row.same).length, again = design.filter(row => row.same).length;
  return {seen, fixed: fixed.length, again, design: design.length, precision: seen + again ? seen / (seen + again) : null, findings: done.reduce((sum, row) => sum + row.findings, 0) / (done.length || 1)};
};
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const before = {seen: cases.filter(c => c.resolution === 'resolution:fixed').length, design: cases.filter(c => c.resolution === 'resolution:by-design').length};
console.log(`\n| Reviewer | Real bugs seen again | By-design raised again | Precision | Findings per shot | Cost |\n|---|---|---|---|---|---|`);
console.log(`| Claude Sonnet (filed them) | ${before.seen}/${before.seen} | ${before.design}/${before.design} | ${pct(before.seen, before.seen + before.design)} | - | ~$0.02 a shot |`);
for (const run of runs) {
  const s = score(run);
  console.log(`| ${run.model.replace(/^@cf\//, '')}${run.lessons ? ' + lessons' : ''} | ${s.seen}/${s.fixed} (${pct(s.seen, s.fixed)}) | ${s.again}/${s.design} | ${s.precision == null ? '-' : pct(s.seen, s.seen + s.again)} | ${s.findings.toFixed(1)} | $${run.usd.toFixed(3)} |`);
}
for (const run of runs) { const missed = run.rows.filter(row => row.failed); if (missed.length) console.log(`${run.model}: ${missed.length} screenshot(s) not scored (${[...new Set(missed.map(row => row.failed.slice(0, 40)))].join('; ')})`); }
fs.writeFileSync(path.join(OUT, 'review-eval.json'), JSON.stringify({at: new Date().toISOString(), judge: JUDGE, runs: runs.map(run => ({...run, score: score(run)}))}, null, 2));
