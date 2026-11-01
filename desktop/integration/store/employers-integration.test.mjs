// Layer 3 (Node + the real engine + the Notion stand-in, no window): "Find new employers" on the employers suite's fixture boards (desktop/e2e/suites/employers.mjs).
// It runs the very command the app's button runs (`python -m src scout --log-run`, lib/pipeline-tasks.js scout) with the same fixture feeds, candidate list and
// fictional candidate, against the stand-in Notion, and reads the result through the store the app reads. Replaces these e2e steps:
//   - "each candidate ends in the right status, and only genuinely useful boards become sources"
//   - "Employers & Sources in Notion holds a complete, sensible row per candidate, and none for the duplicate or the excluded"
//   - "the run's row says what happened, and the numbers are the real ones" (the store's side; the app's Recent runs text is the same string)
// It also covers "the crawl's source list…" and "a second run writes nothing twice": those two data steps stay in the e2e suite as well (a8's safety/data list, 1 Nov 2026), so the
// store's side is proven here in seconds on every PR and the app-level run stays in the beta until the owner decides.
// For both personas the suite can run (E2E_EMPLOYERS_PERSONA): the senior SRE in Zurich and the band 6 nurse in Manchester.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
import {duplicates, EXPECTED, parseRunLine, rowProblems} from '../../e2e/lib/employers.mjs';
import {buildStandIn, startNotionFake} from '../../e2e/lib/notion-fake.mjs';
import {python, scoutState} from '../../e2e/lib/python.mjs';
import {storeCall, storeEnv} from '../../e2e/lib/store-call.mjs';
import {createStorage} from '../../lib/storage.js';
import {ensureConfig} from '../../lib/pipeline-env.js';

const E2E = path.resolve(import.meta.dirname, '..', '..', 'e2e');
const ROOT = path.resolve(E2E, '..', '..');
const FEEDS = path.join(E2E, 'fixtures', 'feeds');
const run = promisify(execFile);
const PERSONAS = {
  sre: {dir: 'employers', city: /zurich/i, elsewhere: /lisbon/i},
  nurse: {dir: 'employers-nurse', city: /manchester/i, elsewhere: /sydney/i},
};

// The app's profile on the stand-in Notion, with the run's own copy of the feeds (the persona's boards replace the SRE ones of the same names).
async function install(persona) {
  const fake = await startNotionFake();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-employers-int-'));
  const feeds = path.join(profile, 'feeds');
  fs.cpSync(FEEDS, feeds, {recursive: true});
  if (persona.dir !== 'employers') for (const file of fs.readdirSync(path.join(FEEDS, persona.dir)).filter(name => name !== 'person.json')) fs.copyFileSync(path.join(FEEDS, persona.dir, file), path.join(feeds, 'employers', file));
  // Nimbus' postings are three days old whenever the test runs (freshness is part of the quality score, and the engine reads the real clock); Orbit's stay old on purpose.
  const nimbusFile = path.join(feeds, 'employers', 'nimbus.json');
  const nimbus = JSON.parse(fs.readFileSync(nimbusFile, 'utf8'));
  // Why (1 Nov 2026, as suites/employers.mjs): the engine's freshness is measured from its own now, so the fixture is dated relative to it.
  for (const job of nimbus.jobs) job.updated_at = new Date(Date.now() - 3 * 86400000).toISOString();   // clock: relative to the engine's own clock
  fs.writeFileSync(nimbusFile, JSON.stringify(nimbus));
  ensureConfig(createStorage(profile, {encrypt: value => value, decrypt: value => value}));   // a first run's config, the repo defaults (lib/pipeline-env.js)
  fs.copyFileSync(path.join(FEEDS, 'sources.json'), path.join(profile, 'config', 'sources.json'));   // E2E Acme and E2E Beta are already sources
  fs.copyFileSync(path.join(FEEDS, 'employers', 'scout_seeds.json'), path.join(profile, 'config', 'scout_seeds.json'));
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({store: 'notion', notionIds: await buildStandIn(fake)}));
  const ctx = {profile, store: 'standin', token: fake.token, appEnv: {JOB_PILOTTO_E2E_NOTION_BASE_URL: fake.url, JOB_PILOTTO_E2E_NOTION_STANDIN: '1'}};
  const env = {...Object.fromEntries(['PATH', 'TMPDIR', 'LANG', 'SYSTEMROOT', 'TEMP', 'TMP'].filter(name => process.env[name]).map(name => [name, process.env[name]])), PYTHONUTF8: '1',
    ...storeEnv({profile, token: fake.token, notionUrl: fake.url, standIn: true}), JOB_PILOTTO_DISABLE: 'mail,telegram,google_jobs',
    JOB_PILOTTO_FIXTURE_DIR: feeds, JOB_PILOTTO_LOCATIONS_FILE: path.join(FEEDS, persona.dir, 'person.json')};
  return {fake, ctx, env, profile};
}

// One click on Find new employers: the engine command the app starts, to its end.
const findEmployers = async ({env}) => run(python(), ['-m', 'src', 'scout', '--log-run', '--budget', '600'], {cwd: ROOT, env, maxBuffer: 64 * 1024 * 1024, timeout: 150000});

// The scout's rows in the run list. Why (1 Nov 2026, flaky ~1 in 2 locally): started_at has one-second resolution and the second click can start in the same second as the
// first (a run that checks nothing takes well under a second), so ordering by it picks the first run's row as "the second". The new row is found by identity instead.
const scoutRuns = async ctx => (await storeCall(ctx, 'cron_runs', 'list', {})).filter(item => item.mode === 'scout');
const sameRun = (a, b) => (a.id != null && b.id != null ? a.id === b.id : JSON.stringify(a) === JSON.stringify(b));

// What the scout decided, the feeds it registered and the jobs crawl's list: lib/python.mjs scoutState (shared with the employers e2e suite).
const engineState = ({profile, env}) => scoutState(profile, env);

// One candidate's status against what the fixture boards deserve (a problem text, or null).
function statusProblem(company, want, got) {
  if (want.status === 'excluded') return got ? `${company} is excluded but the scout kept it as a candidate (${got.status})` : null;
  if (!got) return `${company} was never a candidate`;
  const shown = want.status === 'duplicate' ? 'found' : want.status;   // the scout stores a duplicate as 'found' and tells it apart by not registering it again
  return got.status === shown ? null : `${company}: status ${got.status}, expected ${want.status}`;
}

// Each candidate ends in the right status, and only genuinely useful boards become sources (the problems found, none = right).
function statusProblems(first, status) {
  const problems = Object.entries(EXPECTED).map(([company, want]) => statusProblem(company, want, status[company])).filter(Boolean);
  const sources = first.registered.map(item => item.company).sort();
  const wanted = Object.entries(EXPECTED).filter(([, want]) => want.status === 'found').map(([company]) => company).sort();
  if (JSON.stringify(sources) !== JSON.stringify(wanted)) problems.push(`registered sources are [${sources}], expected [${wanted}]`);
  return problems;
}

// Employers & Sources holds a complete, sensible row per candidate, and none for the duplicate or the excluded (the problems found, none = right).
function rowChecks(byName, persona) {
  const found = [];
  for (const [company, want] of Object.entries(EXPECTED)) {
    const row = byName[company];
    if (want.feed == null) { if (row) found.push(`${company} must not have a row (${want.status}), it has one: ${row.feed_status}`); continue; }
    if (!row) { found.push(`${company} has no row in Employers & Sources`); continue; }
    found.push(...rowProblems(row, want.status));
    if (row.feed_status !== want.feed) found.push(`${company}: Feed status "${row.feed_status}", expected "${want.feed}"`);
    if (row.active !== want.active) found.push(`${company}: Active is ${row.active}, expected ${want.active}`);
  }
  // The numbers in a row come from the fixture boards: Nimbus has 5 postings, 4 of them relevant, all 4 in the person's city; Orbit 3, 2 and 1.
  const rowOf = byName['E2E Nimbus'], rowOrbit = byName['E2E Orbit'];
  if (!(rowOf.ats === 'greenhouse' && rowOf.slug === 'e2e-nimbus' && rowOf.relevant_roles === 4 && rowOf.in_preferred_places === 4 && persona.city.test(rowOf.cities) && /5 postings; 4 matching; 4 in preferred places/.test(rowOf.notes))) found.push(`E2E Nimbus' row does not match its board: ${JSON.stringify(rowOf)}`);
  if (!(rowOrbit.relevant_roles === 2 && rowOrbit.in_preferred_places === 1 && persona.city.test(rowOrbit.cities) && !persona.elsewhere.test(rowOrbit.cities))) found.push(`E2E Orbit's row does not match its board (2 relevant, 1 in the city, none elsewhere): ${JSON.stringify(rowOrbit)}`);
  if (!(rowOf.quality > rowOrbit.quality)) found.push(`the store's quality does not order the boards: Nimbus ${rowOf.quality}, Orbit ${rowOrbit.quality}`);
  if (!/quiet\.e2e\.test/.test(byName['E2E Quiet']?.careers_url || '')) found.push(`E2E Quiet's Careers link is "${byName['E2E Quiet']?.careers_url}"`);
  return found;
}

for (const [label, persona] of Object.entries(PERSONAS)) {
  test(`${label}: every candidate ends in the right status, its row is complete, the run row has the real numbers, the crawl list is right, and a second run writes nothing twice`, async () => {
    const {fake, ctx, env, profile} = await install(persona);
    try {
      await findEmployers({env});
      const first = engineState({profile, env});
      // each candidate ends in the right status, and only genuinely useful boards become sources
      const status = Object.fromEntries(first.candidates.map(item => [item.name, item]));
      const problems = statusProblems(first, status);
      assert.deepEqual(problems, []);
      const [nimbus, orbit] = ['E2E Nimbus', 'E2E Orbit'].map(company => status[company].quality);
      assert.ok(nimbus - orbit >= 20, `quality barely tells a strong board (${nimbus}) from a weak one (${orbit})`);

      // Employers & Sources holds a complete, sensible row per candidate, and none for the duplicate or the excluded
      const rows = await storeCall(ctx, 'employers', 'list', {active: null});
      const byName = Object.fromEntries(rows.map(row => [row.name, row]));
      const rowProblemsFound = rowChecks(byName, persona);
      assert.deepEqual(rowProblemsFound, []);

      // the run's row says what happened, and the numbers are the real ones
      const runs = await scoutRuns(ctx);
      assert.equal(runs.length, 1, 'Find new employers left one row in the run list');
      const line = parseRunLine(runs[0].summary);
      assert.ok(line, `the run row says "${runs[0].summary}": no "checked N" and no "N new sources"`);
      assert.equal(line.checked, first.candidates.length, `the row says checked ${line.checked}, the scout checked ${first.candidates.length}`);
      assert.equal(line.added, first.registered.length, `the row says ${line.added} new sources, the scout registered ${first.registered.length}`);

      // the crawl's source list now holds the starter employers and the two new boards, and nothing else
      assert.deepEqual([...first.crawl].sort(), ['E2E Acme', 'E2E Beta', 'E2E Nimbus', 'E2E Orbit']);

      // a second run writes nothing twice
      await findEmployers({env});
      const after = engineState({profile, env});
      const again = await storeCall(ctx, 'employers', 'list', {active: null});
      assert.deepEqual(duplicates(again), [], 'Employers & Sources lists an employer more than once');
      assert.equal(again.length, rows.length, `Employers & Sources had ${rows.length} rows and now has ${again.length}`);
      assert.equal(after.registered.length, first.registered.length, 'the second run registered more sources');
      const second = await scoutRuns(ctx);
      assert.equal(second.length, 2, 'the second click left its own run row');
      const secondRun = second.find(item => !runs.some(old => sameRun(old, item)));
      assert.ok(secondRun, 'the second click left its own run row');
      const secondLine = parseRunLine(secondRun.summary);
      assert.ok(secondLine && secondLine.checked === 0 && secondLine.added === 0, `the second run says "${secondRun.summary}": everything was checked, so it should say checked 0 and no new sources`);
      assert.deepEqual(fake.stats.unknown, [], 'the stand-in met requests it does not know');
    } finally { await fake.close(); }
  });
}
