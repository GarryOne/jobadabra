// Exact quality checks: the app keeps the golden facts and scores and protects private logs.
/* global document */
// Job: run the backbone
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {qualityJourney} from '../lib/quality-journey.mjs';
import {notKeptNote} from '../lib/quality-rows.mjs';
import {capViolations, checkFacts, dirtyRows, dirtyText, matchRows, missingColumns, mayBeEmptyFor, normalizeUrl, rankingViolations} from '../lib/quality.mjs';

export const name = 'quality';
// Why (29 Oct 2026, a8, beta 4 run 40776424584): strict replay answers were recorded on SQLite; alternating to the stand-in
// changes setup requests and leaves questions without stored answers, so every run must follow the recorded SQLite path.
export const store = 'sqlite';
// About $0.03 a run on Haiku 5.5 (was ~$0.3 on Sonnet until 27 Oct 2026): the nightly release gate, and a push that touches what it judges (scoring and enrichment prompts, the model ids, its own fixtures), not the three-a-day schedule.
export const cadence = 'nightly';
// Each slow step has its own time limit (owner, 27 Oct 2026: "Code gate + AI rate"): a replayed gate takes ~2 min (the Jobs check 26 s); the night's live run
// ~6-9 min (the Jobs check up to 330 s, the second scoring 120 s, 26-27 Oct 2026). The budget holds the live run; minutes holds it twice plus the setup.
export const budgetMinutes = 10;
export const minutes = 24;
// It judges the AI's answers (scores, facts), which are the same on every OS: the Mac lane only, no Windows run (owner, 7 Oct 2026: $1.36 a day on Windows).
export const sameOnEveryOs = true;
// Why (27 Oct 2026, #2234): the AI files this suite judges. Its answers are replayed strictly, so a changed prompt it ran must run its own steps on the PR (which records
// the new answers for main); a line in them is never "shared code" another suite runs for it (lib/coverage-pick.mjs stepsCovering). #2234 changed place_triage.py
// and only activity ran it; main's quality then asked 1-6 questions live and went red.
// Again on 28 Oct: #2337 reworded the question-reuse prompt and no suite ran, so the beta's quality asked it live. Every app prompt file this suite asks is in watches
// (e2e/test/quality-watches-prompts.test.mjs).
export const judges = ['src/ai/'];
export const watches = ['src/ai/score.py', 'src/ai/score_bands.py', 'src/ai/enrich.py', 'src/ai/hints.py', 'desktop/lib/pipeline.js', 'desktop/lib/question-reuse.js', 'desktop/lib/match-check.js', 'desktop/e2e/fixtures/golden/'];
// This suite measures what a user gets, so the app under test runs on the shipped model (about $0.3 a run); the other suites run on Haiku. For a cheap run:
// E2E_APP_MODEL=claude-haiku-4-5 (Haiku 4.5 scored the same job up to 10 points apart between two scorings, Sonnet within 6).
export const env = {JOB_PILOTTO_MODEL_OVERRIDE: process.env.E2E_APP_MODEL || 'claude-sonnet-5-5'};
// A persona's Profile is a file the engine reads instead of the test page's Profile (test-only: desktop/lib/pipeline.js JOB_PILOTTO_E2E_PROFILE_FILE).
if (process.env.E2E_QUALITY_PERSONA) env.JOB_PILOTTO_E2E_PROFILE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', `golden-${process.env.E2E_QUALITY_PERSONA}`, 'profile.md');
/** Run the golden journey and report every independent final check. */
export async function run(ctx) {
  const {page} = ctx;
  const journey = qualityJourney(ctx);
  const {truth, postings, scoresOf, privacyLogs} = journey;
  const summary = {facts: {exact: 0, total: 0}, ranking: 'not checked'};
  ctx.findings = [];
  await journey.setUp();
  const late = [];   // the last checks are independent: each one reports, and the suite fails after all of them ran
  const soft = async step => { try { await step(); } catch (error) { late.push(error); } };
  try {
    await journey.reset();
    await journey.jobs();
    const {rows, appJobs} = journey;

    await ctx.run('every enriched fact equals the ground truth (seniority, work mode, location, languages, salary, role family)', async () => {
      const {byId} = matchRows(truth, rows);
      const problems = [];
      for (const item of postings) {
        const found = byId[item.id];
        if (!found) {   // a job the store lost is a missing fact in this exact check
          if (!item.filterMayDrop) { problems.push(`"${item.title}" is missing from Notion`); }
          continue;
        }
        for (const result of checkFacts(item, found[0])) {
          summary.facts.total++;
          if (result.ok) summary.facts.exact++; else problems.push(`"${result.posting}": ${result.fact} should be ${JSON.stringify(result.expected)}, the app wrote ${JSON.stringify(result.actual)}`);
        }
      }
      console.log(`  ${summary.facts.exact}/${summary.facts.total} facts exact${notKeptNote(rows) ? `; ${notKeptNote(rows)}` : ''}`);
      if (problems.length) throw new Error(`${problems.length} wrong or missing fact(s):\n    ${problems.join('\n    ')}`);
    }, {needs: ctx.needs});

    await ctx.run('the duplicate posting is one job, everywhere', async () => {
      const urls = rows.map(row => normalizeUrl(row.props['Job URL']));
      const copies = [...new Set(urls.filter((url, i) => urls.indexOf(url) !== i))];
      const titles = rows.map(row => `${row.props.Job}|${row.props.Location}`);
      const sameTitle = [...new Set(titles.filter((title, i) => titles.indexOf(title) !== i))];
      const inApp = appJobs.map(job => normalizeUrl(job.url)).filter(url => url.startsWith('https://boards.e2e.test/')), appCopies = [...new Set(inApp.filter((url, i) => inApp.indexOf(url) !== i))];
      const {strays} = matchRows(truth, rows);
      const problems = [...copies.map(url => `Notion has two rows for ${url}`), ...sameTitle.map(title => `Notion lists "${title}" twice`),
        ...appCopies.map(url => `the app's list shows ${url} twice`), ...strays.map(row => `a row no posting explains: ${row.props.Job} (${row.props['Job URL']})`)];
      if (problems.length) throw new Error(problems.join('; '));
    }, {needs: ctx.needs});

    await ctx.run('relevant jobs rank above irrelevant ones, and scores are whole numbers from 0 to 100', async () => {
      const scores = scoresOf();
      const outside = rows.filter(row => !(Number.isInteger(row.props.Score) && row.props.Score >= 0 && row.props.Score <= 100));
      if (outside.length) throw new Error(`a score is not a whole number from 0 to 100: ${outside.map(row => `${row.props.Job} = ${row.props.Score}`).join(', ')}`);
      const high = postings.filter(item => item.fit === 'high');
      const missing = high.filter(item => scores[item.id] == null);
      if (missing.length) throw new Error(`relevant job(s) were not scored: ${missing.map(item => item.title).join(', ')}`);
      const violations = rankingViolations(truth, scores);
      summary.ranking = violations.length ? `${violations.length} violation(s)` : 'ok';
      console.log(`  scores: ${postings.map(item => `${item.id}=${scores[item.id] ?? 'dropped'}`).join(' ')}`);
      if (violations.length) throw new Error(violations.map(v => `"${v.low}" (${v.lowScore}) is not below "${v.high}" (${v.highScore})`).join('; '));
      const over = capViolations(truth, scores), said = over.map(v => `"${v.title}" scored ${v.score}, above its cap ${v.cap}`).join('; ');
      if (over.length) throw new Error(`a job with an unmet stated requirement is scored too high: ${said}`);
    }, {needs: ctx.needs});

    await ctx.run('every Notion column the app promises is filled, and no text shows a programming accident', async () => {
      const problems = [];
      for (const row of rows) { const item = matchRows(truth, [row]).byId; const posting = truth.find(entry => item[entry.id]); const missing = missingColumns(row, mayBeEmptyFor(posting)); if (missing.length) problems.push(`${row.props.Job}: empty ${missing.join(', ')}`); }
      for (const dirty of dirtyRows(rows)) problems.push(`${dirty.where} shows ${dirty.problems.join(', ')}`);
      if (notKeptNote(rows)) console.log(`  ${notKeptNote(rows)}`);
      // What a person reads: the Jobs page and the app's own list.
      const visible = await page.evaluate(() => document.querySelector('.view[data-view="jobs"]')?.innerText || '');
      for (const found of dirtyText(visible)) problems.push(`the Jobs page shows ${found}`);
      for (const job of appJobs) for (const found of dirtyText(`${job.title} ${job.reason}`)) problems.push(`the app's list shows ${found} for "${job.title}"`);
      if (problems.length) throw new Error(problems.join('; '));
    }, {needs: ctx.needs});

    await ctx.run('the app\'s list agrees with Notion (same jobs, same scores)', async () => {
      const problems = [];
      for (const row of rows) {
        const job = appJobs.find(item => normalizeUrl(item.url) === normalizeUrl(row.props['Job URL']));
        if (!job) problems.push(`"${row.props.Job}" is in Notion but not in the app's list`);
        else if (Number(job.fit) !== row.props.Score) problems.push(`"${row.props.Job}": Notion says ${row.props.Score}, the app shows ${job.fit}`);
      }
      if (problems.length) throw new Error(problems.join('; '));
    }, {needs: ctx.needs});

    await soft(privacyLogs);

    if (late.length) throw new Error(`${late.length} quality check(s) failed: ${late.map(error => error.message.split('\n')[0].slice(0, 120)).join(' | ')}`);
  } finally {   // the one-line summary is printed whatever failed
    const line = `quality: ${summary.facts.exact}/${summary.facts.total} facts exact, ranking ${summary.ranking}`;
    console.log(`\n${line}\n`);
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'quality-summary.txt'), line + '\n');
  }
}
