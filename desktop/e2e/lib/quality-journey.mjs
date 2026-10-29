// Shared golden-posting setup and Jobs checks for exact and live quality journeys.
/* global window */
// Job: run the backbone
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sample, watch} from './activity.mjs';
import {quiet} from './activity-steps.mjs';
import {ensureSetUp} from './seed.mjs';
import {clearData} from './start-state.mjs';
import {rewriteTextLines} from './seed-texts.mjs';
import {MATCHES, matchRowsOf} from './quality-rows.mjs';
import {fingerprints, leaks, matchRows, workLeft} from './quality.mjs';
import {withRoles} from './search-roles.mjs';

const STEP = 60000;
// E2E_QUALITY_PERSONA=photographer runs the same checks for a fictional commercial photographer in Zurich (fixtures/golden-photographer: her CV, her Profile, 12 postings with a
// known truth, and her CV for the CV-match step), so scoring, ranking, facts and the judge are proven for a profession that is not IT. Default: the SRE.
const PERSONA = process.env.E2E_QUALITY_PERSONA || '';
const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', PERSONA ? `golden-${PERSONA}` : 'golden');
const persona = PERSONA ? JSON.parse(fs.readFileSync(path.join(GOLDEN, 'persona.json'), 'utf8')) : null;
const read = file => JSON.parse(fs.readFileSync(path.join(GOLDEN, file), 'utf8'));

/** Build one isolated journey; rows and appJobs always reflect its latest read2(). */
export function qualityJourney(ctx) {
  const {page} = ctx;
  const truth = process.env.E2E_QUALITY_TRUTH ? JSON.parse(fs.readFileSync(process.env.E2E_QUALITY_TRUTH, 'utf8')) : read('truth.json');   // a different truth: to prove the suite fails
  const candidate = fs.readFileSync(path.join(GOLDEN, 'candidate.txt'), 'utf8');
  const postings = truth.filter(item => !item.duplicateOf);
  let rows = [], appJobs = [];
  const setUp = async () => {
    await ensureSetUp(ctx);
    // Why (29 Oct 2026, a8): a search the setup started must end before the Jobs checks read the postings; quiet() returns after 3 s when none runs.
    if (!ctx.built) await ctx.run('the first search after the setup has ended', () => quiet(ctx, {forMs: 3000, maxMs: 300000}), {needs: ctx.needs, critical: true});
  };
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

  const reset = async () => {
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
        const config = path.join(ctx.profile, 'config');
        throw new Error(`no Job Matches row was in ${ctx.store === 'sqlite' ? 'this Mac\'s store (matches.list)' : 'Notion'} a minute after the check (app's Notion: ${JSON.stringify(await page.evaluate(() => { const n = window.__jp?.shared?.state?.notion; return n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).filter(([, v]) => typeof v === 'string' && /[0-9a-f]{8}-/.test(v)).map(([k, v]) => [k, v.slice(0, 13)])) : String(n); }))}; profile config: ${fs.existsSync(config) ? fs.readdirSync(config).join(', ') : 'none'}; sources.json: ${fs.existsSync(path.join(config, 'sources.json')) ? fs.readFileSync(path.join(config, 'sources.json'), 'utf8').replace(/\s+/g, ' ') : 'missing'}; feed folder: ${fs.readdirSync(ctx.feeds).join(', ')}; search.json: ${fs.readFileSync(path.join(config, 'search.json'), 'utf8').replace(/\s+/g, ' ').slice(0, 700)})`);
      } }, {needs: ctx.needs, limitMs: 6 * STEP});
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
