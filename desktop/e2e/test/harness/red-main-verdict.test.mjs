// "Does a red on main stop a beta?" (owner, 1 Nov 2026: "Safety strict, rest tolerant"; a8's option "Same rule as the beta"): only a failed safety or data step does; every other red
// goes on and is listed; results that cannot be read stop it. The recorded tables are steps.json as lib/runner.mjs writes them. Tonight's case: applyflows, run 41267492981.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {judgeReds, notBlockingLine} from '../../lib/red-main-verdict.mjs';
import {verdictOfReds} from '../../../../tools/red-main-verdict.mjs';

const SIGN_UP = 'a sign-up page before the form: the account step is kept apart from the application form';
const table = (...results) => ({v: 1, suite: 'x', results});
const failed = (name, extra = {}) => ({name, status: 'failed', note: 'waitForFunction timed out (30000 ms)', ...extra});
const passed = name => ({name, status: 'passed', seconds: 3});
const red = (suite, tables, runId = '41267492981') => ({suite, runId, tables});

test('(a) a red step that is neither safety nor data lets the beta go on and is listed', () => {
  const verdict = judgeReds([red('apply', [{name: 'e2e-view-apply', table: table(passed('one'), failed('two'))}])]);
  assert.equal(verdict.block, false);
  assert.deepEqual(verdict.notBlocking, ['apply · two']);
  assert.equal(verdict.line, 'Red on main, not safety or data: apply · two');
});

test('(b) a red safety step stops it, even beside a tolerable one', () => {
  const verdict = judgeReds([red('apply', [{name: 'e2e-view-apply', table: table(failed('plain'), failed('stop halts', {safety: true}))}])]);
  assert.equal(verdict.block, true);
  assert.deepEqual(verdict.reasons, ['apply · stop halts: a safety step failed']);
  assert.deepEqual(verdict.notBlocking, ['apply · plain']);
});

test('(c) a red data step stops it', () => {
  const verdict = judgeReds([red('store', [{name: 'e2e-view-store', table: table(failed('move keeps data', {data: true}))}])]);
  assert.equal(verdict.block, true);
  assert.match(verdict.reasons[0], /^store · move keeps data: a data step failed$/);
});

test('(d) results that cannot be read stop it, and say why: no artifact, an unreadable table, a read that threw, a red with no failed step', () => {
  const cases = [
    [{suite: 'a', runId: '1', tables: []}, /a \(run 1\): its results could not be read \(no steps\.json/],
    [{suite: 'b', runId: '2', tables: [{name: 'e2e-view-b', table: null}]}, /e2e-view-b has no readable steps\.json/],
    [{suite: 'c', runId: '3', error: 'HTTP 502'}, /c \(run 3\): its results could not be read \(HTTP 502\)/],
    [red('d', [{name: 'e2e-view-d', table: table(passed('only'))}]), /red, but no failed step is recorded/],
  ];
  for (const [found, why] of cases) {
    const verdict = judgeReds([found]);
    assert.equal(verdict.block, true, found.suite);
    assert.match(verdict.reasons[0], why);
  }
});

test('(e) tonight: applyflows, the sign-up step red in run 41267492981, goes on and is listed by its full name', () => {
  const verdict = judgeReds([red('applyflows', [{name: 'e2e-view-applyflows-1of2', table: table(passed('a'))}, {name: 'e2e-view-applyflows-2of2', table: table(passed('b'), failed(SIGN_UP))}])]);
  assert.equal(verdict.block, false);
  assert.equal(verdict.line, `Red on main, not safety or data: applyflows · ${SIGN_UP}`);
});

test('a step cut by the suite budget stops it: it never ran, so its safety mark is unknown', () => {
  const verdict = judgeReds([red('apply', [{name: 'e2e-view-apply', table: table({name: 'a safety step', status: 'failed', note: 'not run: the suite was over its 40-minute budget', budget: true})}])]);
  assert.equal(verdict.block, true);
  assert.match(verdict.reasons[0], /over its budget/);
});

test('one unreadable suite stops it even when another red suite is tolerable', () => {
  const verdict = judgeReds([red('apply', [{name: 'e2e-view-apply', table: table(failed('plain'))}]), {suite: 'jobs', runId: '9', tables: []}]);
  assert.equal(verdict.block, true);
  assert.deepEqual(verdict.notBlocking, ['apply · plain']);
});

test('a step red on both store legs is listed once; nothing red tolerated gives no line', () => {
  const both = judgeReds([red('apply', [{name: 'e2e-view-apply-standin', table: table(failed('plain'))}, {name: 'e2e-view-apply-sqlite', table: table(failed('plain'))}])]);
  assert.deepEqual(both.notBlocking, ['apply · plain']);
  assert.equal(notBlockingLine([]), '');
});

test('the reader picks the artifacts of the red suite only (store legs and shards of it), and a table that throws blocks', async () => {
  const tables = {'e2e-view-apply-1of2': table(failed('plain')), 'e2e-view-apply-2of2': table(passed('ok')), 'e2e-view-jobs': table(failed('other suite', {safety: true}))};
  const io = {names: async () => [...Object.keys(tables), 'e2e-coverage-apply-1of2', 'e2e-view-applyflows'], failedSuites: async () => new Set(['apply']), stepsOf: async (runId, name) => tables[name]};
  const verdict = await verdictOfReds([{runId: '5', suites: ['apply']}], io);
  assert.equal(verdict.block, false);
  assert.deepEqual(verdict.notBlocking, ['apply · plain']);
  const broken = await verdictOfReds([{runId: '5', suites: ['apply']}], {...io, stepsOf: async () => { throw new Error('expired'); }});
  assert.equal(broken.block, true);
  const down = await verdictOfReds([{runId: '5', suites: ['apply']}], {names: async () => { throw new Error('HTTP 502\nmore'); }, failedSuites: async () => new Set(['apply'])});
  assert.match(down.reasons[0], /\(HTTP 502\)/);
});

test('a suite that came back green in the re-check is not judged; only the suites with a failed job are', async () => {
  const tables = {'e2e-view-apply': table(passed('ok')), 'e2e-view-employers': table(failed('plain'))};
  const io = {names: async () => Object.keys(tables), failedSuites: async () => new Set(['employers']), stepsOf: async (runId, name) => tables[name]};
  const verdict = await verdictOfReds([{runId: '99', suites: ['apply', 'employers']}], io);
  assert.equal(verdict.block, false, verdict.reasons.join('; '));
  assert.deepEqual(verdict.notBlocking, ['employers · plain']);
});

test('a red run where none of the asked suites has a failed job, or whose jobs cannot be read, stops the beta', async () => {
  const none = await verdictOfReds([{runId: '99', suites: ['apply']}], {names: async () => [], failedSuites: async () => new Set()});
  assert.equal(none.block, true);
  assert.match(none.reasons[0], /none of these suites has a failed job/);
  const unreadable = await verdictOfReds([{runId: '99', suites: ['apply']}], {names: async () => [], failedSuites: async () => { throw new Error('HTTP 502'); }});
  assert.equal(unreadable.block, true);
  assert.match(unreadable.reasons[0], /its jobs could not be read: HTTP 502/);
});
