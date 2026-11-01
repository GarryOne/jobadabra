// What CI pool runs hand each other (lib/pool-ci-state.mjs): each run's small state artifact (its site ledger and its rows' results). GitHub's cache is per branch,
// so a PR's visits were invisible to main and to other PRs; states are read across all of them. -> today's CI-wide ledger, and each row's last CI result on main or
// on this PR (the baseline a run must not fall below; a blocked row on either side is never compared).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {SITE_REFUSED} from '../../lib/record-sites.mjs';
import {baselines, fallsBelow, mergeLedgers, stateOf} from '../../lib/pool-ci-state.mjs';

const visit = (at, who) => ({at, run: '4242', who});
const state = (run, branch, at, ledger = {}, results = {}) => ({run, branch, at, ledger, results});

test('today\'s ledger is every CI run\'s visits of today, each counted once, from main and every PR', () => {
  const mainRun = state('1', 'main', '2026-10-12T09:00:00Z', {'2026-10-12': {'jobs.lever.co': {visits: [visit(1, 'record-sites CI run 1')]}}});
  const prRun = state('2', 'fix-upload', '2026-10-12T10:00:00Z', {'2026-10-12': {'jobs.lever.co': {visits: [visit(1, 'record-sites CI run 1'), visit(2, 'record-sites CI run 2')], blocked: {at: 2, why: 'bot check'}},
    'join.com': {visits: [visit(3, 'record-sites CI run 2')]}}, '2026-10-11': {'join.com': {visits: [visit(0, 'record-sites CI run 0')]}}});
  assert.deepEqual(mergeLedgers([mainRun, prRun], '2026-10-12'), {'2026-10-12': {
    'jobs.lever.co': {visits: [visit(1, 'record-sites CI run 1'), visit(2, 'record-sites CI run 2')], blocked: {at: 2, why: 'bot check'}},
    'join.com': {visits: [visit(3, 'record-sites CI run 2')]}}});
  assert.deepEqual(mergeLedgers([], '2026-10-12'), {});
});

test('a row\'s baseline is its newest CI result on main or on this PR, never another PR\'s build, never this run', () => {
  const lever = reached => ({reached, filled: 11, left: 7, url: 'https://jobs.lever.co/x'});
  const states = [
    state('1', 'main', '2026-10-10T09:00:00Z', {}, {Lever: lever('form')}),
    state('2', 'other-pr', '2026-10-12T09:00:00Z', {}, {Lever: lever('posting')}),
    state('3', 'my-pr', '2026-10-11T09:00:00Z', {}, {Lever: lever('ready')}),
    state('4', 'my-pr', '2026-10-12T11:00:00Z', {}, {Lever: lever('none')}),
  ];
  assert.deepEqual(baselines(states, {branch: 'my-pr', run: '4'}), {Lever: {...lever('ready'), run: '3', branch: 'my-pr', at: '2026-10-11T09:00:00Z'}});
  assert.deepEqual(baselines(states, {branch: 'main', run: '9'}), {Lever: {...lever('form'), run: '1', branch: 'main', at: '2026-10-10T09:00:00Z'}});
});

test('falling below the baseline: an earlier step or fewer fields on the same posting; a blocked row on either side, a refusal or a gone posting never counts', () => {
  const base = {reached: 'form', filled: 11, left: 7, url: 'u', run: '3', branch: 'main'};
  assert.equal(fallsBelow(base, {reached: 'posting', url: 'u'}), 'reached posting, form in run 3 (main)');
  assert.equal(fallsBelow(base, {reached: 'form', filled: 5, left: 13, url: 'u'}), 'filled 5, 11 in run 3 (main)');
  assert.equal(fallsBelow(base, {reached: 'form', filled: 11, left: 7, url: 'u'}), '');
  assert.equal(fallsBelow(base, {reached: 'code/bot', url: 'u'}), '', 'a bot wall on the CI IP is never a fall');
  assert.equal(fallsBelow(base, {reached: 'posting', note: SITE_REFUSED, url: 'u'}), '', 'a refusal is never a fall');
  assert.equal(fallsBelow(base, {reached: 'none', note: 'posting gone (HTTP 404)', url: 'u'}), '');
  assert.equal(fallsBelow({...base, reached: 'code/bot'}, {reached: 'posting', url: 'u'}), '', 'a blocked baseline is no baseline');
  assert.equal(fallsBelow({...base, aiRefused: {calls: 3, why: 'x'}}, {reached: 'posting', url: 'u'}), '', 'a baseline that ran without AI is no baseline');
  assert.equal(fallsBelow(null, {reached: 'posting', url: 'u'}), '');
});

test('a run\'s state holds its ledger and only the rows it ran, trimmed to what the next run compares', () => {
  const report = {results: {Lever: {reached: 'form', filled: 11, left: 7, url: 'u', fieldList: [{a: 1}], kinds: ['form'], usd: 0.05}, Old: {reached: 'posting'}}, thisRun: {ran: ['Lever']}};
  assert.deepEqual(stateOf({run: '7', branch: 'main', sha: 'abc', at: '2026-10-12T12:00:00Z', ledger: {x: 1}, report}),
    {run: '7', branch: 'main', sha: 'abc', at: '2026-10-12T12:00:00Z', ledger: {x: 1}, results: {Lever: {reached: 'form', filled: 11, left: 7, url: 'u'}}});
});

test('a baseline is a run of the same applicant: the grown one is compared with grown runs, the thin one with thin runs (a result without one was thin)', () => {
  const states = [
    state('1', 'main', '2026-10-12T09:00:00Z', {}, {Lever: {reached: 'form', filled: 11, left: 7, url: 'u'}}),
    state('2', 'main', '2026-10-12T10:00:00Z', {}, {Lever: {reached: 'ready', filled: 18, left: 0, url: 'u', applicant: 'grown'}}),
  ];
  assert.equal(baselines(states, {branch: 'my-pr', run: '9', applicant: 'grown'}).Lever.run, '2');
  assert.equal(baselines(states, {branch: 'my-pr', run: '9', applicant: 'thin'}).Lever.run, '1');
  assert.equal(baselines(states, {branch: 'my-pr', run: '9'}).Lever.run, '1', 'no applicant named: the thin one');
  const report = {results: {Lever: {reached: 'form', filled: 11, left: 7, url: 'u', applicant: 'grown'}}, thisRun: {ran: ['Lever']}};
  assert.equal(stateOf({run: '7', branch: 'main', sha: 'a', at: 'x', ledger: {}, report}).results.Lever.applicant, 'grown');
});
