// Scores the Free AI screenshot review (lib/review-free.mjs, the one CI runs) on the issues people already judged (owner, 26 Oct 2026: "aim at 70-80% of Claude's
// bug catch"): every AI-review issue closed as resolution:fixed (a real bug: is it seen again?) or resolution:by-design (a false alarm: is it raised again?),
// on the issue's own screenshot and the app state it recorded. "The same problem" is judged by gpt-oss-120b; a failed or cut-off answer is asked again, never read as "no".
// Tune on the "tune" cases, report on "held" (positions 1, 4, 6 of every 8 per kind, by issue number): a prompt change is kept only when held does not drop.
//   CI_FREE_AI_CF_TOKEN=… CI_FREE_AI_CF_ACCOUNT_ID=… GITHUB_TOKEN=… node review-eval.mjs --out <dir> [--split tune|held|all] [--lessons on|off] [--limit n]
// Each case gets the by-design lessons of the OTHER issues only (lib/review-lessons.mjs, exclude), so a lesson never grades itself.
// Writes <dir>/review-eval.json and prints one table. Measured 26 Oct 2026: $0.0076 a screenshot, 48 screenshots about $0.40 on CI's Workers AI token.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {FREE_MODEL, MODELS, reviewFree, runModel} from './lib/review-free.mjs';
import {fetchLessons, lessonsFor, lessonsText} from './lib/review-lessons.mjs';
import {parseFindings} from './lib/vision.mjs';

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const OUT = arg('out');
if (!OUT) { console.error('usage: node review-eval.mjs --out <dir> [--split tune|held|all] [--lessons on|off] [--limit n]'); process.exit(2); }
const SPLIT = arg('split', 'all'), LESSONS = arg('lessons', 'on'), LIMIT = Number(arg('limit', 0)) || Infinity;
const REPO = process.env.GITHUB_REPOSITORY || 'GarryOne/jobadabra';
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
fs.mkdirSync(path.join(OUT, 'shots'), {recursive: true});

async function github(url) {
  const response = await fetch(url, {headers: {accept: 'application/vnd.github+json', ...(token ? {authorization: `Bearer ${token}`} : {})}});
  if (!response.ok) throw new Error(`GitHub ${response.status} on ${url}`);
  return response.json();
}

// An issue -> {number, kind, view, png, title, found, facts}; facts from its "App state when this was taken" block.
export function caseFromIssue(issue) {
  const body = issue.body || '', kind = issue.labels.map(item => item.name).find(name => name.startsWith('resolution:'))?.slice(11);
  const state = body.match(/App state when this was taken<\/summary>([\s\S]*?)<\/details>/)?.[1] || '';
  const facts = Object.fromEntries([...state.matchAll(/- \*\*([^:*]+):\*\* (.+)/g)].map(m => [m[1].trim(), m[2].trim()]));
  return {number: issue.number, kind, view: body.match(/Page `([^`]+)`/)?.[1], png: body.match(/!\[[^\]]*\]\((https:\/\/raw\.githubusercontent\.com\/[^)]+\.png)\)/)?.[1],
    title: issue.title.replace(/^\[auto-ui\]\s*[^:]*:\s*/, ''), found: (body.match(/### What was found\n+([\s\S]*?)\n###/)?.[1] || '').trim().slice(0, 600), facts: Object.keys(facts).length ? facts : null};
}
// Held-out: per kind, sorted by number, positions 1, 4 and 6 of every 8.
export const markHeld = cases => { for (const kind of ['fixed', 'by-design']) cases.filter(c => c.kind === kind).sort((a, b) => a.number - b.number).forEach((c, i) => { c.held = [1, 4, 6].includes(i % 8); }); return cases; };

// Same problem? -> true | false | null (the matcher never answered).
export async function same(item, findings, opts = {}) {
  if (!findings.length) return {same: false, usd: 0};
  let usd = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const answer = await runModel(MODELS.judge, [{role: 'system', content: 'You compare bug reports about one screenshot of an app. Reply with ONE JSON object: {"same": true} when any NEW finding reports the same problem as the EARLIER report (the same element and the same complaint, in any words; a broader finding that clearly includes it counts), else {"same": false}.'},
      {role: 'user', content: `EARLIER report: ${item.title}\n${item.found}\n\nNEW findings:\n${findings.map(f => `- ${f.title}: ${f.detail}`).join('\n')}`}], {max: 3000, ...opts});
    usd += answer.usd || 0;
    const said = answer.ok && answer.text.match(/"same"\s*:\s*(true|false)/);
    if (said) return {same: said[1] === 'true', usd};
  }
  return {same: null, usd};
}

export function score(rows) {
  const part = held => {
    const done = rows.filter(row => typeof row.same === 'boolean' && row.held === held), fixed = done.filter(row => row.kind === 'fixed'), design = done.filter(row => row.kind === 'by-design');
    const seen = fixed.filter(row => row.same).length, again = design.filter(row => row.same).length;
    return {seen, fixed: fixed.length, again, design: design.length, recall: fixed.length ? seen / fixed.length : null, precision: seen + again ? seen / (seen + again) : null,
      perShot: done.length ? done.reduce((sum, row) => sum + row.usd, 0) / done.length : 0, findings: done.length ? done.reduce((sum, row) => sum + row.findings, 0) / done.length : 0};
  };
  return {tune: part(false), held: part(true)};
}

async function main() {
  const issues = [];
  for (let page = 1; page < 10; page++) {
    const got = await github(`https://api.github.com/repos/${REPO}/issues?state=all&labels=source:ai-review&per_page=100&page=${page}`);
    issues.push(...got.filter(item => !item.pull_request));
    if (got.length < 100) break;
  }
  const cases = markHeld(issues.map(caseFromIssue).filter(item => ['fixed', 'by-design'].includes(item.kind) && item.view && item.png))
    .filter(item => SPLIT === 'all' || (SPLIT === 'held') === item.held).slice(0, LIMIT);
  const lessons = LESSONS === 'off' ? [] : await fetchLessons({repo: REPO, token});
  console.log(`${cases.length} judged screenshots (${cases.filter(c => c.kind === 'fixed').length} fixed, ${cases.filter(c => c.kind === 'by-design').length} by design), ${lessons.length} lessons, reviewer ${FREE_MODEL}`);
  const rows = [], queue = [...cases];
  await Promise.all(Array.from({length: 4}, async () => {
    while (queue.length) {
      const item = queue.shift(), file = path.join(OUT, 'shots', `${item.number}.png`);
      if (!fs.existsSync(file)) { const response = await fetch(item.png); if (!response.ok) { rows.push({...item, gone: true}); continue; } fs.writeFileSync(file, Buffer.from(await response.arrayBuffer())); }
      const answer = await reviewFree({view: item.view, pngBase64: fs.readFileSync(file).toString('base64'), facts: item.facts,
        lessons: lessonsText(lessonsFor(lessons, item.view, {exclude: item.number}))});
      if (!answer.ok) { rows.push({...item, failed: `${answer.status} ${answer.detail}`.slice(0, 160)}); console.log(`  #${item.number}: failed ${answer.status}`); continue; }
      const findings = parseFindings(answer.message.content[0].text, item.view), judged = await same(item, findings);
      rows.push({number: item.number, kind: item.kind, held: item.held, view: item.view, findings: findings.length, same: judged.same, usd: answer.usd + judged.usd,
        readersFailed: answer.readers.filter(reader => reader.failed).map(reader => reader.name), titles: findings.map(f => f.title)});
      console.log(`  #${item.number} ${item.kind.padEnd(9)}${item.held ? ' held' : ' tune'} ${String(findings.length).padStart(2)} finding(s)${judged.same ? ', the same problem again' : ''}${judged.same === null ? ' (matcher never answered)' : ''}`);
    }
  }));
  const result = score(rows), pct = x => (x == null ? '-' : `${Math.round(x * 100)}%`);
  console.log('\n| Split | Real bugs seen again | By-design raised again | Precision | Findings a screen | $ a screen |\n|---|---|---|---|---|---|');
  for (const [name, s] of Object.entries(result)) console.log(`| ${name} | ${s.seen}/${s.fixed} (${pct(s.recall)}) | ${s.again}/${s.design} | ${pct(s.precision)} | ${s.findings.toFixed(1)} | $${s.perShot.toFixed(4)} |`);
  fs.writeFileSync(path.join(OUT, 'review-eval.json'), JSON.stringify({at: new Date().toISOString(), reviewer: FREE_MODEL, models: MODELS, score: result, rows}, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
