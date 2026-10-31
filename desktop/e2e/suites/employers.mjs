/* global window */
// Find new employers + the Employers & Sources data. A candidate list with every kind of company (two good boards, an empty one, one with only wrong roles, a dead
// feed, a duplicate of a source already in use, an excluded company, a manual-watch company) is run from the Actions page; then what the scout decided, what it wrote
// into Notion and into its run row, what a second run does, what the crawl would now read, and a Sonnet judge on whether the added employers suit the person.
import {execFileSync} from 'node:child_process';
import {python, pythonEnv} from '../lib/python.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {E2E} from '../lib/app.mjs';
import {collect, judge as fitJudge, toFindings as fitFindings} from '../lib/fit.mjs';
import {duplicates, EXPECTED, parseRunLine, rowProblems} from '../lib/employers.mjs';
import {judge, problems as judgeProblems} from '../lib/judge.mjs';
import {finish, visit} from '../lib/layout.mjs';
import {clearData} from '../lib/start-state.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {withRoles} from '../lib/search-roles.mjs';
import {appLogLines} from '../lib/app-log.mjs';

// Saved answers own every gate judgment; the real-model guard catches an escape.
export const offlineAi = true;
export const realAi = false;
export const aiAnswers = 'backbone';
export const minutes = 15;
export const name = 'employers';
// The scout judges feeds for this person whatever the test workspace's search settings hold (src/paths.py: JOB_PILOTTO_LOCATIONS_FILE).
// E2E_EMPLOYERS_PERSONA=nurse runs the same suite for a band 6 nurse in Manchester: fixtures/feeds/employers-nurse/ replaces the SRE boards of the same names, so every
// expectation holds with another profession (the scout, its Notion rows and the judge are not for engineers only). Default: the SRE in Zurich.
const PERSONAS = {
  sre: {dir: 'employers', city: /zurich/i, elsewhere: /lisbon/i, cityName: 'Zurich', person: 'A fictional senior site reliability / platform engineer in Zurich, Switzerland (Kubernetes, AWS, Terraform), looking for SRE, platform and DevOps roles in Zurich or elsewhere in Switzerland.'},
  nurse: {dir: 'employers-nurse', city: /manchester/i, elsewhere: /sydney/i, cityName: 'Manchester', person: 'A fictional band 6 registered nurse in Manchester, UK (acute medicine, BLS and ILS, cannulation, NEWS2), looking for registered nurse, staff nurse, charge nurse and ward sister roles in Manchester, Salford or elsewhere in the UK.'},
};
export const persona = PERSONAS[process.env.E2E_EMPLOYERS_PERSONA || 'sre'];
if (!persona) throw new Error(`E2E_EMPLOYERS_PERSONA must be one of ${Object.keys(PERSONAS).join(', ')}`);
export const env = {JOB_PILOTTO_LOCATIONS_FILE: path.join(E2E, 'fixtures', 'feeds', persona.dir, 'person.json')};
const PERSON = persona.person;
// "quality" is the scout's 0-100 score of a whole feed (relevance, freshness, location, stack): a feed with older postings or a few off-target roles scores in the 30s-50s and is
// still a sensible employer to follow. The judge must not read a middling score as a contradiction with "stack overlap" or "in preferred places", which describe single postings.
const QUALITY_NOTE = 'Note: "quality" is a 0-100 score of the whole job feed, also lowered by stale postings or a few unrelated roles, so a middling score next to a good stack or place match is normal; judge only whether following this employer suits the person.';
// What each count means (src/scout_probe.py quality): a posting outside the person's roles counts in neither number, and "cities" are those of the relevant roles in
// preferred places. 9 Oct 2026 (CI run 37978637897): without this the judge read Orbit's 3 postings, 2 relevant, 1 of them in Zurich, "cities: Zurich" (its non-relevant
// Product Designer is in Zurich too) as contradicting facts. The bar is said too: on a later run the judge called Orbit "coherent but weaker" (one relevant role in Zurich) and still
// said no; the suite expects every board with a relevant role in the person's places to be added (EXPECTED: Orbit found, active).
const FIELDS_NOTE = 'Fields: "postings" in "why" counts every posting on the board; "relevantRoles" counts only those matching the person\'s roles; "relevantRolesInPreferredPlaces" counts the relevant ones that are also in the person\'s places (a subset of relevantRoles); "citiesOfThose" lists the cities of exactly those relevant roles in preferred places. A posting outside the person\'s roles is counted in neither number, wherever it is. The bar: an employer with at least one relevant role in the person\'s places is worth following (fewer roles make it weaker, not wrong); answer no only when following it would not suit the person.';
const ROOT = path.resolve(E2E, '..', '..');

const find = dir => {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const hit = find(full); if (hit) return hit; } else if (entry.name === 'jobs.sqlite') return full;
  }
  return null;
};

// What the scout decided (its candidate table), the feeds it registered, and the list the jobs crawl would read (the engine's own active_sources: starter list + registered feeds).
function engineState(ctx) {
  const db = find(ctx.profile);
  if (!db) throw new Error('the app has no jobs.sqlite in its data folder');
  const script = `import json, sqlite3, sys
from src import scout, store
path, starter = sys.argv[1], json.load(open(sys.argv[2]))
c = sqlite3.connect(path); c.row_factory = sqlite3.Row
rows = lambda q: [dict(r) for r in c.execute(q)]
with store.connect(__import__('pathlib').Path(path)) as db:
    crawl = [s['company'] for s in scout.active_sources(db, None, starter)]
print(json.dumps({'candidates': rows('select name, status, ats, slug, quality from scout_candidates'), 'registered': rows('select ats, slug, company, quality, active from feed_sources'), 'crawl': crawl}))`;
  const out = execFileSync(python(), ['-c', script, db, path.join(ctx.profile, 'config', 'sources.json')],
    {cwd: ROOT, env: pythonEnv({...env, JOB_PILOTTO_FIXTURE_DIR: ctx.feeds}, {home: ctx.profile})});   // isolated, UTF-8 (lib/python.mjs)
  return JSON.parse(out.toString());
}

const scoutStarts = ctx => appLogLines(ctx.profile).filter(line => /\[run\] start: python -m src scout /.test(line)).length;

// Start the employer finder (the scout) and wait until the app shows no task running. -> the scout runs the app lists for it (newest first).
async function findEmployers(ctx) {
  const {page} = ctx;
  const scouts = () => page.evaluate(async () => {
    const data = await window.pilot.runs();
    return {running: !!data.running || (data.queued || []).length > 0,
      runs: (data.runs || []).filter(item => item.kind === 'scout').map(item => ({ok: item.ok, trigger: item.trigger, result: item.result || item.summary || ''}))};
  });
  // A fresh install starts its own catch-up checks (Gmail) a few seconds after launch: begin when the app has been quiet for a while, so only this click is counted.
  for (let quietSince = Date.now(); Date.now() - quietSince < 25000;) {
    if ((await scouts()).running) quietSince = Date.now();
    await page.waitForTimeout(2000);
  }
  const before = (await scouts()).runs.length, startsBefore = scoutStarts(ctx);
  await page.evaluate(() => window.pilot.command('scout'));   // the finder alone: Find jobs runs it as its last step, and Always on / the schedule start it by itself; the Actions card was merged into Find jobs (16 Oct 2026)
  const started = Date.now();
  let now;
  for (;;) {
    now = await scouts();
    if (!now.running && now.runs.length > before) break;
    if (Date.now() - started > 240000) throw new Error('Find new employers did not finish within 4 minutes');
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(6000);   // a second run that was only waiting its turn would start now
  now = await scouts();
  while (now.running && Date.now() - started < 240000) { await page.waitForTimeout(2000); now = await scouts(); }
  const engineRuns = scoutStarts(ctx) - startsBefore;
  if (engineRuns !== 1) throw new Error(`one click started ${engineRuns} Find new employers runs (the app's own log shows ${engineRuns} engine starts)`);
  return now.runs.slice(0, now.runs.length - before);
}

// The scout's rows in the store's run list (cron_runs: this Mac's or Notion's ⏱️ Search runs), oldest first, as numbers.
async function storeRuns(ctx) {
  const rows = ((await ctx.data('cron_runs', 'list', {})) || []).filter(row => row.mode === 'scout');
  return rows.sort((a, b) => String(a.started_at).localeCompare(String(b.started_at))).map(row => ({row, line: parseRunLine(row.summary)}));
}
// Every employer the store holds, active or not.
const employers = ctx => ctx.data('employers', 'list', {active: null});

export async function run(ctx) {
  ctx.findings = [];
  ctx.audience = persona.dir === 'employers' ? undefined : 'non-it';   // the UI Finder checks that the app's tips and insights suit a candidate who is not in IT
  await ensureSetUp(ctx);
  const state = {};

  await ctx.run('this suite starts with no employers and no runs in its Notion page, and a candidate list of every kind', async () => {
    const cleared = [await clearData(ctx, 'Employers & Sources'), await clearData(ctx, 'Cronjob Runs')];
    console.log(`  cleared ${cleared[0]} employer row(s) and ${cleared[1]} run row(s)`);
    // Nimbus' postings are three days old whenever the suite runs (freshness is part of the quality score); Orbit's stay old on purpose.
    if (persona.dir !== 'employers') {   // the persona's boards replace the SRE ones of the same names
      for (const file of fs.readdirSync(path.join(E2E, 'fixtures', 'feeds', persona.dir)).filter(name => name !== 'person.json')) fs.copyFileSync(path.join(E2E, 'fixtures', 'feeds', persona.dir, file), path.join(ctx.feeds, 'employers', file));
    }
    const nimbusFile = path.join(ctx.feeds, 'employers', 'nimbus.json');
    const nimbus = JSON.parse(fs.readFileSync(nimbusFile, 'utf8'));
    for (const job of nimbus.jobs) job.updated_at = new Date(Date.now() - 3 * 86400000).toISOString();
    fs.writeFileSync(nimbusFile, JSON.stringify(nimbus));
    fs.mkdirSync(path.join(ctx.profile, 'config'), {recursive: true});
    fs.copyFileSync(path.join(ctx.E2E, 'fixtures', 'feeds', 'sources.json'), path.join(ctx.profile, 'config', 'sources.json'));   // E2E Acme and E2E Beta are already sources
    fs.copyFileSync(path.join(ctx.E2E, 'fixtures', 'feeds', 'employers', 'scout_seeds.json'), path.join(ctx.profile, 'config', 'scout_seeds.json'));
  }, {needs: ctx.needs});

  await ctx.run('one click on Find new employers is one run, and it ends', async () => {
    state.runs = await findEmployers(ctx);
    console.log(`  runs started by one click: ${JSON.stringify(state.runs)}`);
    const failed = state.runs.filter(item => item.ok === false);
    if (failed.length) throw new Error(`the run failed: ${failed[0].result}`);
    if (state.runs.length !== 1) throw new Error(`the app lists ${state.runs.length} Find new employers runs for one click: ${JSON.stringify(state.runs)}`);
    state.first = engineState(ctx);
  }, {needs: ctx.needs});

  await ctx.run('each candidate ends in the right status, and only genuinely useful boards become sources', async () => {
    const {candidates, registered} = state.first;
    const status = Object.fromEntries(candidates.map(item => [item.name, item]));
    const problems = [];
    for (const [company, want] of Object.entries(EXPECTED)) {
      const got = status[company];
      if (want.status === 'excluded') { if (got) problems.push(`${company} is excluded but the scout kept it as a candidate (${got.status})`); continue; }
      if (!got) { problems.push(`${company} was never a candidate`); continue; }
      // The scout stores a duplicate as 'found' (it is a feed already in use), and tells it apart by not registering it again.
      const shown = want.status === 'duplicate' ? 'found' : want.status;
      if (got.status !== shown) problems.push(`${company}: status ${got.status}, expected ${want.status}`);
    }
    const sources = registered.map(item => item.company).sort();
    const wanted = Object.entries(EXPECTED).filter(([, want]) => want.status === 'found').map(([company]) => company).sort();
    if (JSON.stringify(sources) !== JSON.stringify(wanted)) problems.push(`registered sources are [${sources}], expected [${wanted}]${sources.includes('E2E Acme Labs') ? ' (E2E Acme Labs is the same board as the starter source E2E Acme)' : ''}`);
    if (problems.length) throw new Error(problems.join('; '));
    const [nimbus, orbit] = ['E2E Nimbus', 'E2E Orbit'].map(company => status[company].quality);
    console.log(`  quality: Nimbus ${nimbus}, Orbit ${orbit}`);
    if (!(nimbus > orbit)) throw new Error(`the board with 4 fresh roles in ${persona.cityName} (${nimbus}) must outscore the one with 1 old role there (${orbit})`);
    if (nimbus - orbit < 20) throw new Error(`quality barely tells a strong board (${nimbus}) from a weak one (${orbit})`);
  }, {needs: ctx.needs});

  await ctx.run('Employers & Sources in Notion holds a complete, sensible row per candidate, and none for the duplicate or the excluded', async () => {
    state.rows = await employers(ctx);
    const byName = Object.fromEntries(state.rows.map(row => [row.name, row]));
    const problems = [];
    for (const [company, want] of Object.entries(EXPECTED)) {
      const row = byName[company];
      if (want.feed == null) { if (row) problems.push(`${company} must not have a row (${want.status}), it has one: ${row.feed_status}`); continue; }
      if (!row) { problems.push(`${company} has no row in Employers & Sources`); continue; }
      problems.push(...rowProblems(row, want.status));
      if (row.feed_status !== want.feed) problems.push(`${company}: Feed status "${row.feed_status}", expected "${want.feed}"`);
      if (row.active !== want.active) problems.push(`${company}: Active is ${row.active}, expected ${want.active}`);
    }
    // The numbers in a row come from the fixture boards: Nimbus has 5 postings, 4 of them relevant, all 4 in the person's city; Orbit 3, 2 and 1.
    const nimbus = byName['E2E Nimbus'], orbit = byName['E2E Orbit'];
    if (nimbus && !(nimbus.ats === 'greenhouse' && nimbus.slug === 'e2e-nimbus' && nimbus.relevant_roles === 4 && nimbus.in_preferred_places === 4 && persona.city.test(nimbus.cities) && /5 postings; 4 matching; 4 in preferred places/.test(nimbus.notes))) problems.push(`E2E Nimbus' row does not match its board: ${JSON.stringify({ats: nimbus.ats, slug: nimbus.slug, relevant: nimbus.relevant_roles, preferred: nimbus.in_preferred_places, cities: nimbus.cities, notes: nimbus.notes})}`);
    if (orbit && !(orbit.relevant_roles === 2 && orbit.in_preferred_places === 1 && persona.city.test(orbit.cities) && !persona.elsewhere.test(orbit.cities))) problems.push(`E2E Orbit's row does not match its board (2 relevant, 1 in ${persona.cityName}, none elsewhere): ${JSON.stringify({relevant: orbit.relevant_roles, preferred: orbit.in_preferred_places, cities: orbit.cities})}`);
    if (nimbus && orbit && !(nimbus.quality > orbit.quality)) problems.push(`Notion's quality does not order the boards: Nimbus ${nimbus.quality}, Orbit ${orbit.quality}`);
    if (byName['E2E Quiet'] && !/quiet\.e2e\.test/.test(byName['E2E Quiet'].careers_url || '')) problems.push(`E2E Quiet's Careers link is "${byName['E2E Quiet'].careers_url}"`);
    if (problems.length) throw new Error(problems.join('; '));
  }, {needs: ctx.needs});

  await ctx.run("the run's row says what happened, and the numbers are the real ones", async () => {
    const runs = await storeRuns(ctx);
    console.log(`  run rows: ${runs.map(item => item.row.summary).join(' | ')}`);
    if (!runs.length) throw new Error('Find new employers left no row in the Notion run list');
    const {line, row} = runs[0];
    if (!line) throw new Error(`the run row says "${row.summary}": no "checked N" and no "N new sources"`);
    const registered = state.first.registered.length;
    if (line.checked !== state.first.candidates.length) throw new Error(`the row says checked ${line.checked}, the scout checked ${state.first.candidates.length}`);
    if (line.added !== registered) throw new Error(`the row says ${line.added} new sources, the scout registered ${registered}`);
    const shown = state.runs[0].result;
    const app = parseRunLine(shown);
    if (!app || app.checked !== line.checked || app.added !== line.added) throw new Error(`the app's Recent runs says "${shown}", Notion says "${row.summary}"`);
  }, {needs: ctx.needs});

  await ctx.run("the crawl's source list now holds the starter employers and the two new boards, and nothing else", async () => {
    const crawl = [...state.first.crawl].sort();
    const wanted = ['E2E Acme', 'E2E Beta', 'E2E Nimbus', 'E2E Orbit'];
    if (JSON.stringify(crawl) !== JSON.stringify(wanted)) throw new Error(`the crawl would read [${crawl}], expected [${wanted}]`);
  }, {needs: ctx.needs});

  await ctx.run('a second run writes nothing twice', async () => {
    const rowsBefore = (await employers(ctx)).length;
    state.second = await findEmployers(ctx);
    console.log(`  second run: ${JSON.stringify(state.second)}`);
    if (state.second.length !== 1 || state.second[0].ok === false) throw new Error(`the second click gave ${state.second.length} run(s): ${JSON.stringify(state.second)}`);
    const after = engineState(ctx);
    const rows = await employers(ctx);
    const twice = duplicates(rows);
    if (twice.length) throw new Error(`Employers & Sources lists ${twice.join(', ')} more than once`);
    if (rows.length !== rowsBefore) throw new Error(`Employers & Sources had ${rowsBefore} rows and now has ${rows.length}`);
    if (after.registered.length !== state.first.registered.length) throw new Error(`the second run registered ${after.registered.length - state.first.registered.length} more source(s)`);
    const line = parseRunLine(state.second[0].result);
    if (!line || line.checked !== 0 || line.added !== 0) throw new Error(`the second run says "${state.second[0].result}": everything was checked, so it should say checked 0 and no new sources`);
  }, {needs: ctx.needs});

  // The AI judge is paid for in the nightly release gate and in a manual run (E2E_FULL=1 in CI), not on the three-a-day schedule: what it judges is tuned once. On a Mac it always runs.
  const FULL = {name: 'the nightly or a manual run (E2E_FULL=1)', value: process.env.CI ? process.env.E2E_FULL : '1'};
  await ctx.run('a Sonnet judge finds each added employer sensible for the candidate', async () => {
    const added = state.rows.filter(row => row.active === true);
    const items = added.map(row => ({name: row.name, board: row.ats, quality: row.quality, citiesOfThose: row.cities, why: row.notes, relevantRoles: row.relevant_roles, relevantRolesInPreferredPlaces: row.in_preferred_places}));
    if (items.length !== 2) throw new Error(`expected two added employers to judge, found ${items.length}`);
    const verdicts = await judge({key: ctx.judgeKey, person: `${PERSON} ${QUALITY_NOTE} ${FIELDS_NOTE}`, items});
    console.log(`  judge: ${verdicts.map(item => `${item.name}: ${item.makes_sense ? 'yes' : 'NO'} (${item.reason})`).join(' | ')}`);
    const problems = judgeProblems(items.map(item => item.name), verdicts);
    if (problems.length) throw new Error(problems.join('; '));
  }, {needs: [...ctx.needs, FULL, ...ctx.needsKey]});   // the judge is Sonnet: through the API in CI (it needs the key there), through Claude Code on a Mac

  await ctx.run('the Actions page renders without layout problems after the runs', async () => {
    if (ctx.audience === 'non-it') {
      // The app learns who the candidate is from config/search.json (the roles they look for); the crawl rewrites it from the test page, which holds the SRE's search. Say it is the persona's.
      const file = path.join(ctx.profile, 'config', 'search.json'), current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
      const person = JSON.parse(fs.readFileSync(path.join(E2E, 'fixtures', 'feeds', persona.dir, 'person.json'), 'utf8')), roles = person.role_keywords;
      // The roles the Strategy page shows come from the job-board searches first: they must be the persona's too, or the page contradicts the candidate it is judged against.
      fs.writeFileSync(file, JSON.stringify({...withRoles({...current, locations: person.locations, title_exclude_keywords: person.title_exclude_keywords}, roles), jobs_board_search_queries: roles.map(role => role.replace(/\\b/g, '')).filter(role => /^[a-z ]+$/i.test(role))}));
      await ctx.page.reload();
      await ctx.page.waitForSelector('.view:not([hidden])', {timeout: 60000});
      await ctx.page.waitForTimeout(3000);
    }
    await visit(ctx, ctx.audience ? ['focus', 'jobs', 'interviews', 'strategy', 'actions'] : ['actions']);
    if (ctx.audience === 'non-it') {
      // Does the app speak to THIS candidate? Everything the pages show, every tip the bars can show, judged against who the candidate is (lib/fit.mjs): no word list, any profession.
      const pages = await collect(ctx.page, ['focus', 'jobs', 'interviews', 'strategy', 'actions', 'settings']);
      const verdict = await fitJudge({key: ctx.judgeKey, candidate: persona.person, pages});
      console.log(`  fit judge: ${pages.length} pages read, ${verdict.issues.length} line(s) written for another kind of candidate${verdict.unverified ? `, ${verdict.unverified} quote(s) not on the page dropped` : ''}`);
      if (verdict.unreadable) throw new Error('the fit judge gave a reply that cannot be read: that is not a pass');
      ctx.findings.push(...fitFindings(verdict.issues));
    }
    finish(ctx);
  }, {needs: ctx.needs});
}
