// Pin the quality journey split and the plain rates artifact consumed by the release gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import * as journeyLib from '../lib/quality-journey.mjs';
import {qualityRates} from '../lib/quality-rates.mjs';
import * as quality from '../suites/quality.mjs';
import * as qualityai from '../suites/qualityai.mjs';
import {suiteFacts} from '../plan-run.mjs';

const source = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

test('rates not reached are null, and reached zero counts remain zero', () => {
  assert.deepEqual(qualityRates(), {v: 1, facts: null, flags: null, cv: null, steady: null, ranking: null, caps: null});
  assert.deepEqual(qualityRates({facts: {exact: 0, total: 0}, flags: {judged: 0, flagged: 0}, cv: {found: 0, expected: 0, corrected: 0}}),
    {v: 1, facts: {exact: 0, total: 0}, flags: {judged: 0, flagged: 0}, cv: {found: 0, expected: 0, corrected: 0}, steady: null, ranking: null, caps: null});
});

test('rates contain only the contracted counts and verdicts, never judge texts or history', () => {
  const measured = {facts: {exact: 90, total: 91, text: 'private'}, flags: {judged: 18, flagged: 2, why: 'private'},
    cv: {found: 12, expected: 13, corrected: 1, cv: 'private'}, steady: {pairs: 9, within8: 8, runId: 10, over20: 1}, ranking: '2 violation(s)', caps: '1 over'};
  assert.deepEqual(qualityRates(measured), {v: 1, facts: {exact: 90, total: 91}, flags: {judged: 18, flagged: 2},
    cv: {found: 12, expected: 13, corrected: 1}, steady: {pairs: 9, within8: 8}, ranking: '2 violation(s)', caps: '1 over'});
  assert.equal(qualityRates({ranking: 'ok', caps: 'ok'}).caps, 'ok');
});

test('both suites share planner inputs and the golden journey, with separate clocks', async () => {
  assert.ok(Object.isFrozen(journeyLib.PLANNER));
  const facts = await suiteFacts();
  for (const suite of [quality, qualityai]) {
    assert.equal(suite.cadence, 'nightly');
    assert.equal(suite.store, 'sqlite');
    assert.equal(suite.sameOnEveryOs, true);
    assert.equal(suite.budgetMinutes, suite.name === 'qualityai' ? 10 : undefined);
    assert.equal(suite.minutes, suite.name === 'qualityai' ? 24 : 3);
    assert.equal(typeof suite.run, 'function');
    assert.equal(suite.env, journeyLib.PLANNER.env);
    assert.equal(suite.watches, journeyLib.PLANNER.watches);
    assert.equal(suite.judges, journeyLib.PLANNER.judges);
    assert.ok(facts.all.includes(suite.name));
    assert.equal(facts.cadence[suite.name], 'nightly');
    assert.ok(facts.sameOnEveryOs.includes(suite.name));
    assert.ok(facts.storeless.includes(suite.name));
    assert.deepEqual(facts.judges[suite.name], quality.judges);
    assert.equal(await facts.minutes(suite.name), suite.name === 'qualityai' ? 24 : 3);
    assert.deepEqual(facts.watches[suite.name], quality.watches);
    assert.match(source(`../suites/${suite.name}.mjs`), /quality-journey.mjs/);
  }
});

test('the backbone stays exact and live quality has no replay branch', () => {
  const backbone = source('../suites/quality.mjs'), ai = source('../suites/qualityai.mjs');
  assert.doesNotMatch(backbone, /factsVerdict|flagsVerdict|rateVerdict|replaying\(|fresh\(|Haiku judge|CV match|missedQuestions/);
  assert.match(backbone, /if \(problems.length\) throw new Error\(`\$\{problems.length\} wrong or missing fact/);
  assert.match(backbone, /if \(over.length\) throw new Error/);
  assert.doesNotMatch(ai, /replaying\(|\bLIVE\b|judgeVerdict/);
  assert.match(ai, /scoring the same jobs again is steady over the last nights/);
  assert.match(ai, /job: \{\.\.\.item, company: item.company \|\| read\('sources.json'\)\[0\].company\}/);
  assert.match(ai, /quality-rates.json/);
  const cv = ai.indexOf("ctx.run('the CV match");
  assert.equal(ai.match(/await soft\(privacyLogs\)/g)?.length, 1, 'one privacy step name per journey');
  assert.ok(ai.indexOf('await soft(privacyLogs)') > cv);
  assert.doesNotMatch(ai.slice(cv, ai.indexOf('for (const item of postings.filter', cv)), /measured\.cv =/);
  assert.ok(ai.indexOf('measured.cv =', cv) > ai.indexOf('const result = await check', cv), 'CV measurements follow a successful call');
  assert.match(backbone, /const summary = \{facts: \{exact: 0, total: 0\}, ranking: 'not checked'\};/);
  assert.ok(backbone.includes('const line = `quality: ${summary.facts.exact}/${summary.facts.total} facts exact, ranking ${summary.ranking}`;'));
});


test('the shared steps and the remaining backbone steps keep their names and order', () => {
  const names = text => [...text.matchAll(/ctx.run\('((?:\\.|[^'])*)'/g)].map(match => match[1]);
  const journey = source('../lib/quality-journey.mjs');
  const shared = names(journey);
  assert.deepEqual(shared, ['the first search after the setup has ended', 'this suite starts with no jobs and no runs in its Notion page',
    'a Jobs check on the golden postings finishes and scores them', 'no job text, CV text or secret reached the logs']);
  assert.deepEqual(names(source('../suites/quality.mjs')), [
    'every enriched fact equals the ground truth (seniority, work mode, location, languages, salary, role family)',
    'the duplicate posting is one job, everywhere',
    'relevant jobs rank above irrelevant ones, and scores are whole numbers from 0 to 100',
    'every Notion column the app promises is filled, and no text shows a programming accident',
    "the app\\'s list agrees with Notion (same jobs, same scores)"]);
  for (const suite of ['quality', 'qualityai']) {
    const code = source(`../suites/${suite}.mjs`);
    const calls = ['await journey.setUp()', 'await journey.reset()', 'await journey.jobs()', 'every enriched fact', 'await soft(privacyLogs)'].map(call => code.indexOf(call));
    assert.ok(calls.every((at, i) => at >= 0 && (!i || calls[i - 1] < at)), `${suite}: shared journey order`);
  }
});

// A refactor must preserve early score failures and report ranking before cap handling.
test('the shared ranking check preserves score assertions and the two cap policies', () => {
  const truth = [{id: 'high', title: 'Relevant', fit: 'high'}, {id: 'low', title: 'Other', fit: 'low', maxScore: 49}];
  const check = (scores, onCap = () => {}, onRanking = () => {}) => journeyLib.rankingCheck({truth, postings: truth,
    rows: Object.entries(scores).map(([id, Score]) => ({props: {Job: id, Score}})), scoresOf: () => scores}, {onCap, onRanking});
  assert.throws(() => check({high: 100.5}), {message: 'a score is not a whole number from 0 to 100: high = 100.5'});
  assert.throws(() => check({low: 10}), {message: 'relevant job(s) were not scored: Relevant'});
  let ranking = 'not checked';
  assert.throws(() => check({high: 20, low: 30}, () => assert.fail('caps follow ranking'), value => { ranking = value; }),
    {message: '"Other" (30) is not below "Relevant" (20)'});
  assert.equal(ranking, '1 violation(s)');
  assert.throws(() => check({high: 90, low: 60}, (_over, said) => { throw new Error(`a job with an unmet stated requirement is scored too high: ${said}`); }),
    {message: 'a job with an unmet stated requirement is scored too high: "Other" scored 60, above its cap 49'});
  let caps;
  check({high: 90, low: 60}, over => { caps = over.length ? `${over.length} over` : 'ok'; });
  assert.equal(caps, '1 over');
  check({high: 90, low: 40}, over => { caps = over.length ? `${over.length} over` : 'ok'; }, value => { ranking = value; });
  assert.equal(caps, 'ok');
  assert.equal(ranking, 'ok');
});

// Missing required jobs count toward the live denominator; optional drops do not.
test('shared fact collection keeps exact counts, diagnostics and missed facts separate', () => {
  const truth = [{id: 'a', title: 'A', url: 'https://a.test', seniority: 'Senior', location: 'Zurich'},
    {id: 'b', title: 'B', url: 'https://b.test', seniority: 'Senior', location: 'Bern'},
    {id: 'c', title: 'C', url: 'https://c.test', location: 'Basel', filterMayDrop: true},
    {id: 'd', title: 'Duplicate', duplicateOf: 'a', url: 'https://a.test', location: 'Zurich'}];
  const rows = [{props: {'Job URL': 'https://a.test', Seniority: 'Senior', Location: 'Bern'}}];
  assert.deepEqual(journeyLib.collectFacts({truth, postings: truth.filter(item => !item.duplicateOf), rows}), {
    exact: 1, total: 2, missed: 2,
    problems: ['"A": location should be "Zurich", the app wrote "Bern"', '"B" is missing from Notion'],
  });
});

// The guard must reject before creating the journey or calling any setup step.
test('exact quality refuses off, unset or invalid answers before setup; backbone and record pass the guard', async t => {
  const saved = {...process.env};
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  const message = 'quality is a backbone suite: set E2E_AI_ANSWERS=backbone (or record for a record run)';
  const touched = new Error('setup boundary reached');
  const ctx = {get page() { throw touched; }};
  for (const mode of [undefined, 'off', 'backbone', 'record', '', 'invalid']) {
    if (mode === undefined) delete process.env.E2E_AI_ANSWERS; else process.env.E2E_AI_ANSWERS = mode;
    if (mode === undefined || mode === 'off') await assert.rejects(quality.run(ctx), {message});
    else if (mode === '' || mode === 'invalid') await assert.rejects(quality.run(ctx), {message: `invalid E2E_AI_ANSWERS: ${mode}`});
    else await assert.rejects(quality.run(ctx), error => error === touched);
  }
});
