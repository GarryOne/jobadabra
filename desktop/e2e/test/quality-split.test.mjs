// Pin the quality journey split and the plain rates artifact consumed by the release gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import * as journeyLib from '../lib/quality-journey.mjs';
import {qualityRates} from '../lib/quality-rates.mjs';
import * as quality from '../suites/quality.mjs';
import * as qualityai from '../suites/qualityai.mjs';
import {planRun, suiteFacts} from '../plan-run.mjs';
import {suitePartsFor, suitesFor, suitesNamed} from '../lib/plan.mjs';
import {watchesWithImports} from '../lib/import-graph.mjs';
import {runMailReading} from '../lib/quality-mail.mjs';
import {DUMMY_KEY} from '../lib/engine.mjs';
import {createRunner} from '../lib/runner.mjs';
import {takeCapped} from '../lib/ai-cap.mjs';

const source = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

test('rates not reached are null, and reached zero counts remain zero', () => {
  assert.deepEqual(qualityRates(), {v: 1, facts: null, flags: null, cv: null, steady: null, ranking: null, caps: null, mail: null});
  assert.deepEqual(qualityRates({facts: {exact: 0, total: 0}, flags: {judged: 0, flagged: 0}, cv: {found: 0, expected: 0, corrected: 0}}),
    {v: 1, facts: {exact: 0, total: 0}, flags: {judged: 0, flagged: 0}, cv: {found: 0, expected: 0, corrected: 0}, steady: null, ranking: null, caps: null, mail: null});
});

test('rates contain only the contracted counts and verdicts, never judge texts or history', () => {
  const measured = {facts: {exact: 90, total: 91, text: 'private'}, flags: {judged: 18, flagged: 2, why: 'private'},
    cv: {found: 12, expected: 13, corrected: 1, cv: 'private'}, steady: {pairs: 9, within8: 8, runId: 10, over20: 1}, ranking: '2 violation(s)', caps: '1 over'};
  assert.deepEqual(qualityRates(measured), {v: 1, facts: {exact: 90, total: 91}, flags: {judged: 18, flagged: 2},
    cv: {found: 12, expected: 13, corrected: 1}, steady: {pairs: 9, within8: 8}, ranking: '2 violation(s)', caps: '1 over', mail: null});
  assert.equal(qualityRates({ranking: 'ok', caps: 'ok'}).caps, 'ok');
});

test('both suites share planner inputs and the golden journey, with separate clocks', async () => {
  assert.ok(Object.isFrozen(journeyLib.PLANNER));
  const facts = await suiteFacts();
  for (const suite of [quality, qualityai]) {
    assert.equal(suite.cadence, 'night-report');   // both measurements: once a night, report only (owner, 1 Nov 2026; qualityai since 6/6a-2)
    assert.equal(suite.store, 'sqlite');
    assert.equal(suite.sameOnEveryOs, true);
    assert.equal(suite.budgetMinutes, suite.name === 'qualityai' ? 10 : undefined);
    assert.equal(suite.minutes, suite.name === 'qualityai' ? 24 : 3);
    assert.equal(typeof suite.run, 'function');
    assert.equal(suite.env, journeyLib.PLANNER.env);
    assert.deepEqual(suite.watches, suite.name === 'qualityai' ? [...journeyLib.PLANNER.watches, ...qualityai.parts.mail] : journeyLib.PLANNER.watches);
    assert.equal(suite.judges, journeyLib.PLANNER.judges);
    assert.ok(facts.all.includes(suite.name));
    assert.equal(facts.cadence[suite.name], 'night-report');
    assert.ok(facts.sameOnEveryOs.includes(suite.name));
    assert.ok(facts.storeless.includes(suite.name));
    assert.deepEqual(facts.judges[suite.name], quality.judges);
    assert.equal(await facts.minutes(suite.name), suite.name === 'qualityai' ? 24 : 3);
    assert.deepEqual(facts.watches[suite.name], suite.watches);
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


test('mail watches choose only the mail part; unrelated and scheduled runs do not', async () => {
  const facts = await suiteFacts();
  const parts = Object.fromEntries(Object.entries(qualityai.parts).map(([part, paths]) => [part, watchesWithImports({part: paths}).part]));
  assert.deepEqual(suitePartsFor(['src/ai/mail.py'], parts), ['mail']);
  assert.deepEqual(suitePartsFor(['src/ai/mail_lines.py'], parts), ['mail']);
  assert.deepEqual(suitePartsFor(['src/ai/interviews.py'], parts), []);
  assert.deepEqual(suitesFor(['src/ai/mail.py'], facts.all, facts), []);   // Why (1 Nov 2026, owner via a8, 6/6a-2): qualityai is night-report, so no push or PR picks it, not even for its mail part; a person can still name qualityai:mail
  assert.deepEqual(suitesNamed('qualityai:mail', facts.all), ['qualityai']);
  const plan = async env => JSON.parse((await planRun({env: {REPO: 'o/r', SHA: 'a'.repeat(40), ...env}, gh: () => '[]', ...facts})).matrix).include.find(leg => leg.suite === 'qualityai');
  assert.deepEqual((await plan({EVENT: 'workflow_dispatch', ONLY: 'qualityai:mail'})).qualityParts, ['mail']);
  const push = await planRun({env: {EVENT: 'push', REPO: 'o/r', SHA: 'head', BEFORE: 'base'},
    gh: args => args.join(' ').includes('/compare/') ? 'src/ai/mail.py' : '[]', ...facts});
  assert.ok(!JSON.parse(push.matrix).include.some(leg => leg.suite === 'qualityai'), 'a push touching the mail prompt planned qualityai');
  assert.equal(await plan({EVENT: 'workflow_dispatch', ONLY: 'qualityai', PR_SUITES: 'qualityai', PR_STEPS: JSON.stringify({'(parts)': {qualityai: ['mail']}})}), undefined, 'a stale PR dispatch planned qualityai');
  for (const env of [{EVENT: 'schedule'}, {EVENT: 'gate', GATE_TAG: 'desktop-v9.9'}, {EVENT: 'workflow_dispatch', ONLY: 'qualityai'}]) {
    const leg = await plan(env);
    if (leg) assert.deepEqual(leg.qualityParts, ['journey']);
  }
});

test('mail eval reports low and strict misses as counts; an unexplained eval crash stays red', async () => {
  let calls = 0;
  const ctx = {engine: 'api', key: 'dummy', needs: [], run: async (_name, fn) => fn()};
  const evalWith = output => runMailReading(ctx, {
    execFile: (_python, args, options, done) => {
      calls++;
      assert.match(args[0], /tools[\\/]mail_eval.py$/);
      assert.equal(options.env.ANTHROPIC_API_KEY, DUMMY_KEY);
      done({code: 1}, output, 'refused or out of credit');
    },
  });
  assert.deepEqual(await evalWith('MISS rejection [strict]\n3/16 right (19%, needs 85%)'), {right: 3, total: 16, strictFailed: 1});
  await assert.rejects(evalWith(''), /the eval did not run/);
  assert.equal(calls, 2);
  assert.deepEqual(qualityRates({mail: {right: 3, total: 16, strictFailed: 1, text: 'private'}}).mail, {right: 3, total: 16, strictFailed: 1});
});


test('a pretty-printed mail-only CI matrix uses the light context and writes only mail rates', async t => {
  const os = await import('node:os');
  const path = await import('node:path');
  const child = await import('node:child_process');
  const {syncBuiltinESMExports} = await import('node:module');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-mail-'));
  const saved = process.env.E2E_QUALITY_PARTS;
  t.after(() => { if (saved === undefined) delete process.env.E2E_QUALITY_PARTS; else process.env.E2E_QUALITY_PARTS = saved; fs.rmSync(dir, {recursive: true, force: true}); });
  process.env.E2E_QUALITY_PARTS = JSON.stringify(['mail'], null, 2);
  let evals = 0;
  t.mock.method(child.default, 'execFile', (_python, _args, _options, done) => { evals++; done(null, '16/16 right (100%, needs 85%)', ''); });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const mailOnly = await import('../suites/qualityai.mjs?mail-only');
  assert.equal(mailOnly.light, true);
  await mailOnly.run({engine: 'openai', needs: [], ARTIFACTS: dir, run: async (_name, fn) => fn(), get page() { assert.fail('mail must never start the Jobs journey'); }});
  assert.equal(evals, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'quality-rates.json'))), {...qualityRates(), mail: {right: 16, total: 16, strictFailed: 0}});
});


// The real modelFetch resolver must choose the Codex broker; any Anthropic request is a tripwire.
test('mail SDK request uses the existing Codex judge provider, without handing Python provider keys', async t => {
  const os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-provider-'));
  const saved = {...process.env}, localFetch = globalThis.fetch;
  Object.assign(process.env, {CI: '1', CI_AI_PROVIDER: 'codex', E2E_AI_PROVIDER: '', E2E_AI_PROVIDER_JUDGES: '',
    E2E_AI_ANSWERS: 'off', E2E_AI_REPLAY: '0', E2E_ARTIFACTS: dir, E2E_AI_CACHE: dir,
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid?job=mail', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fake-oidc', CODEX_BROKER_URL: 'https://broker.invalid'});
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); fs.rmSync(dir, {recursive: true, force: true}); });
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    urls.push(String(url));
    if (String(url).startsWith('https://oidc.invalid')) return new Response(JSON.stringify({value: 'fake-job-token'}));
    assert.equal(String(url), 'https://broker.invalid/call', 'no direct provider request or fallback');
    assert.equal(JSON.parse(init.body).tier, 'small');
    return new Response(JSON.stringify({reply: '{"results":[]}', model: 'test-codex', tier: 'small', tokens: {input: 1, output: 1}}));
  });
  const measured = await runMailReading({engine: 'api', key: DUMMY_KEY, judgeKey: 'judge-only', needs: [], run: async (_name, fn) => fn()}, {
    execFile: (_python, _args, options, done) => {
      assert.equal(options.env.JOB_PILOTTO_AI_ENGINE, 'api');
      assert.equal(options.env.ANTHROPIC_API_KEY, DUMMY_KEY);
      assert.equal(options.env.OPENAI_API_KEY, undefined);
      void localFetch(`${options.env.ANTHROPIC_BASE_URL}/v1/messages`, {method: 'POST', body: JSON.stringify({model: 'claude-haiku-5-5', messages: [{role: 'user', content: 'invented mail'}]})})
        .then(async response => { assert.equal(response.status, 200); assert.equal((await response.json()).content[0].text, '{"results":[]}'); done(null, '16/16 right (100%, needs 85%)', ''); })
        .catch(error => done(error, '', error.message));
    },
  });
  assert.deepEqual(measured, {right: 16, total: 16, strictFailed: 0});
  assert.equal(urls.length, 2);
});

// Provider 401, rate-limit and spent-credit responses are skips with alert evidence, never failed suite steps.
test('mail eval did not run after 401/429/credit refusal is grey with an alert and no red/error', async t => {
  const os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-refusal-'));
  const saved = {...process.env}, localFetch = globalThis.fetch;
  Object.assign(process.env, {E2E_ARTIFACTS: dir, E2E_SUITE: 'qualityai', E2E_STEPS: '', E2E_STEP_NAMES: ''});
  t.after(() => { takeCapped(); for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); fs.rmSync(dir, {recursive: true, force: true}); });
  const lines = [];
  t.mock.method(console, 'log', line => lines.push(String(line)));
  t.mock.method(globalThis, 'fetch', async () => assert.fail('only the stubbed judge route may answer'));
  for (const [status, message] of [[401, 'invalid x-api-key'], [429, 'rate limit'], [400, 'Your credit balance is too low']]) {
    const runner = createRunner(() => null);
    const measured = await runMailReading({engine: 'api', key: 'app-key', judgeKey: 'judge-key', needs: [], run: runner.run}, {
      fetchImpl: async () => new Response(JSON.stringify({error: {message}}), {status}),
      execFile: (_python, _args, options, done) => {
        void localFetch(`${options.env.ANTHROPIC_BASE_URL}/v1/messages`, {method: 'POST', body: JSON.stringify({model: 'test', messages: []})})
          .then(async response => { assert.equal(response.status, status); done({code: 1}, '', `the eval did not run: ${status} ${await response.text()}`); })
          .catch(error => done(error, '', error.message));
      },
    });
    assert.equal(measured, null);
    assert.equal(runner.summary(), 0);
    assert.equal(runner.results[0].status, 'skipped');
    const alert = JSON.parse(fs.readFileSync(path.join(dir, 'ai-capped.json')));
    assert.match(alert.why, new RegExp(String(status)));
    assert.ok(alert.steps.some(name => name.startsWith('mail reading:')));
  }
  assert.ok(lines.some(line => line.startsWith('::warning title=AI refused::')));
  assert.ok(!lines.some(line => /##\[error\]|::error|^✗/.test(line)));
});


test('mail permission, server and malformed-request faults stay red rather than becoming AI refusals', async t => {
  const localFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async () => assert.fail('only the stubbed judge transport may answer'));
  for (const [status, message] of [[403, 'permission denied'], [503, 'server crashed'], [400, 'invalid credit-card field in request']]) {
    const runner = createRunner(() => null);
    await assert.rejects(runMailReading({needs: [], run: runner.run}, {
      fetchImpl: async () => new Response(JSON.stringify({error: {message}}), {status}),
      execFile: (_python, _args, options, done) => {
        void localFetch(`${options.env.ANTHROPIC_BASE_URL}/v1/messages`, {method: 'POST', body: '{"messages":[]}'})
          .then(async response => done({code: 1}, '', `${response.status} ${await response.text()}`))
          .catch(error => done(error, '', error.message));
      },
    }), /the eval did not run/);
    assert.equal(runner.summary(), 1);
    assert.equal(runner.results[0].status, 'failed');
    assert.equal(takeCapped(), null);
  }
});
