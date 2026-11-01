// Shared golden-posting setup and Jobs checks for exact and live quality journeys.
/* global window */
// Job: run the backbone
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {quiet, runsData} from './activity-steps.mjs';
import {ensureSetUp} from './seed.mjs';
import {clearData} from './start-state.mjs';
import {rewriteTextLines, textOf} from './seed-texts.mjs';
import {MATCHES, matchRowsOf} from './quality-rows.mjs';
import {capViolations, checkFacts, fingerprints, leaks, matchRows, normalizeUrl, rankingViolations, workLeft} from './quality.mjs';
import {withRoles} from './search-roles.mjs';
import {qualityClocks, qualityEvidence, waitForQualityState} from './quality-waits.mjs';

// E2E_QUALITY_PERSONA=photographer runs the same checks for a fictional commercial photographer in Zurich (fixtures/golden-photographer: her CV, her Profile, 12 postings with a
// known truth, and her CV for the CV-match step), so scoring, ranking, facts and the judge are proven for a profession that is not IT. Default: the SRE.
const PERSONA = process.env.E2E_QUALITY_PERSONA || '';
const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', PERSONA ? `golden-${PERSONA}` : 'golden');
const persona = PERSONA ? JSON.parse(fs.readFileSync(path.join(GOLDEN, 'persona.json'), 'utf8')) : null;
const read = file => JSON.parse(fs.readFileSync(path.join(GOLDEN, file), 'utf8'));

/** Shared schedule and model inputs; budgetMinutes/minutes remain the live qualityai allowances only. */
export const PLANNER = Object.freeze({
  cadence: 'nightly', budgetMinutes: 10, minutes: 24,
  // It judges the AI's answers (scores, facts), which are the same on every OS: the Mac lane only, no Windows run (owner, 7 Oct 2026: $1.36 a day on Windows).
  sameOnEveryOs: true,
  judges: Object.freeze(['src/ai/']),
  watches: Object.freeze(['src/ai/score.py', 'src/ai/score_bands.py', 'src/ai/enrich.py', 'src/ai/hints.py', 'desktop/lib/pipeline.js', 'desktop/lib/question-reuse.js', 'desktop/lib/match-check.js', 'desktop/e2e/fixtures/golden/']),
  // This suite measures what a user gets, so the app under test runs on the shipped model (about $0.3 a run); the other suites run on Haiku. For a cheap run:
  // E2E_APP_MODEL=claude-haiku-4-5 (Haiku 4.5 scored the same job up to 10 points apart between two scorings, Sonnet within 6).
  env: Object.freeze({JOB_PILOTTO_MODEL_OVERRIDE: process.env.E2E_APP_MODEL || 'claude-sonnet-5-5',
    // The engine reads the persona's Profile instead of the test page's Profile.
    ...(PERSONA ? {JOB_PILOTTO_E2E_PROFILE_FILE: path.join(GOLDEN, 'profile.md')} : {})}),
});

/** Collect checked facts without policy: required missing jobs add diagnostics and missed facts, optional drops add neither. */
export function collectFacts({truth, postings, rows}) {
  const {byId} = matchRows(truth, rows);
  const problems = [];
  let exact = 0, total = 0, missed = 0;
  for (const item of postings) {
    const found = byId[item.id];
    if (!found) {
      if (!item.filterMayDrop) { problems.push(`"${item.title}" is missing from Notion`); missed += checkFacts(item, {props: {}}).length; }
      continue;
    }
    for (const result of checkFacts(item, found[0])) {
      total++;
      if (result.ok) exact++; else problems.push(`"${result.posting}": ${result.fact} should be ${JSON.stringify(result.expected)}, the app wrote ${JSON.stringify(result.actual)}`);
    }
  }
  return {exact, total, problems, missed};
}

/** Check score range and ranking first; report ranking before failure, then let each suite handle caps. */
export function rankingCheck(journey, {onRanking, onCap}) {
  const {truth, postings, rows, scoresOf} = journey;
  const scores = scoresOf();
  const outside = rows.filter(row => !(Number.isInteger(row.props.Score) && row.props.Score >= 0 && row.props.Score <= 100));
  if (outside.length) throw new Error(`a score is not a whole number from 0 to 100: ${outside.map(row => `${row.props.Job} = ${row.props.Score}`).join(', ')}`);
  const high = postings.filter(item => item.fit === 'high');
  const missing = high.filter(item => scores[item.id] == null);
  if (missing.length) throw new Error(`relevant job(s) were not scored: ${missing.map(item => item.title).join(', ')}`);
  const violations = rankingViolations(truth, scores);
  onRanking(violations.length ? `${violations.length} violation(s)` : 'ok');
  console.log(`  scores: ${postings.map(item => `${item.id}=${scores[item.id] ?? 'dropped'}`).join(' ')}`);
  if (violations.length) throw new Error(violations.map(v => `"${v.low}" (${v.lowScore}) is not below "${v.high}" (${v.highScore})`).join('; '));
  const over = capViolations(truth, scores), said = over.map(v => `"${v.title}" scored ${v.score}, above its cap ${v.cap}`).join('; ');
  onCap(over, said);
}

/** Find missing rows and unequal scores; the strict reader and final assertion share this exact comparison. */
export function jobListDifferences(rows, jobs = []) {
  return rows.flatMap(row => {
    const job = jobs.find(item => normalizeUrl(item.url) === normalizeUrl(row.props['Job URL']));
    return !job || Number(job.fit) !== row.props.Score ? [{row, job}] : [];
  });
}

/** Build one isolated journey; strict reads require complete store and Jobs-page rows, live reads keep partial results. */
export function qualityJourney(ctx, {strict = false, wait = {}} = {}) {
  const {page} = ctx;
  const backbone = ctx.suite === 'quality';
  // Why (30 Oct 2026, qu): quality RECORD and qualityai call live AI; only stored-answer quality uses measured calm-run caps.
  const clocks = qualityClocks(backbone);
  const state = async (readState, ready, label, capMs = clocks.stateMs, evidence = () => qualityEvidence(ctx)) => {
    let last;
    const previous = ctx.qualityWaitEvidence;
    // The enclosing step/suite cap may fire first: keep this phase's latest evidence available to it too.
    ctx.qualityWaitEvidence = () => evidence(last);
    try {
      return await waitForQualityState(async () => (last = await readState()), ready, {label, capMs, evidence, ...wait});
    } finally { ctx.qualityWaitEvidence = previous; }
  };
  const jobsStateMs = backbone ? clocks.jobsMs : clocks.stateMs;
  const truth = process.env.E2E_QUALITY_TRUTH ? JSON.parse(fs.readFileSync(process.env.E2E_QUALITY_TRUTH, 'utf8')) : read('truth.json');   // a different truth: to prove the suite fails
  const candidate = fs.readFileSync(path.join(GOLDEN, 'candidate.txt'), 'utf8');
  const postings = truth.filter(item => !item.duplicateOf);
  let rows = [], appJobs = [];
  const setUp = async () => {
    await ensureSetUp(ctx, {readyMs: backbone ? clocks.stateMs : 60000});
    // Why (29 Oct 2026, qu 3/4): history-loaded, no running/queued work and no start-up work is the observable reset boundary; no settling sleep.
    if (!ctx.built) await ctx.run('the first search after the setup has ended', () => backbone
      ? state(() => runsData(page), data => !data.running && !data.queued.length && data.historyLoaded && !data.busy.length,
        'the first search after the setup', clocks.stateMs, data => `${JSON.stringify(data)}\n${qualityEvidence(ctx)}`)
      : quiet(ctx, {forMs: 3000, maxMs: 300000}), {needs: ctx.needs, critical: true});
  };
  const check = async label => {
    await page.click('.nav[data-view="jobs"]');
    // Why (29 Oct 2026, qu 3/4): setup and earlier refreshes can still appear in Recent runs; only an ID added by this refresh can satisfy it.
    const before = new Set((await runsData(page)).runs.map(run => run.id));
    await page.click('#refresh');
    const fresh = data => data.runs.filter(run => !before.has(run.id) && run.kind === 'search' && run.trigger !== 'schedule');
    const evidence = data => `${JSON.stringify({running: data?.running, queued: data?.queued, runs: data?.runs.map(({id, kind, ok}) => ({id, kind, ok}))})}\n${qualityEvidence(ctx)}`;
    await state(() => runsData(page), data => !!data.running || fresh(data).length > 0,
      `${label} start`, jobsStateMs, evidence);
    const ended = await state(() => runsData(page), data => !data.running && !data.queued.length && fresh(data).length > 0,
      label, backbone ? clocks.jobsMs : 420000, evidence);
    const engineLog = path.join(ctx.profile, 'logs', 'engine.log');
    if (fs.existsSync(engineLog)) fs.copyFileSync(engineLog, path.join(ctx.ARTIFACTS, `quality-engine-${label.split(' ')[0]}.log`));
    const newest = fresh(ended)[0];
    if (newest.ok === false) throw new Error(`the ${label} ended as failed: ${newest.result || '(no result text)'}\n${qualityEvidence(ctx)}`);
    // read2 observes the committed rows; task completion needs no fixed delay.
  };
  const storeDiagnostics = () => {
    const config = path.join(ctx.profile, 'config');
    const text = file => fs.existsSync(path.join(config, file)) ? fs.readFileSync(path.join(config, file), 'utf8').replace(/\s+/g, ' ') : 'missing';
    return `profile config: ${fs.existsSync(config) ? fs.readdirSync(config).join(', ') : 'none'}; sources.json: ${text('sources.json')}; feed folder: ${ctx.feeds && fs.existsSync(ctx.feeds) ? fs.readdirSync(ctx.feeds).join(', ') : 'none'}; search.json: ${text('search.json').slice(0, 700)}`;
  };
  const read2 = async () => {
    const required = postings.filter(item => !item.filterMayDrop);
    const missing = (candidateRows = []) => {
      const {byId} = matchRows(truth, candidateRows);
      return required.filter(item => !byId[item.id]);
    };
    // Why (30 Oct 2026, qu; #2501 review): exact quality requires all postings; qualityai still keeps partial rows at the shared live state allowance.
    let partial = [];
    const complete = await state(async () => (partial = await matchRowsOf(ctx)), candidateRows => strict
      ? missing(candidateRows).length === 0 : Object.keys(matchRows(truth, candidateRows).byId).length >= required.length,
      'the required postings reaching the store', strict ? jobsStateMs : clocks.stateMs, candidateRows => {
        const absent = missing(candidateRows);
        return `${required.length - absent.length} of ${required.length} required postings reached the store; missing: ${absent.map(item => `${item.id} "${item.title}" (${item.url})`).join(', ')}\n${strict ? storeDiagnostics() + '\n' : ''}${qualityEvidence(ctx)}`;
      }).catch(error => {
        if (strict || error.name !== 'QualityHangError') throw error;
        return partial;
      });
    rows = complete;
    const readAppJobs = () => page.evaluate(() => (window.__jp.shared.allJobs || []).map(job => ({title: job.title, url: job.url, fit: job.fit, reason: job.reason})));
    // Why (30 Oct 2026, qu-fit; run 40987027036): URLs can precede scores during startSearch's asynchronous reload; exact quality waits for the assertion's state, qualityai reads once.
    appJobs = strict ? await state(readAppJobs,
      jobs => jobListDifferences(complete, jobs).length === 0,
      'the Jobs page showing the stored postings and scores', jobsStateMs, jobs => {
        const differences = jobListDifferences(complete, jobs).map(({row, job}) => `${row.props.Job} store ${row.props.Score} page ${job ? job.fit : '(missing)'}`);
        return `store rows=${complete.length}, Jobs page rows=${jobs?.length ?? 0}\nJobs page rows with a score other than the store's: ${differences.join('; ')}\n${qualityEvidence(ctx)}`;
      }) : await readAppJobs();
  };
  // SQLite gets a fresh profile per attempt (app.mjs launch); reset asserts its matches empty below. Thus list[0] cannot select an earlier attempt's match.
  const scoresOf = () => Object.fromEntries(Object.entries(matchRows(truth, rows).byId).map(([id, list]) => [id, list[0].props.Score]));

  const reset = async () => {
    await ctx.run('this suite starts with no jobs and no runs in its Notion page', async () => {
      if (backbone) {
        // Why (29 Oct 2026, qu 3/4, #2501 review): startup may leave run history; assert only empty matches, preserve history and let check() exclude pre-refresh run IDs.
        const held = await ctx.data('matches', 'list', {});
        if (held.length) throw Object.assign(new Error(`quality reset: store holds ${held.length} matches row(s); expected no matches`), {name: 'QualityStartStateError'});
      } else { await clearData(ctx, MATCHES); await clearData(ctx, 'Cronjob Runs'); }
      // The candidate's compensation is known, not whatever the wizard's AI drafted from the CV ("CHF 180,000 (estimate)"): target 170k, minimum 140k.
    if (!persona) {   // a persona states its own compensation in its Profile file
    // The Profile through the store the app uses (this Mac's profile.md or Notion's Profile page).
    const set = [await rewriteTextLines(ctx, 'profile', /^\s*(?:[-*]\s*)?(?:\*\*)?Target:/, 'Target: CHF 170,000 per year in Switzerland'),
      await rewriteTextLines(ctx, 'profile', /^\s*(?:[-*]\s*)?(?:\*\*)?Minimum acceptable:/, 'Minimum acceptable: CHF 140,000 per year in Switzerland')];
    if (set.some(count => count !== 1)) {   // Why (#2759, 1 Nov 2026, a8): "found 0 and 1" could not tell a blank template from an AI draft with no Target line; the page's size and first lines can.
      const held = (await textOf(ctx, 'profile')) || '';
      throw new Error(`the Profile should have one Target line and one Minimum acceptable line, found ${set.join(' and ')}; it holds ${held.length} characters, ${held.split('\n').filter(line => line.trim()).length} non-empty lines: ${JSON.stringify(held.split('\n').filter(line => line.trim()).slice(0, 6))}`);
    }
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
  };
  const jobs = async () => {
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
        throw new Error(`no Job Matches row was in ${ctx.store === 'sqlite' ? 'this Mac\'s store (matches.list)' : 'Notion'} after the 90 s read allowance (app's Notion: ${JSON.stringify(await page.evaluate(() => { const n = window.__jp?.shared?.state?.notion; return n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).filter(([, v]) => typeof v === 'string' && /[0-9a-f]{8}-/.test(v)).map(([k, v]) => [k, v.slice(0, 13)])) : String(n); }))}; ${storeDiagnostics()})`);
      } }, {needs: ctx.needs, limitMs: clocks.jobsMs});
  };
  const privacyLogs = () => ctx.run('no job text, CV text or secret reached the logs', async () => {
    const logs = path.join(ctx.profile, 'logs');
    const text = fs.existsSync(logs) ? fs.readdirSync(logs).filter(file => file.endsWith('.log')).map(file => fs.readFileSync(path.join(logs, file), 'utf8')).join('\n') : '';
    if (text.length < 200) throw new Error('the logs are empty: there is nothing to check');
    const needles = [...postings.flatMap(item => fingerprints(item.description)), ...fingerprints(candidate), persona?.email || 'alex.example@example.test', ctx.appKey, ctx.token];
    const found = leaks(text, needles.filter(Boolean));
    if (found.length) throw new Error(`${found.length} piece(s) of private data are in the logs: ${found.map(needle => needle === ctx.appKey || needle === ctx.token ? '(a secret)' : `"${needle.slice(0, 40)}"`).join(', ')}`);
  }, {needs: ctx.needs});
  return {truth, postings, persona, GOLDEN, read, setUp, reset, jobs, check, read2, scoresOf, privacyLogs,
    get rows() { return rows; }, get appJobs() { return appJobs; }};
}
