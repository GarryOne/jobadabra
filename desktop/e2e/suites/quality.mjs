// Exact quality checks: the app keeps the golden facts and scores and protects private logs.
/* global document */
// Job: run the backbone
import fs from 'node:fs';
import path from 'node:path';
import {answersMode} from '../lib/ai-answers.mjs';
import {PLANNER, collectFacts, qualityJourney, rankingCheck} from '../lib/quality-journey.mjs';
import {QUALITY_CLOCK, qualityEvidence, qualityHang, withQualityHang} from '../lib/quality-waits.mjs';
import {notKeptNote} from '../lib/quality-rows.mjs';
import {dirtyRows, dirtyText, matchRows, missingColumns, mayBeEmptyFor, normalizeUrl} from '../lib/quality.mjs';

export const name = 'quality';
// Why (29 Oct 2026, a8, beta 4 run 40776424584): strict replay answers were recorded on SQLite; alternating to the stand-in
// changes setup requests and leaves questions without stored answers, so every run must follow the recorded SQLite path.
export const store = 'sqlite';
// Exact golden facts, duplicates, ranking, columns and logs; no judge or rescore calls.
// Why (29 Oct 2026, qu 3/4): the backbone has measured hang caps, not a speed budget; qualityai retains PLANNER's live allowances.
export const aggregateBudget = false;
export const hangCaps = Object.freeze({'': QUALITY_CLOCK.stateMs / 1000,
  'a Jobs check on the golden postings finishes and scores them': QUALITY_CLOCK.jobsMs / 1000});
export const cadence = PLANNER.cadence;
// CI accepts whole minutes: round the measured whole-journey hang cap upward.
export const minutes = Math.ceil(QUALITY_CLOCK.suiteMs / 60000);
export const sameOnEveryOs = PLANNER.sameOnEveryOs;
// Why (27 Oct 2026, #2234): the AI files this suite judges. Its answers are replayed strictly, so a changed prompt it ran must run its own steps on the PR (which records
// the new answers for main); a line in them is never "shared code" another suite runs for it (lib/coverage-pick.mjs stepsCovering). #2234 changed place_triage.py
// and only activity ran it; main's quality then asked 1-6 questions live and went red.
// Again on 28 Oct: #2337 reworded the question-reuse prompt and no suite ran, so the beta's quality asked it live. Every app prompt file this suite asks is in watches
// (guard: e2e/test/quality-watches-prompts.test.mjs). Since qu 1/4 (29 Oct 2026) the lists live once in PLANNER (lib/quality-journey.mjs), shared with qualityai.
export const judges = PLANNER.judges;
export const watches = PLANNER.watches;
export const env = PLANNER.env;
/** Run the golden journey and report every independent final check. */
export async function run(ctx) {
  if (answersMode(process.env) === 'off') throw new Error('quality is a backbone suite: set E2E_AI_ANSWERS=backbone (or record for a record run)');
  const runStep = ctx.run;
  // Why (29 Oct 2026, qu 3/4): the runner's outer step cap must preserve the same named hang and engine evidence as an inner state wait.
  ctx.run = (name, work, options) => runStep(name, work, {...options, hangError: capMs => qualityHang(name, capMs, ctx.qualityWaitEvidence?.() ?? qualityEvidence(ctx))});
  try {
    return await withQualityHang(() => runJourney(ctx), {label: 'the quality journey', capMs: QUALITY_CLOCK.suiteMs, evidence: () => ctx.qualityWaitEvidence?.() ?? qualityEvidence(ctx)});
  } finally { ctx.run = runStep; }
}

async function runJourney(ctx) {
  const {page} = ctx;
  const journey = qualityJourney(ctx);
  const {truth, privacyLogs} = journey;
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
      const {exact, total, problems} = collectFacts(journey);
      summary.facts = {exact, total};
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
      rankingCheck(journey, {
        onRanking: ranking => { summary.ranking = ranking; },
        onCap: (over, said) => {
          if (over.length) throw new Error(`a job with an unmet stated requirement is scored too high: ${said}`);
        },
      });
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
