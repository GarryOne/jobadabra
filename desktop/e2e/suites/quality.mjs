/* global document, window */
// Quality: not whether the Jobs check ran, but whether what it produced is RIGHT. Twelve fictional postings with a known ground truth (fixtures/golden/truth.json)
// go through the real check; the Notion Job Matches rows and the app's own list are then compared with the truth: facts exact, a duplicate collapsed, relevant jobs
// above irrelevant ones, scores in range and stable, every column filled, no programming accident in any text, no job text in the logs. A Haiku judge reads the
// free text (reason, strengths, gaps) for invented facts. Starts from a set-up install; resets only its own job and run rows.
import {modelClient} from '../lib/model.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {python, pythonEnv} from '../lib/python.mjs';
import {fileURLToPath} from 'node:url';
import {sample, watch} from '../lib/activity.mjs';
import {fresh, missedQuestions, replaying, strict} from '../lib/ai-meter.mjs';
import {factsVerdict, flagsVerdict, nightOf, rateOf, rateVerdict, recordNight} from '../lib/quality-rate.mjs';
import {failures, judge} from '../lib/factjudge.mjs';
import {placesNote} from '../lib/quality-places.mjs';
import {plainTextOf, rewriteTextLines} from '../lib/seed-texts.mjs';
import {MATCHES, matchRowsOf, notKeptNote} from '../lib/quality-rows.mjs';
import {clearData} from '../lib/start-state.mjs';
import {capViolations, checkFacts, dirtyRows, dirtyText, fingerprints, leaks, judgeVerdict, matchRows, missingColumns, mayBeEmptyFor, normalizeUrl, rankingViolations, unstable, workLeft} from '../lib/quality.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {withRoles} from '../lib/search-roles.mjs';
import {quiet} from '../lib/activity-steps.mjs';

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
const STEP = 60000;
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
// E2E_QUALITY_PERSONA=photographer runs the same checks for a fictional commercial photographer in Zurich (fixtures/golden-photographer: her CV, her Profile, 12 postings with a
// known truth, and her CV for the CV-match step), so scoring, ranking, facts and the judge are proven for a profession that is not IT. Default: the SRE.
const PERSONA = process.env.E2E_QUALITY_PERSONA || '';
const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', PERSONA ? `golden-${PERSONA}` : 'golden');
const persona = PERSONA ? JSON.parse(fs.readFileSync(path.join(GOLDEN, 'persona.json'), 'utf8')) : null;
const read = file => JSON.parse(fs.readFileSync(path.join(GOLDEN, file), 'utf8'));

export async function run(ctx) {
  const {page} = ctx;
  const truth = process.env.E2E_QUALITY_TRUTH ? JSON.parse(fs.readFileSync(process.env.E2E_QUALITY_TRUTH, 'utf8')) : read('truth.json');   // a different truth: to prove the suite fails
  const candidate = fs.readFileSync(path.join(GOLDEN, 'candidate.txt'), 'utf8');
  const postings = truth.filter(item => !item.duplicateOf);
  const summary = {facts: {exact: 0, total: 0}, ranking: 'not checked', invented: 0, stable: 'not checked'};
  let rows = [], appJobs = [], firstTexts = {};   // firstTexts: the first scoring's texts, judged too (both scorings: 18 texts)
  ctx.findings = [];
  await ensureSetUp(ctx);
  // Why (29 Oct 2026, a8): a search the setup started must end before the Jobs checks read the postings; quiet() returns after 3 s when none runs.
  if (!ctx.built) await ctx.run('the first search after the setup has ended', () => quiet(ctx, {forMs: 3000, maxMs: 300000}), {needs: ctx.needs, critical: true});

  const check = async label => {   // one Jobs check; ends when the task is no longer running
    await page.click('.nav[data-view="jobs"]');
    const before = (await sample(page)).newest;
    await page.click('#refresh');
    // The task must show up first: a watcher that looks too early sees "nothing running" and calls the check done.
    const began = Date.now();
    for (;;) {
      const now = await sample(page);
      if (now.running || JSON.stringify(now.newest) !== JSON.stringify(before)) break;
      if (Date.now() - began > 90000) throw new Error(`the ${label} never started: Refresh on the Jobs page started no task within 90 s`);
      await page.waitForTimeout(1500);
    }
    const {samples, endedAt} = await watch(page, {every: 3000, maxMs: 420000});
    const engineLog = path.join(ctx.profile, 'logs', 'engine.log');
    if (fs.existsSync(engineLog)) fs.copyFileSync(engineLog, path.join(ctx.ARTIFACTS, `quality-engine-${label.split(' ')[0]}.log`));
    if (endedAt == null) throw new Error(`the ${label} was still running after 7 minutes`);
    const newest = samples.at(-1).newest;
    if (newest?.ok === false) {
      const log = path.join(ctx.profile, 'logs', 'engine.log');
      if (fs.existsSync(log)) fs.copyFileSync(log, path.join(ctx.ARTIFACTS, 'quality-engine.log'));
      const tail = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').slice(-12).join('\n    ') : '(no engine log)';
      throw new Error(`the ${label} ended as failed: ${newest.result || '(no result text)'}\n  engine log, last lines:\n    ${tail}`);
    }
    await page.waitForTimeout(2000);
  };
  const read2 = async () => {
    const expected = postings.filter(item => !item.filterMayDrop).length;
    for (let waited = 0; waited < 90000; waited += 5000) {   // Notion's query can trail a write by a few seconds: wait for every posting that must be there
      rows = await matchRowsOf(ctx);   // the store's matches: Notion's rows, or this Mac's records (lib/quality-rows.mjs)
      if (Object.keys(matchRows(truth, rows).byId).length >= expected) break;
      await page.waitForTimeout(5000);
    }
    appJobs = await page.evaluate(() => (window.__jp.shared.allJobs || []).map(job => ({title: job.title, url: job.url, fit: job.fit, reason: job.reason})));
  };
  const scoresOf = () => Object.fromEntries(Object.entries(matchRows(truth, rows).byId).map(([id, list]) => [id, list[0].props.Score]));

  const late = [];   // the last checks are independent: each one reports, and the suite fails after all of them ran
  // How steady the AI is (the same jobs scored twice) is measured where answers are live: the night's fresh run, a Mac. The gate replays (owner, 27 Oct 2026).
  const LIVE = {name: 'live AI answers (the night\'s fresh run): the gate replays, so a second scoring would only repeat the first', value: !replaying()};
  // The night's live run judges the AI by rates over many nights (lib/quality-rate.mjs; owner, 27 Oct 2026); the gate's replayed answers never change, so it
  // checks every fact and the judge allowance exactly. Each step adds its own part of the night once: a retry on the same run measures the same history.
  const night = {runId: Number(process.env.GITHUB_RUN_ID) || `local-${Date.now()}`, day: new Date().toISOString().slice(0, 10)};
  const record = part => rateOf(recordNight(process.env.E2E_QUALITY_HISTORY || '', {...night, ...part}));
  const soft = async step => { try { await step(); } catch (error) { late.push(error); } };
  try {
    await ctx.run('this suite starts with no jobs and no runs in its Notion page', async () => {
      await clearData(ctx, MATCHES); await clearData(ctx, 'Cronjob Runs');
      // The candidate's compensation is known, not whatever the wizard's AI drafted from the CV ("CHF 180,000 (estimate)"): target 170k, minimum 140k.
    if (!persona) {   // a persona states its own compensation in its Profile file
    // The Profile through the store the app uses (this Mac's profile.md or Notion's Profile page).
    const set = [await rewriteTextLines(ctx, 'profile', /^\s*(?:[-*]\s*)?(?:\*\*)?Target:/, 'Target: CHF 170,000 per year in Switzerland'),
      await rewriteTextLines(ctx, 'profile', /^\s*(?:[-*]\s*)?(?:\*\*)?Minimum acceptable:/, 'Minimum acceptable: CHF 140,000 per year in Switzerland')];
    if (set.some(count => count !== 1)) throw new Error(`the Profile should have one Target line and one Minimum acceptable line, found ${set.join(' and ')}`);
    }
    // The golden postings replace the shared fixture feeds: one board, twelve postings (one is a duplicate).
      for (const file of fs.readdirSync(ctx.feeds)) fs.rmSync(path.join(ctx.feeds, file), {force: true, recursive: true});
      for (const file of ['board.json', 'routes.json']) fs.copyFileSync(path.join(GOLDEN, file), path.join(ctx.feeds, file));
      fs.mkdirSync(path.join(ctx.profile, 'config'), {recursive: true});
      fs.copyFileSync(path.join(GOLDEN, 'sources.json'), path.join(ctx.profile, 'config', 'sources.json'));
      // The search is the candidate's (a senior SRE in Zurich), saved the way the app saves it (saveStrategy, search only): on this Mac's store into
      // config/search.json, on Notion into ⚙️ Search settings too, which the engine reads first and which would otherwise keep the setup's places
      // (9 Oct 2026, stand-in: "changed your places: −geneva … −bern" dropped the Geneva and Bern postings, 3008 and 3005).
      const base = JSON.parse(fs.readFileSync(path.join(ctx.E2E, '..', '..', 'config', 'search.example.json'), 'utf8'));
      const roles = persona?.search?.role_keywords || ['\\bsre\\b', 'site reliability', 'platform engineer', 'infrastructure engineer', 'devops engineer'];
      const search = withRoles({...base, locations: {top_tier: ['zurich', 'geneva'], country_wide: ['switzerland', 'basel', 'bern'], abroad: []}, ...(persona?.search || {})}, roles);
      const saved = await page.evaluate(search => window.pilot.saveStrategy({search, profile_markdown: '', answers_markdown: '', contact: {}}, ['search']), search);
      if (!saved?.ok) throw new Error(`the candidate's search was not saved: ${saved?.error || JSON.stringify(saved)}`);
      const kept = JSON.parse(fs.readFileSync(path.join(ctx.profile, 'config', 'search.json'), 'utf8')).locations;
      if (JSON.stringify(kept) !== JSON.stringify(search.locations)) throw new Error(`the saved search holds other places: ${JSON.stringify(kept)}`);
    }, {needs: ctx.needs});

    await ctx.run('a Jobs check on the golden postings finishes and scores them', async () => {
      // A refresh stops its AI steps at 3 minutes and leaves the rest for the next one (desktop/lib/pipeline-args.js SEARCH_BUDGET_S): scoring first, the facts with the
      // time left. A plan engine answers one job at a time (Codex: 15-20 s each, 9 Oct 2026), so its first refresh scores and reads nothing more; refresh again, as a
      // person's next refresh would, until nothing is left (at most 4), so this suite measures what the AI read, not how fast it was.
      const engineLog = path.join(ctx.profile, 'logs', 'engine.log'), size = () => (fs.existsSync(engineLog) ? fs.statSync(engineLog).size : 0);
      for (let round = 1; round <= 4; round++) {
        const from = size();
        await check(round === 1 ? 'first Jobs check' : `Jobs check ${round} (the rest of the first one)`);
        const written = fs.existsSync(engineLog) ? fs.readFileSync(engineLog, 'utf8').slice(from) : '';
        if (!workLeft(written)) break;   // the engine's own mark for work left over (lib/quality.mjs)
        console.log(`  refresh ${round} ran out of time with jobs left (engine ${ctx.engine}): refreshing again`);
      }
      await read2(); if (!rows.length) {
        const config = path.join(ctx.profile, 'config');
        throw new Error(`no Job Matches row was in ${ctx.store === 'sqlite' ? 'this Mac\'s store (matches.list)' : 'Notion'} a minute after the check (app's Notion: ${JSON.stringify(await page.evaluate(() => { const n = window.__jp?.shared?.state?.notion; return n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).filter(([, v]) => typeof v === 'string' && /[0-9a-f]{8}-/.test(v)).map(([k, v]) => [k, v.slice(0, 13)])) : String(n); }))}; profile config: ${fs.existsSync(config) ? fs.readdirSync(config).join(', ') : 'none'}; sources.json: ${fs.existsSync(path.join(config, 'sources.json')) ? fs.readFileSync(path.join(config, 'sources.json'), 'utf8').replace(/\s+/g, ' ') : 'missing'}; feed folder: ${fs.readdirSync(ctx.feeds).join(', ')}; search.json: ${fs.readFileSync(path.join(config, 'search.json'), 'utf8').replace(/\s+/g, ' ').slice(0, 700)})`);
      } }, {needs: ctx.needs, limitMs: 6 * STEP});

    await ctx.run('every enriched fact equals the ground truth (seniority, work mode, location, languages, salary, role family)', async () => {
      const {byId} = matchRows(truth, rows);
      const problems = [];
      let missed = 0;
      for (const item of postings) {
        const found = byId[item.id];
        if (!found) {   // a job the store lost: every fact it holds counts as missed in the rate
          if (!item.filterMayDrop) { problems.push(`"${item.title}" is missing from Notion`); missed += checkFacts(item, {props: {}}).length; }
          continue;
        }
        for (const result of checkFacts(item, found[0])) {
          summary.facts.total++;
          if (result.ok) summary.facts.exact++; else problems.push(`"${result.posting}": ${result.fact} should be ${JSON.stringify(result.expected)}, the app wrote ${JSON.stringify(result.actual)}`);
        }
      }
      console.log(`  ${summary.facts.exact}/${summary.facts.total} facts exact${notKeptNote(rows) ? `; ${notKeptNote(rows)}` : ''}`);
      if (replaying()) { if (problems.length) throw new Error(`${problems.length} wrong or missing fact(s):\n    ${problems.join('\n    ')}`); return; }
      if (problems.length) console.log(`  ${problems.length} wrong or missing fact(s) tonight:\n    ${problems.join('\n    ')}`);
      const rate = factsVerdict(record({factsExact: summary.facts.exact, factsTotal: summary.facts.total + missed}));
      console.log(`  facts: ${rate.line}`);
      if (!rate.ok) throw new Error(`the facts are not exact over the last nights: ${rate.problems.join('; ')}`);
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
      // Why (#2205, owner 27 Oct 2026: "Code gate + AI rate"): the gate's replayed answers never change, so a cap broken there is the code's; one live night
      // broke it once (3005 = 65, run 40451177894) and the night's rates judge the AI, not one draw.
      if (over.length && replaying()) throw new Error(`a job with an unmet stated requirement is scored too high: ${said}`);
      if (over.length) console.log(`  above a cap tonight: ${said}`);
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

    await soft(() => ctx.run('scoring the same jobs again gives the same scores (within 8 points)', async () => {
      const first = scoresOf();
      firstTexts = Object.fromEntries(Object.entries(matchRows(truth, rows).byId).map(([id, list]) => [id, list[0].props]));
      // Ask for every score again, the way "Re-score" does (an empty input hash: no shortcut), then run the check once more.
      const database = path.join(ctx.profile, 'data', 'jobs.sqlite');
      if (!fs.existsSync(database)) throw new Error(`the jobs database is not where expected: ${database}`);
      execFileSync(python(), ['-c', 'import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); db.execute("UPDATE scores SET input_hash=\'\'"); db.commit()', database], {env: pythonEnv({}, {home: ctx.profile})});
      // Fresh answers: replayed, the second scoring got the first one's answers back and always read ±0 (26 Oct 2026; lib/ai-meter.mjs fresh).
      await fresh(async () => { await check('second Jobs check'); await read2(); });
      const second = scoresOf();
      const spread = Object.keys(first).filter(id => second[id] != null).map(id => Math.abs(first[id] - second[id]));
      summary.stable = `within ±${Math.max(0, ...spread)}`;
      console.log(`  second scores: ${postings.map(item => `${item.id}=${second[item.id] ?? '-'}`).join(' ')}`);
      if (!spread.length) throw new Error('the second check scored nothing to compare');
      const apart = unstable(first, second, 8);
      if (apart.length) console.log(`  ${apart.length} of ${spread.length} jobs moved more than 8 points: ${apart.map(item => `${item.id}: ${item.first} → ${item.second}`).join(', ')}`);
      // A rate over the last 90 pairs of the night's live runs (lib/quality-rate.mjs), not this run alone: one wobbly night never turns main red by itself.
      const rate = rateVerdict(record(nightOf(first, second, night)));
      console.log(`  score steadiness: ${rate.line}`);
      if (!rate.ok) throw new Error(`the AI's scores are not steady over the last nights: ${rate.problems.join('; ')}`);
    }, {needs: [...ctx.needs, LIVE], limitMs: 6 * STEP}));

    await soft(() => ctx.run('no job text, CV text or secret reached the logs', async () => {
      const logs = path.join(ctx.profile, 'logs');
      const text = fs.existsSync(logs) ? fs.readdirSync(logs).filter(file => file.endsWith('.log')).map(file => fs.readFileSync(path.join(logs, file), 'utf8')).join('\n') : '';
      if (text.length < 200) throw new Error('the logs are empty: there is nothing to check');
      const needles = [...postings.flatMap(item => fingerprints(item.description)), ...fingerprints(candidate), persona?.email || 'alex.example@example.test', ctx.appKey, ctx.token];
      const found = leaks(text, needles.filter(Boolean));
      if (found.length) throw new Error(`${found.length} piece(s) of private data are in the logs: ${found.map(needle => needle === ctx.appKey || needle === ctx.token ? '(a secret)' : `"${needle.slice(0, 40)}"`).join(', ')}`);
    }, {needs: ctx.needs}));

    await soft(() => ctx.run('the score reasons say nothing invented or untrue (Haiku judge)', async () => {
      const {byId} = matchRows(truth, rows);
      // The candidate as the scoring knows them: only the Profile page it read (src/ai/score.py scores "using only the profile and the posting").
      // The CV text is left out: with it, a gap such as "Datadog is not named in your profile" was judged invented whenever the CV had the skill and
      // the seeded Profile did not (#350: jobs 3001, 3002, 3010 on 11 and 12 Oct 2026).
      const profile = `THE PROFILE\n${persona ? fs.readFileSync(path.join(GOLDEN, 'profile.md'), 'utf8') : await plainTextOf(ctx, 'profile').catch(() => '')}`.slice(0, 30000) + placesNote(JSON.parse(fs.readFileSync(path.join(ctx.profile, 'config', 'search.json'), 'utf8')).locations);   // the places the scorer read (lib/quality-places.mjs)
      const verdicts = [], problems = [];
      // Both scorings' texts when the second ran (18 for 9 jobs; at most one in six may slip, lib/quality.mjs judgeVerdict), else the one there is.
      const todo = postings.filter(item => byId[item.id]).flatMap(item => [{item, p: byId[item.id][0].props}, ...(firstTexts[item.id] ? [{item, p: firstTexts[item.id], first: true}] : [])]);
      for (let i = 0; i < todo.length; i += 4) {
        await Promise.all(todo.slice(i, i + 4).map(async ({item, p, first}) => {
          const produced = [p.Reason, p.Strengths && `Strengths: ${p.Strengths}`, p.Gaps && `Gaps: ${p.Gaps}`];
          const facts = Object.fromEntries(['Seniority', 'Work mode', 'Languages', 'Salary', 'Role family', 'Technologies', 'Recruiter'].map(column => [column, p[column]]));
          // The employer is on every posting the app read (fixtures/golden/sources.json): without it the judge called the company's own name invented (Windows run 37150232804, job 3008).
          const verdict = await judge({key: ctx.judgeKey, posting: {...item, company: item.company || read('sources.json')[0].company}, profile, produced, facts});
          verdicts.push({id: item.id, title: item.title, scoring: first ? 'first' : 'second', produced, facts, verdict});   // facts kept: the judge's inputs, re-judged by another model offline
          const bad = failures(verdict);
          if (bad.length) problems.push(`"${item.title}"${first ? ' (first scoring)' : ''} ${bad.join(' and ')}: ${verdict.why} [text: ${produced.filter(Boolean).join(' / ')}]`);
        }));
      }
      summary.invented = verdicts.filter(v => v.verdict.invents_facts).length;
      fs.writeFileSync(path.join(ctx.ARTIFACTS, 'quality-verdicts.json'), JSON.stringify(verdicts, null, 2));
      // The profile the judge read, once: with the golden postings and each verdict's facts, any model can re-judge the same texts (owner, 27 Oct 2026: keep Haiku, but measure it).
      fs.writeFileSync(path.join(ctx.ARTIFACTS, 'quality-judge-profile.txt'), profile);
      console.log(`  judged ${verdicts.length} score texts: ${verdicts.filter(v => v.verdict.grounded).length} grounded, ${verdicts.filter(v => v.verdict.useful).length} useful, ${summary.invented} with invented facts`);
      if (!replaying()) {   // the night's live run: a rate over the last 90 texts (owner, 27 Oct 2026: "≤ 10% of last 90 texts")
        if (problems.length) console.log(`  ${problems.length} of ${verdicts.length} texts flagged tonight:\n    ${problems.join('\n    ')}`);
        const rate = flagsVerdict(record({judged: verdicts.length, flagged: problems.length}));
        console.log(`  judge flags: ${rate.line}`);
        if (!rate.ok) throw new Error(`the score texts invent or contradict too often over the last nights: ${rate.problems.join('; ')}`);
        return;
      }
      const allowance = judgeVerdict(problems, verdicts.length);
      if (problems.length) console.log(`  ${problems.length} of ${verdicts.length} texts flagged (allowed: ${allowance.allowed}):\n    ${problems.join('\n    ')}`);
      if (!allowance.ok) throw new Error(`${problems.length} of ${verdicts.length} score texts invent facts or contradict the posting (at most ${allowance.allowed} allowed)`);
    }, {needs: ctx.needs, limitMs: 3 * STEP}));

    // The CV match (desktop/lib/match-check.js) on three golden postings with a fixed CV, judged by plain text rules, no second model: the terms the posting and the CV
    // both state must come back as found, and the code has to correct the model's claims about the CV only rarely (it corrects them; this watches how often).
    await soft(() => ctx.run('the CV match is right about the CV on golden postings: required terms found, few claims corrected', async () => {
      process.env.JOB_PILOTTO_MODEL_OVERRIDE ||= env.JOB_PILOTTO_MODEL_OVERRIDE;
      const {check, cvText} = await import('../../lib/match-check.js');
      const cv = persona?.cvMatch?.cv ?? {summary: 'Senior Site Reliability Engineer, nine years in cloud infrastructure, Kubernetes, observability and incident response.', skills: 'Kubernetes, Terraform, AWS, Datadog, OpenTelemetry, SLOs',
        jobs: [{company: 'Acme Cloud', roles: [{title: 'Senior SRE', period: '2022 – Present', place: 'Zurich', skills: 'AWS EKS, Terraform, Datadog',
          bullets: ['Ran 400 microservices on Kubernetes (AWS EKS)', 'Cut incident time by 40 percent with Datadog and OpenTelemetry', 'Built the Terraform platform used by 120 engineers', 'Led the on-call rotation of 8 people']}]},
          {company: 'Beta Systems', roles: [{title: 'Platform Engineer', period: '2018 – 2022', place: 'Berlin', bullets: ['Migrated 60 services to Kubernetes', 'Introduced SLOs and error budgets']}]}]};
      const text = cvText(cv).toLowerCase();
      const TERMS = persona?.cvMatch?.terms ?? ['kubernetes', 'terraform', 'aws', 'datadog', 'opentelemetry', 'slos'];
      let expected = 0, got = 0, corrected = 0;
      for (const item of postings.filter(entry => entry.fit === 'high').slice(0, 3)) {
        const result = await check({}, ctx.key, {job: item, cv, client: modelClient({key: ctx.judgeKey})});   // through lib/model.mjs either way: Claude Code on a Mac, the API in CI (counted for /ai-cost)
        corrected += result.corrected;
        for (const term of TERMS.filter(candidateTerm => text.includes(candidateTerm) && item.description.toLowerCase().includes(candidateTerm))) {
          expected++;
          if (result.musts.some(must => must.term.toLowerCase().includes(term) && must.status === 'found')) got++;
        }
        // The product's rule (match-check.js guard): "found" needs the term OR the model's quoted evidence in the CV ("Kubernetes on AWS", evidence "Kubernetes (AWS EKS)": run 37136327455).
        const words = value => ` ${String(value || '').toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
        const stated = phrase => words(phrase).trim().length >= 2 && words(text).includes(words(phrase));
        for (const must of result.musts) if (must.status === 'found' && !stated(must.term) && !stated(must.evidence)) throw new Error(`"${item.title}": "${must.term}" is marked found, but the CV states neither it nor its evidence ("${must.evidence || ''}")`);
      }
      console.log(`  CV match: ${got}/${expected} required terms found, ${corrected} claim(s) corrected by the guard`);
      if (expected && got / expected < 0.7) throw new Error(`only ${got} of ${expected} terms that the posting and the CV both state came back as found`);
      if (corrected > 4) throw new Error(`the guard had to correct ${corrected} claims about the CV on three postings (at most 4)`);
    }, {needs: ctx.needs, limitMs: 3 * STEP}));

    // On main the gate replays only (E2E_AI_STRICT): a question with no recorded answer was asked live, so its answer tested the AI, not the code.
    await soft(() => ctx.run('the gate asked the AI nothing new: every answer was a recorded one', async () => {
      if (!process.env.E2E_ARTIFACTS) throw new Error('no artifacts folder (E2E_ARTIFACTS): the misses cannot be read, so this check would pass blind');
      const missed = missedQuestions();
      if (missed.length) throw new Error(`${missed.length} AI question(s) had no recorded answer (asked live, not kept): ${missed.slice(0, 6).map(item => `${item.url} "${item.about.slice(0, 60)}"`).join('; ')}. `
        + 'The merged PR\'s green quality run records them (pr-answers.mjs); one that differs on every run never replays (its ai-misses/ show the field)');
    }, {needs: [{name: 'a main run that replays only (E2E_AI_STRICT=1)', value: strict()}]}));

    if (late.length) throw new Error(`${late.length} quality check(s) failed: ${late.map(error => error.message.split('\n')[0].slice(0, 120)).join(' | ')}`);
  } finally {   // the one-line summary is printed whatever failed
    const line = `quality: ${summary.facts.exact}/${summary.facts.total} facts exact, ranking ${summary.ranking}, ${summary.invented} invented facts, scores stable ${summary.stable}`;
    console.log(`\n${line}\n`);
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'quality-summary.txt'), line + '\n');
  }
}
