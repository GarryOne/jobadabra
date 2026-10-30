// Prove stored prompt joins and drift reporting remain deterministic and entirely offline.
// Job: serve stored answers
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {loadTable, message, storedAnswer, recordCandidate, keepCandidate, keepCandidateBody} from '../lib/ai-answers.mjs';
import {seedRequests, serializeRequests} from '../../../tools/seed-ai-answer-requests.mjs';
import {loadRequests, resolveRequest, pickSample, compareAnswer, buildReport} from '../lib/answer-drift.mjs';

const fixture = new URL('../fixtures/golden/ai-answer-requests.json', import.meta.url);
const table = loadTable();
const tmp = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'answer-drift-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
};
const forbidNetwork = t => t.mock.method(globalThis, 'fetch', () => { throw new Error('network forbidden'); });

// Removing the oldest-first selection, or allowing one kind to consume the sample, breaks this test.
test('sample rotates oldest first within each kind and spreads slots across kinds', () => {
  const entries = ['a', 'b', 'c'].flatMap(kind => Array.from({length: 4}, (_, n) => ({id: `${kind}${n}`, kind})));
  const history = Object.fromEntries(entries.filter(e => e.id.endsWith('0')).map(e => [e.id, '2026-10-30']));
  const first = pickSample(entries, history, 6);
  assert.deepEqual(first.map(e => e.id), ['a1', 'b1', 'c1', 'a2', 'b2', 'c2']);
  for (const entry of first) history[entry.id] = {lastChecked: '2026-10-31'};
  assert.deepEqual(pickSample(entries, history, 3).map(e => e.id), ['a3', 'b3', 'c3']);
  assert.equal(pickSample(entries, {}, 0).length, 0);
  assert.equal(pickSample(Array.from({length: 30}, (_, n) => ({id: String(n), kind: 'x'}))).length, 20);
  assert.deepEqual(pickSample([...entries].reverse(), {}, 5), pickSample(entries, {}, 5));
});

test('seeding is byte deterministic, body-reference-only and links the measured 268 plus 3 keys', t => {
  forbidNetwork(t);
  const entries = seedRequests();
  assert.equal(serializeRequests(entries), fs.readFileSync(fixture, 'utf8'));
  assert.equal(serializeRequests(seedRequests()), serializeRequests(entries));
  assert.equal(new Set(entries.map(e => e.id)).size, entries.length);
  assert.equal(new Set(entries.map(e => e.source.sha256)).size, entries.length);
  const linked = new Set(entries.flatMap(e => e.keys.map(key => `${e.kind}/${key}`)));
  assert.equal(linked.size, 271);
  const historic = new Set(entries.filter(e => e.provenance !== 'sender capture').flatMap(e => e.keys.map(key => `${e.kind}/${key}`)));
  assert.equal(historic.size, 268);
  assert.deepEqual(new Set(entries.map(e => e.provenance)), new Set(['captured', 'reconstructed', 'sender capture']));
  for (const entry of entries) {
    assert.ok(!('body' in entry));
    assert.ok(entry.source.file.endsWith('.json'));
    assert.equal(entry.source.sha256.length, 64);
  }
  assert.equal(fs.readFileSync(fixture, 'utf8').trim().split('\n').length, entries.length + 2);
});

test('seeding links a promoted record-mode request to its original answer key', t => {
  forbidNetwork(t);
  const dir = tmp(t), golden = path.join(dir, 'golden'), file = path.join(dir, 'empty.json');
  fs.cpSync(new URL('../fixtures/golden/', import.meta.url), golden, {recursive: true});
  fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}}));
  const request = {headers: {'x-jp-action': 'score'}, body: {messages: [{role: 'user',
    content: 'Title: Record-mode Engineer\nCompany: Fixture Recorder\nLocation: Zurich'}]}};
  const state = storedAnswer(request, {E2E_AI_ANSWERS: 'record', E2E_AI_ANSWERS_FILE: file, E2E_AI_CANDIDATES: dir});
  const reply = message('{"score":80}');
  recordCandidate(state.dir, state.question, reply, state.request);
  const candidate = loadTable(path.join(dir, 'ai-answers-candidates.json'));
  const promoted = path.join(golden, 'ai-answers.json');
  fs.writeFileSync(promoted, JSON.stringify({v: 1, answers: candidate.answers, requests: candidate.requests}));
  const loaded = loadTable(promoted);
  assert.deepEqual(loaded.answers, {[state.question.operation]: {[state.question.id]: {reply}}});
  assert.deepEqual(loaded.requests, candidate.requests);
  const entries = seedRequests({golden});
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.kind, 'app.score');
  assert.deepEqual(entry.keys, [state.question.id]);
  assert.equal(entry.provenance, 'captured');
  assert.equal(entry.action, 'score');
  assert.equal(entry.source.file, 'ai-answers.json');
  assert.deepEqual(entry.source.path, ['requests', 'app.score', state.question.id, 'body']);
  const resolved = resolveRequest(entry, {golden, table: loaded});
  assert.deepEqual(resolved.request.body, request.body);
  assert.deepEqual(resolved.rows, [{key: state.question.id, stored: {score: 80}}]);
});

test('every seeded entry resolves only to existing stored keys; a bogus key is refused', t => {
  forbidNetwork(t);
  for (const entry of loadRequests()) {
    const resolved = resolveRequest(entry, {table});
    assert.deepEqual(resolved.rows.map(row => row.key).sort(), [...entry.keys].sort());
    assert.equal(resolved.question.operation, entry.kind);
    assert.ok(resolved.rows.every(row => row.stored !== undefined));
  }
  const entry = loadRequests()[0];
  assert.throws(() => resolveRequest({...entry, keys: [...entry.keys, 'bogus-key']}, {table}), /stored key|unknown key/i);
});

test('a stale body hash refuses the sample before any transport can run', async () => {
  const entry = {...loadRequests()[0], source: {...loadRequests()[0].source, sha256: '0'.repeat(64)}};
  let calls = 0;
  await assert.rejects(buildReport({entries: [entry], table, transport: async () => { calls++; }}), /stale.*sha|sha.*stale/i);
  assert.equal(calls, 0);
});

test('exact enums, booleans, dates and ids compare same, changed and missing fields', () => {
  assert.equal(compareAnswer('app.decide', 'yes', 'yes').status, 'same');
  assert.equal(compareAnswer('app.decide', 'yes', 'no').status, 'changed');
  assert.equal(compareAnswer('app.title', false, false).status, 'same');
  const options = {schema: {properties: {tier: {enum: ['A', 'B']}}}};
  const stored = {tier: 'A', enabled: false, application: 2, posted: '2026-10-01'};
  assert.equal(compareAnswer('app.score', stored, {...stored}, options).status, 'same');
  const changed = compareAnswer('app.score', stored, {...stored, application: 3}, options);
  assert.equal(changed.fields.find(f => f.path === 'application').status, 'changed');
  const missing = compareAnswer('app.score', stored, {tier: 'A'}, options);
  assert.equal(missing.fields.find(f => f.path === 'enabled').status, 'missing');
});

test('numeric changes record their signed delta without a tolerance or an agreement vote', () => {
  const compared = compareAnswer('app.score', {score: 80}, {score: 79});
  assert.equal(compared.status, 'numeric-delta');
  assert.deepEqual(compared.fields[0], {path: 'score', stored: 80, live: 79, status: 'numeric-delta', delta: -1});
  assert.equal(compared.exact.checked, 0);
  const geo = compareAnswer('app.geo', {kind: 'city', cc: 'CH', lat: 47, lon: 8, r_km: 20}, {kind: 'unknown', cc: '', lat: 0, lon: 0, r_km: 0});
  assert.ok(geo.notes.includes('unknown-sentinel'));
  assert.ok(compareAnswer('app.geo', {lat: 47}, {lat: 91}).notes.includes('range-violation:lat'));
});

test('prose needs a judge even when the strings match; normalized place sets ignore order', () => {
  for (const live of ['A strong match.', 'Another phrasing.']) {
    const compared = compareAnswer('app.score', {reason: 'A strong match.'}, {reason: live});
    assert.equal(compared.status, 'needs-judge');
    assert.equal(compared.exact.checked, 0);
  }
  const place = {kind: 'city', countries: ['Switzerland'], names: ['Zürich', 'Zurich']};
  assert.equal(compareAnswer('app.places', place, {...place, names: ['zurich'], countries: ['switzerland']}).status, 'same');
  assert.equal(compareAnswer('app.places', place, {...place, names: ['Zuerich']}).status, 'needs-judge');
});

test('enrichment evidence is checked against the supplied posting', () => {
  const options = {posting: 'Run Kubernetes in production.'};
  assert.ok(compareAnswer('app.enrich', {evidence: 'Kubernetes'}, {evidence: 'Invented'}, options).notes.includes('ungrounded-evidence:evidence'));
});

test('enrichment reports ground evidence in the posting body rather than its identity header', async () => {
  const entry = loadRequests().find(e => e.kind === 'app.enrich' && e.keys.some(key => key.endsWith('/full')));
  const resolved = resolveRequest(entry, {table}), live = structuredClone(resolved.rows[0].stored);
  live.english_is_enough.evidence = resolved.request.body.messages[0].content.split('\n')[0];
  const report = await buildReport({entries: [entry], table, transport: async () => message(JSON.stringify(live))});
  assert.ok(report.changedKeys[0].notes.includes('ungrounded-evidence:english_is_enough.evidence'));
});

test('dry reports count an unlinked key as a gap and make no calls', async t => {
  forbidNetwork(t);
  const entries = loadRequests();
  const report = await buildReport({entries, table});
  assert.deepEqual(report.coverage, {total: 562, eligible: 271, unlinked: 291, checked: 0, unjudged: 0});
  assert.equal(report.sample.length, 20);
  assert.equal(report.callsUsed.total, 0);
  const expanded = structuredClone(table);
  expanded.items['app.title']['unlinked-new-key'] = {text: 'New title', answer: false};
  const next = await buildReport({entries, table: expanded});
  assert.equal(next.kinds['app.title'].unlinked, report.kinds['app.title'].unlinked + 1);
});

test('fake transport compares per-key booleans including negative selections and reports changes', async t => {
  forbidNetwork(t);
  const entry = loadRequests().find(e => e.kind === 'app.title');
  const resolved = resolveRequest(entry, {table});
  // The existing parser supplies request-local selectors, so this never guesses them from a key.
  const selections = resolved.question.items.filter(item => table.items[entry.kind][item.key]?.answer).map(item => item.n);
  const body = resolved.request.body;
  const root = Object.keys(body.output_config.format.schema.properties)[0];
  const reply = message(JSON.stringify({[root]: selections}));
  const report = await buildReport({entries: [entry], table, transport: async request => { assert.deepEqual(request.body, body); return reply; }});
  assert.equal(report.callsUsed.app, 1);
  assert.equal(report.callsUsed.judge, 0);
  assert.equal(report.kinds[entry.kind].checked, entry.keys.length);
  assert.equal(report.changedKeys.length, 0);
  const changed = await buildReport({entries: [entry], table, transport: async () => message(JSON.stringify({[root]: selections.includes(1) ? selections.filter(n => n !== 1) : [...selections, 1]}))});
  assert.ok(changed.changedKeys.some(row => row.key === resolved.question.items[0].key));
  assert.equal(changed.results[0].provenance, entry.provenance);
  assert.equal(changed.kinds[entry.kind].callsUsed.app, 1);
  assert.ok(changed.kinds[entry.kind].changedKeys.length);
  assert.ok(changed.kinds[entry.kind].provenance[entry.provenance]);
});

test('fake score transport leaves prose unjudged, records numeric deltas and counts attempted calls', async () => {
  const entry = loadRequests().find(e => e.kind === 'app.score');
  const stored = resolveRequest(entry, {table}).rows[0].stored;
  const report = await buildReport({entries: [entry], table, transport: async () => message(JSON.stringify({...stored, score: stored.score + 1}))});
  assert.equal(report.kinds['app.score'].unjudged, 1);
  assert.equal(report.kinds['app.score'].checked, 1);
  assert.ok(report.changedKeys[0].fields.some(f => f.path === 'score' && f.delta === 1));
  const failed = await buildReport({entries: [entry], table, transport: async () => { throw new Error('unavailable'); }});
  assert.equal(failed.callsUsed.total, 1);
  assert.equal(failed.kinds['app.score'].checked, 0);
  assert.equal(failed.results[0].error, 'unavailable');
});

test('malformed transport replies cannot appear as agreements', async () => {
  const entry = loadRequests().find(e => e.kind === 'app.score');
  for (const reply of [undefined, message('{"score":80}'), {...message('{}'), stop_reason: 'max_tokens'}]) {
    const report = await buildReport({entries: [entry], table, transport: async () => reply});
    assert.equal(report.results[0].invalidReply, true);
    assert.equal(report.changedKeys[0].status, 'changed');
    assert.equal(report.kinds[entry.kind].callsUsed.total, 1);
  }
});

test('invalid geographic rows retain numeric deltas and range diagnostics without agreement votes', async () => {
  const entry = loadRequests().find(e => e.kind === 'app.geo');
  const resolved = resolveRequest(entry, {table});
  const places = resolved.question.items.map(item => ({n: item.n, ...(table.items[entry.kind][item.key]?.answer || {kind: 'unknown', cc: '', lat: 0, lon: 0, r_km: 0})}));
  const first = places.find(row => entry.keys.includes(resolved.question.items.find(item => item.n === row.n).key));
  first.kind = 'city'; first.cc = 'CH'; first.lat = 91;
  const report = await buildReport({entries: [entry], table, transport: async () => message(JSON.stringify({places}))});
  assert.equal(report.results[0].invalidReply, true);
  const row = report.changedKeys.find(row => row.notes.includes('range-violation:lat'));
  assert.ok(row);
  assert.ok(row.fields.some(field => field.path === 'lat' && 'delta' in field));
  assert.equal(row.exact.checked, 0, 'invalid batches never provide evidence of agreement');
});

test('unchanged unknown sentinels and identical unjudged prose are not listed as changed keys', async () => {
  for (const kind of ['app.geo', 'app.score']) {
    const entry = loadRequests().find(e => e.kind === kind);
    const resolved = resolveRequest(entry, {table});
    const reply = kind === 'app.score' ? message(JSON.stringify(resolved.rows[0].stored)) : message(JSON.stringify({places: resolved.question.items.map(item => ({n: item.n, ...(table.items[kind][item.key]?.answer || {kind: 'unknown', cc: '', lat: 0, lon: 0, r_km: 0})}))}));
    const report = await buildReport({entries: [entry], table, transport: async () => reply});
    assert.equal(report.changedKeys.length, 0);
    if (kind === 'app.score') assert.equal(report.kinds[kind].unjudged, 1);
  }
});

test('record mode keeps a sanitized request beside complete and per-item candidates without breaking readers', t => {
  const dir = tmp(t), file = path.join(dir, 'table.json');
  fs.writeFileSync(file, JSON.stringify({v: 1, answers: {}, items: {}}));
  const env = {E2E_AI_ANSWERS: 'record', E2E_AI_ANSWERS_FILE: file, E2E_AI_CANDIDATES: dir};
  for (const kind of ['app.score', 'app.decide']) {
    const entry = loadRequests().find(e => e.kind === kind);
    const resolved = resolveRequest(entry, {table});
    const request = {...resolved.request, headers: {...resolved.request.headers, authorization: 'secret-header'}, body: {...resolved.request.body, metadata: {secret: 'omit'}}};
    const state = storedAnswer(request, env);
    const reply = kind === 'app.score' ? message(JSON.stringify(resolved.rows[0].stored)) : message(JSON.stringify({results: resolved.question.items.map(item => ({index: item.index, answer: resolved.question.context.allowedAnswers.split(', ')[0]}))}));
    if (kind === 'app.score') keepCandidate(state, reply);
    else keepCandidateBody(state, JSON.stringify(reply));
  }
  const candidates = fs.readdirSync(dir).filter(name => name.startsWith('ai-answers-') && name.endsWith('.json'));
  assert.ok(candidates.some(name => name.startsWith('ai-answers-item-')));
  for (const name of candidates) {
    const candidate = loadTable(path.join(dir, name));
    for (const entries of Object.values(candidate.requests)) for (const value of Object.values(entries)) {
      assert.ok(value.body.messages);
      assert.equal(value.body.metadata, undefined);
      assert.equal(value.headers, undefined);
    }
    assert.doesNotMatch(fs.readFileSync(path.join(dir, name), 'utf8'), /secret-header|omit/);
  }
  assert.deepEqual(loadTable(file).answers, {});
});

test('CLI defaults to dry-run, prints sample and coverage, and rejects live mode', () => {
  const cli = new URL('../answer-drift.mjs', import.meta.url);
  const run = args => spawnSync(process.execPath, [cli.pathname, ...args], {encoding: 'utf8', env: {PATH: process.env.PATH}});
  const defaultRun = run([]), explicit = run(['--dry-run']);
  assert.equal(defaultRun.status, 0, defaultRun.stderr);
  assert.equal(defaultRun.stdout, explicit.stdout);
  const result = JSON.parse(defaultRun.stdout);
  assert.equal(result.coverage.unlinked, 291);
  assert.equal(result.sample.length, 20);
  assert.equal(result.callsUsed.total, 0);
  assert.notEqual(run(['--live']).status, 0);
});

// Live tests keep the real relay and judge path but replace the broker boundary; fetch must never run.
const liveEnv = {CI: 'true', GITHUB_ACTIONS: 'true', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fake'};
const liveModule = () => import('../lib/answer-drift-live.mjs');
const rateModule = () => import('../lib/answer-drift-rate.mjs');
const proseEntries = (count = 20) => {
  const entry = loadRequests().find(e => e.kind === 'app.score');
  return Array.from({length: count}, (_, n) => ({...entry, id: `score-${n}`}));
};
const fakeBroker = (verdict = 'same-meaning') => async body => {
  const data = body.system?.includes('Compare the meaning of two replies')
    ? message(JSON.stringify({verdict, reason: 'Same facts and conclusions.'}))
    : message(JSON.stringify(resolveRequest(proseEntries(1)[0], {table}).rows[0].stored));
  return {ok: true, model: 'fake-codex', message: data};
};

test('live uses fresh Codex relay and suite judges: 20 prompts + 4 judges; remaining prose is not agreement', async t => {
  forbidNetwork(t);
  const {runLive} = await liveModule();
  const report = await runLive({entries: proseEntries(), env: {...liveEnv, CI_AI_PROVIDER: 'claude', E2E_AI_ANSWERS: 'backbone', E2E_AI_REPLAY: '1', E2E_AI_CACHE: '/must-not-write'}, ask: fakeBroker()});
  assert.deepEqual(report.callsUsed, {app: 20, judge: 4, total: 24});
  assert.equal(report.complete, true);
  const fields = report.results.flatMap(r => r.checks.flatMap(c => c.fields));
  assert.equal(fields.filter(f => f.judgment).length, 4);
  assert.ok(fields.some(f => f.status === 'needs-judge' && !f.judgment));
  assert.equal(fields.filter(f => f.judgment?.verdict === 'same-meaning').length, 4);
});

test('every attempt including a retry consumes the same 24-call cap', async t => {
  forbidNetwork(t);
  const {callBudget} = await liveModule();
  const budget = callBudget(async () => ({ok: true}));
  for (let n = 0; n < 24; n++) await budget.ask({}, {kind: n < 20 ? 'app' : 'judge'});
  await assert.rejects(budget.ask({}, {kind: 'app'}), /24.*attempt/i);
  assert.equal(budget.counts.total, 24);
});

test('429, auth and unreachable stop immediately and incomplete nights supply no healthy evidence', async t => {
  forbidNetwork(t);
  const {runLive} = await liveModule();
  const {finalizeNight} = await rateModule();
  for (const status of ['capped', 401, 403, 'no-token', 'unreachable']) {
    const report = await runLive({entries: proseEntries(), env: liveEnv, ask: async () => ({ok: false, status, detail: `broker ${status}`})});
    assert.equal(report.complete, false);
    assert.match(report.incompleteReason, /broker/);
    assert.equal(report.callsUsed.total, 1);
    assert.equal(report.results.length, 1);
    const saved = finalizeNight(report, [], {runId: '1', day: '2026-10-30'});
    assert.equal(saved.report.verdict.state, 'incomplete');
    assert.equal(saved.report.rates.facts.total, 0);
  }
});

test('judges receive original prompt plus both replies; invalid verdicts stay incomplete and unjudged', async t => {
  forbidNetwork(t);
  const {runLive} = await liveModule();
  let context;
  const base = fakeBroker();
  const report = await runLive({entries: proseEntries(1), env: liveEnv, ask: async body => {
    if (!body.system?.includes('Compare the meaning of two replies')) return base(body);
    context = JSON.parse(body.messages[0].content);
    return {ok: true, model: 'fake', message: message('{"verdict":"yes"}')};
  }});
  assert.ok(context.originalPrompt.messages.length);
  assert.ok(context.answerKey);
  assert.deepEqual(context.storedReply, context.liveReply);
  assert.equal(report.complete, false);
  assert.match(report.incompleteReason, /judge/);
  assert.equal(report.kinds['app.score'].callsUsed.judge, 1);
  assert.ok(report.results[0].checks[0].fields.some(f => f.status === 'needs-judge' && !f.judgment));
});

const nightReport = ({fingerprint = 'aaa', exact = 0, different = 4, complete = true} = {}) => ({
  mode: 'live', complete, callsUsed: {app: 20, judge: 4, total: 24},
  sample: [{id: 'p', kind: 'app.score', source: {sha256: fingerprint}}],
  results: [{id: 'p', kind: 'app.score', bodySha256: fingerprint, checks: [{kind: 'app.score', key: 'key', stored: {answer: 'old'}, live: {answer: 'new'},
    status: 'changed', exact: {checked: 100, same: exact}, fields: Array.from({length: 4}, (_, n) => ({path: `reason${n}`, status: 'needs-judge', judgment: {verdict: n < different ? 'different' : 'same-meaning', reason: 'changed meaning'}}))}]}],
});

test('warm-up warns, mature rate breaks turn red, two consecutive red nights produce one issue payload', async () => {
  const {finalizeNight} = await rateModule();
  let history = [], result;
  for (let n = 1; n <= 6; n++) {
    result = finalizeNight(nightReport(), history, {runId: String(n), day: `2026-10-${20 + n}`});
    history = result.history;
    assert.equal(result.report.verdict.state, n < 5 ? 'warning' : 'red');
    assert.equal(Boolean(result.report.issue), n >= 6);
  }
  assert.match(result.report.issue.body, /key[\s\S]*old[\s\S]*new/);
  assert.equal(result.report.issue.title, 'Stored AI answers drift from the live model');
  assert.match(result.report.markdown, /99.5%/);
  assert.equal(finalizeNight(nightReport({exact: 100, different: 0}), history, {runId: '6', day: '2026-10-26'}).history.length, 6);
  const dispatch = finalizeNight(nightReport(), history.slice(1), {runId: 'manual', day: '2026-10-25'});
  assert.equal(dispatch.report.issue, null, 'same date is never a second night');
});

test('rates keep only 10 fact nights and about 90 judged texts; needs-judge never votes', async () => {
  const {finalizeNight} = await rateModule();
  let history = [], result;
  for (let n = 0; n < 30; n++) {
    const report = nightReport({exact: 100, different: 0});
    report.results[0].checks[0].fields.push({path: 'unjudged', status: 'needs-judge'});
    result = finalizeNight(report, history, {runId: String(n), day: new Date(Date.UTC(2026, 8, n + 1)).toISOString().slice(0, 10)});
    history = result.history;
  }
  assert.equal(result.report.rates.facts.nights, 10);
  assert.equal(result.report.rates.flags.texts, 92);
  assert.equal(result.report.rates.flags.flagged, 0);
  assert.equal(result.report.verdict.state, 'healthy');
});

test('fingerprint changes reset only that prompt history and report prompt drift', async () => {
  const {finalizeNight} = await rateModule();
  const old = finalizeNight(nightReport(), [], {runId: '1', day: '2026-10-29'});
  const fresh = finalizeNight(nightReport({fingerprint: 'bbb', exact: 100, different: 0}), old.history, {runId: '2', day: '2026-10-30'});
  assert.deepEqual(fresh.report.promptDrift.map(p => p.id), ['p']);
  assert.equal(fresh.report.rates.facts.total, 100);
  assert.equal(fresh.report.rates.facts.exact, 100);
  assert.equal(fresh.report.issue, null);
});

test('live CLI refuses without OIDC before invoking a broker', async () => {
  const {main} = await import('../answer-drift.mjs');
  await assert.rejects(main(['--live'], {env: {CI: 'true'}}), /OIDC/);
});

test('nightly workflow is isolated, Codex-pinned, caches evidence and deduplicates lasting-red issues', () => {
  const source = fs.readFileSync(new URL('../../../.github/workflows/ai-answer-drift.yml', import.meta.url), 'utf8');
  assert.match(source, /id-token: write/);
  assert.match(source, /E2E_AI_PROVIDER: codex/);
  assert.match(source, /CI_AI_PROVIDER: codex/);
  assert.match(source, /group: ai-answer-drift/);
  assert.match(source, /cancel-in-progress: false/);
  assert.match(source, /actions\/cache\/restore@v5\b/);
  assert.match(source, /actions\/cache\/save@v5\b/);
  assert.match(source, /actions\/upload-artifact@v6\b/);
  assert.match(source, /github.ref == 'refs\/heads\/main'/);
  assert.match(source, /ai-answer-drift-\$\{\{ github.run_id \}\}/);
  assert.match(source, /github\.rest\.search\.issuesAndPullRequests/);
  assert.match(source, /item\.title === issue\.title/);
  assert.match(source, /github\.rest\.issues\.update/);
  assert.match(source, /github\.rest\.issues\.create/);
  assert.doesNotMatch(source, /pull_request:|workflow_call:|secrets\.|ANTHROPIC_API_KEY|OPENAI_API_KEY/);
});

test('an incomplete rerun stays incomplete even if that run already has healthy cached evidence', async () => {
  const {finalizeNight} = await rateModule();
  const first = finalizeNight(nightReport({exact: 100, different: 0}), [], {runId: '1', day: '2026-10-30'});
  const retry = finalizeNight({...nightReport(), complete: false, incompleteReason: 'broker 429'}, first.history, {runId: '1', day: '2026-10-30'});
  assert.equal(retry.report.verdict.state, 'incomplete');
  assert.equal(retry.history.length, 1);
});

test('a lasting historical red lists earlier changed answers even when tonight agrees', async () => {
  const {finalizeNight} = await rateModule();
  let history = [];
  for (let n = 1; n <= 5; n++) history = finalizeNight(nightReport(), history, {runId: String(n), day: `2026-10-${20 + n}`}).history;
  const tonight = nightReport({exact: 100, different: 0});
  tonight.results[0].checks[0].status = 'same';
  const {report} = finalizeNight(tonight, history, {runId: '6', day: '2026-10-26'});
  assert.match(report.issue.body, /old[\s\S]*new/);
  const gap = finalizeNight(nightReport(), history, {runId: '7', day: '2026-10-27'});
  assert.equal(gap.report.issue, null, 'a missing night interrupts lasting red');
});

test('a prompt change preserves other prompts and never resurrects old votes when changed back', async () => {
  const {finalizeNight} = await rateModule();
  const both = nightReport();
  both.sample.push({id: 'q', source: {sha256: 'qqq'}});
  both.results.push({...structuredClone(both.results[0]), id: 'q', bodySha256: 'qqq'});
  const old = finalizeNight(both, [], {runId: '1', day: '2026-10-28'});
  const next = finalizeNight(nightReport({fingerprint: 'bbb', exact: 100}), old.history, {runId: '2', day: '2026-10-29'});
  assert.equal(next.report.rates.facts.total, 200);
  assert.equal(next.report.rates.facts.exact, 100);
  const back = finalizeNight(nightReport({exact: 100}), next.history, {runId: '3', day: '2026-10-30'});
  assert.equal(back.report.rates.facts.total, 200);
  assert.equal(back.report.rates.facts.exact, 100);
});

test('CLI writes both report artifacts and history with one counts-and-bars notice, entirely offline', async t => {
  forbidNetwork(t);
  const {answerFor} = await import('../lib/ai-answers.mjs');
  const {main} = await import('../answer-drift.mjs');
  const replies = new Map(loadRequests().map(entry => { const r = resolveRequest(entry, {table});
    const reply = answerFor(r.question, table).reply || message(JSON.stringify({places: r.question.items.map(item => entry.kind === 'app.geo'
      ? {n: item.n, ...(table.items[entry.kind][item.key]?.answer || {kind: 'remote', cc: '', lat: 0, lon: 0, r_km: 0})}
      : {word: item.raw, ...(table.items[entry.kind][item.key]?.answer || {kind: 'other', names: [], countries: []})})}));
    return [JSON.stringify(r.request.body), reply]; }));
  const lines = [], dir = tmp(t), history = path.join(dir, 'history.json');
  t.mock.method(console, 'log', line => lines.push(line));
  const ask = async body => body.system?.includes('Compare the meaning of two replies') ? fakeBroker()(body) : {ok: true, model: 'fake-codex', message: replies.get(JSON.stringify(body))};
  await main(['--live', '--history', history, '--out', dir], {env: {...liveEnv, GITHUB_RUN_ID: '100'}, ask, now: () => new Date('2026-10-30T04:41:00Z')});
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'ai-answer-drift.json')));
  assert.equal(report.complete, true);
  assert.equal(report.callsUsed.total, 24);
  assert.equal(JSON.parse(fs.readFileSync(history)).length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'ai-answer-drift.md'), 'utf8'), report.markdown);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^::notice::20 prompts, 4 judges, 24\/24 attempts;.*bar/);
});

test('real manifest ids change with prompt hashes: source location owns history reset, even outside the sample', async () => {
  const {finalizeNight} = await rateModule();
  const old = nightReport();
  old.sample[0].source = {file: 'captured.json', path: ['requests', 0], sha256: 'aaa'};
  const first = finalizeNight(old, [], {runId: '1', day: '2026-10-29'});
  const changed = nightReport({exact: 100, fingerprint: 'bbb'});
  changed.sample[0] = {...old.sample[0], id: 'new-manifest-id', source: {...old.sample[0].source, sha256: 'bbb'}};
  changed.results[0].id = 'new-manifest-id';
  const next = finalizeNight(changed, first.history, {runId: '2', day: '2026-10-30'});
  assert.deepEqual(next.report.promptDrift.map(p => p.id), ['new-manifest-id']);
  assert.equal(next.report.rates.facts.total, 100);
  const outsideSample = finalizeNight({...nightReport(), sample: [], results: [], prompts: changed.sample}, first.history, {runId: '3', day: '2026-10-30'});
  assert.equal(outsideSample.report.rates.facts.total, 0);
});

test('prose rate waits for 45 judgments, then fails above 10% with exact facts still healthy', async () => {
  const {finalizeNight} = await rateModule();
  let history = [];
  for (let n = 1; n <= 12; n++) {
    const result = finalizeNight(nightReport({exact: 100, different: 1}), history, {runId: String(n), day: `2026-10-${10 + n}`});
    history = result.history;
    assert.equal(result.report.verdict.state, n < 5 ? 'warning' : n < 12 ? 'healthy' : 'red');
    if (n === 12) assert.equal(result.report.rates.flags.texts, 48);
  }
});

test('workflow issue writer creates once and updates the exact-title open issue on later reports', async () => {
  const source = fs.readFileSync(new URL('../../../.github/workflows/ai-answer-drift.yml', import.meta.url), 'utf8');
  const script = source.split('          script: |\n')[1].split('\n').map(line => line.replace(/^            /, '')).join('\n');
  const run = new (Object.getPrototypeOf(async function() {}).constructor)('require', 'github', 'context', script);
  const issue = {title: 'Stored AI answers drift from the live model', body: 'Changed answer: old → new'}, open = [], updated = [];
  const github = {rest: {search: {issuesAndPullRequests: async () => ({data: {items: open}})}, issues: {
    create: async data => open.push({...data, number: 1}), update: async data => updated.push(data),
  }}};
  const requireFake = () => ({readFileSync: () => JSON.stringify({issue})});
  const context = {repo: {owner: 'fake', repo: 'fake'}, serverUrl: 'https://github.invalid', runId: 1};
  await run(requireFake, github, context); await run(requireFake, github, context);
  assert.equal(open.length, 1); assert.equal(updated.length, 1);
  assert.equal(updated[0].issue_number, 1); assert.match(updated[0].body, /old → new/);
});


test('the complete nightly import graph and every linked relay request need no package', () => {
  const script = new URL('./fixtures/answer-drift-no-packages.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [script.pathname], {encoding: 'utf8', env: {PATH: process.env.PATH}});
  assert.equal(result.status, 0, result.stderr);
  const checked = JSON.parse(result.stdout);
  assert.equal(checked.requests, loadRequests().length);
  assert.equal(checked.documentRequests, 0);
  assert.equal(checked.packageAttempts, 0);
});
