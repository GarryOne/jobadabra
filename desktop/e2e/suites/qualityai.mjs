// Live quality rates: measure facts, ranking, score steadiness, judge flags and CV matches.
// Job: run tolerant suites as rates
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {qualityJourney} from '../lib/quality-journey.mjs';
import {execFileSync} from 'node:child_process';
import {python, pythonEnv} from '../lib/python.mjs';
import {modelClient} from '../lib/model.mjs';
import {fresh} from '../lib/ai-meter.mjs';
import {factsVerdict, flagsVerdict, nightOf, rateOf, rateVerdict, recordNight} from '../lib/quality-rate.mjs';
import {qualityRates} from '../lib/quality-rates.mjs';
import {failures, judge} from '../lib/factjudge.mjs';
import {placesNote} from '../lib/quality-places.mjs';
import {plainTextOf} from '../lib/seed-texts.mjs';
import {notKeptNote} from '../lib/quality-rows.mjs';
import {capViolations, checkFacts, matchRows, rankingViolations, unstable} from '../lib/quality.mjs';

export const name = 'qualityai';
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
// Prompt changes must reach this live journey as well as the exact quality journey.
export const judges = ['src/ai/'];
export const watches = ['src/ai/score.py', 'src/ai/score_bands.py', 'src/ai/enrich.py', 'src/ai/hints.py', 'desktop/lib/pipeline.js', 'desktop/lib/question-reuse.js', 'desktop/lib/match-check.js', 'desktop/e2e/fixtures/golden/'];
// This suite measures what a user gets, so the app under test runs on the shipped model (about $0.3 a run); the other suites run on Haiku. For a cheap run:
// E2E_APP_MODEL=claude-haiku-4-5 (Haiku 4.5 scored the same job up to 10 points apart between two scorings, Sonnet within 6).
export const env = {JOB_PILOTTO_MODEL_OVERRIDE: process.env.E2E_APP_MODEL || 'claude-sonnet-5-5'};
// A persona's Profile is a file the engine reads instead of the test page's Profile (test-only: desktop/lib/pipeline.js JOB_PILOTTO_E2E_PROFILE_FILE).
if (process.env.E2E_QUALITY_PERSONA) env.JOB_PILOTTO_E2E_PROFILE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', `golden-${process.env.E2E_QUALITY_PERSONA}`, 'profile.md');
/** Run the golden journey and report every independent final check. */
export async function run(ctx) {
  const journey = qualityJourney(ctx);
  const {truth, postings, scoresOf, privacyLogs, persona, GOLDEN, read, check} = journey;
  const measured = {};
  let firstTexts = {};
  const read2 = async () => { await journey.read2(); rows = journey.rows; };
  let rows = [];
  const summary = {facts: {exact: 0, total: 0}, ranking: 'not checked', invented: 0, stable: 'not checked'};
  ctx.findings = [];
  const late = [];   // the last checks are independent: each one reports, and the suite fails after all of them ran
  const soft = async step => { try { await step(); } catch (error) { late.push(error); } };
  const night = {runId: Number(process.env.GITHUB_RUN_ID) || `local-${Date.now()}`, day: new Date().toISOString().slice(0, 10)};
  const record = part => rateOf(recordNight(process.env.E2E_QUALITY_HISTORY || '', {...night, ...part}));
  try {
    await journey.setUp();
    await journey.reset();
    await journey.jobs();
    rows = journey.rows;

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
      if (problems.length) console.log(`  ${problems.length} wrong or missing fact(s) tonight:\n    ${problems.join('\n    ')}`);
      measured.facts = {exact: summary.facts.exact, total: summary.facts.total + missed};
      const rate = factsVerdict(record({factsExact: summary.facts.exact, factsTotal: summary.facts.total + missed}));
      console.log(`  facts: ${rate.line}`);
      if (!rate.ok) throw new Error(`the facts are not exact over the last nights: ${rate.problems.join('; ')}`);
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
      measured.ranking = summary.ranking;
      console.log(`  scores: ${postings.map(item => `${item.id}=${scores[item.id] ?? 'dropped'}`).join(' ')}`);
      if (violations.length) throw new Error(violations.map(v => `"${v.low}" (${v.lowScore}) is not below "${v.high}" (${v.highScore})`).join('; '));
      const over = capViolations(truth, scores), said = over.map(v => `"${v.title}" scored ${v.score}, above its cap ${v.cap}`).join('; ');
      measured.caps = over.length ? `${over.length} over` : 'ok';
      if (over.length) console.log(`  above a cap tonight: ${said}`);
    }, {needs: ctx.needs});

    await soft(() => ctx.run('scoring the same jobs again is steady over the last nights', async () => {
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
      const scored = nightOf(first, second, night);
      measured.steady = scored;
      const rate = rateVerdict(record(scored));
      console.log(`  score steadiness: ${rate.line}`);
      if (!rate.ok) throw new Error(`the AI's scores are not steady over the last nights: ${rate.problems.join('; ')}`);
    }, {needs: ctx.needs, limitMs: 6 * STEP}));

    await soft(() => ctx.run('the score reasons say nothing invented or untrue (Haiku judge)', async () => {
      const {byId} = matchRows(truth, rows);
      // The candidate as the scoring knows them: only the Profile page it read (src/ai/score.py scores "using only the profile and the posting").
      // The CV text is left out: with it, a gap such as "Datadog is not named in your profile" was judged invented whenever the CV had the skill and
      // the seeded Profile did not (#350: jobs 3001, 3002, 3010 on 11 and 12 Oct 2026).
      const profile = `THE PROFILE\n${persona ? fs.readFileSync(path.join(GOLDEN, 'profile.md'), 'utf8') : await plainTextOf(ctx, 'profile').catch(() => '')}`.slice(0, 30000) + placesNote(JSON.parse(fs.readFileSync(path.join(ctx.profile, 'config', 'search.json'), 'utf8')).locations);   // the places the scorer read (lib/quality-places.mjs)
      const verdicts = [], problems = [];
      // Both scorings' texts when the second ran (18 for 9 jobs), else the one there is.
      const todo = postings.filter(item => byId[item.id]).flatMap(item => [{item, p: byId[item.id][0].props}, ...(firstTexts[item.id] ? [{item, p: firstTexts[item.id], first: true}] : [])]);
      for (let i = 0; i < todo.length; i += 4) {
        await Promise.all(todo.slice(i, i + 4).map(async ({item, p, first}) => {
          const produced = [p.Reason, p.Strengths && `Strengths: ${p.Strengths}`, p.Gaps && `Gaps: ${p.Gaps}`];
          const facts = Object.fromEntries(['Seniority', 'Work mode', 'Languages', 'Salary', 'Role family', 'Technologies', 'Recruiter'].map(column => [column, p[column]]));
          // The employer is on every posting the app read (fixtures/golden/sources.json): without it the judge called the company's own name invented (Windows run 37150232804, job 3008).
          const verdict = await judge({key: ctx.judgeKey, posting: {...item, company: item.company || read('sources.json')[0].company}, profile, produced, facts, question: {operation: 'judge.facts', id: `${item.id}/${first ? 'first' : 'second'}`}});
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
      measured.flags = {judged: verdicts.length, flagged: problems.length};
      if (problems.length) console.log(`  ${problems.length} of ${verdicts.length} texts flagged tonight:\n    ${problems.join('\n    ')}`);
      const rate = flagsVerdict(record({judged: verdicts.length, flagged: problems.length}));
      console.log(`  judge flags: ${rate.line}`);
      if (!rate.ok) throw new Error(`the score texts invent or contradict too often over the last nights: ${rate.problems.join('; ')}`);
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
        const result = await check({}, ctx.key, {job: {...item, company: item.company || read('sources.json')[0].company}, cv, client: modelClient({key: ctx.judgeKey})});   // through lib/model.mjs either way: Claude Code on a Mac, the API in CI (counted for /ai-cost)
        corrected += result.corrected;
        for (const term of TERMS.filter(candidateTerm => text.includes(candidateTerm) && item.description.toLowerCase().includes(candidateTerm))) {
          expected++;
          if (result.musts.some(must => must.term.toLowerCase().includes(term) && must.status === 'found')) got++;
        }
        measured.cv = {found: got, expected, corrected};
        // The product's rule (match-check.js guard): "found" needs the term OR the model's quoted evidence in the CV ("Kubernetes on AWS", evidence "Kubernetes (AWS EKS)": run 37136327455).
        const words = value => ` ${String(value || '').toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
        const stated = phrase => words(phrase).trim().length >= 2 && words(text).includes(words(phrase));
        for (const must of result.musts) if (must.status === 'found' && !stated(must.term) && !stated(must.evidence)) throw new Error(`"${item.title}": "${must.term}" is marked found, but the CV states neither it nor its evidence ("${must.evidence || ''}")`);
      }
      console.log(`  CV match: ${got}/${expected} required terms found, ${corrected} claim(s) corrected by the guard`);
      if (expected && got / expected < 0.7) throw new Error(`only ${got} of ${expected} terms that the posting and the CV both state came back as found`);
      if (corrected > 4) throw new Error(`the guard had to correct ${corrected} claims about the CV on three postings (at most 4)`);
    }, {needs: ctx.needs, limitMs: 3 * STEP}));

    await soft(privacyLogs);

    if (late.length) throw new Error(`${late.length} quality check(s) failed: ${late.map(error => error.message.split('\n')[0].slice(0, 120)).join(' | ')}`);
  } finally {   // the one-line summary is printed whatever failed
    const line = `quality: ${summary.facts.exact}/${summary.facts.total} facts exact, ranking ${summary.ranking}, ${summary.invented} invented facts, scores stable ${summary.stable}`;
    console.log(`\n${line}\n`);
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'quality-summary.txt'), line + '\n');
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'quality-rates.json'), JSON.stringify(qualityRates(measured)));
  }
}
