// The rows the beta gate counts, built from a steps.json: one per step that ran, the first try as the verdict (lib/step-rows.mjs).
// Why (31 Oct 2026, a8 with slot 1): a retried green must not hide a red, a step that never ran must not count as a pass, and a night pass must be told apart from a PR run by its title.
import assert from 'node:assert/strict';
import test from 'node:test';
import {kindOfTitle, stepRows} from '../lib/step-rows.mjs';

const run = {id: 41240000001, sha: 'a'.repeat(40), at: '2026-11-01T01:30:05Z', title: 'Night burn-in 3/5 · aaaaaaaa'};
// The shapes lib/runner.mjs writes into steps.json (results), one of each status.
const table = {v: 1, suite: 'calendar', store: 'standin', os: 'linux', results: [
  {name: 'month grid', status: 'passed', seconds: '3.1'},
  {name: 'pick a day', status: 'passed', seconds: '4.0', retried: 'fetch failed'},
  {name: 'Stop halts a fill', status: 'passed', seconds: '2.2', safety: true},
  {name: 'next month', status: 'failed', note: 'x', cause: 'product'},
  {name: 'Notion read', status: 'failed', note: 'HTML error page', cause: 'environment', environment: true},
  {name: 'late step', status: 'failed', note: 'not run: the suite was over its 20-minute budget', budget: true},
  {name: 'needs login', status: 'skipped'},
  {name: 'AI step', status: 'skipped', aiCapped: true, note: 'capped'},
  {name: 'held step', status: 'suspended', note: 'x', issue: 7},
]};

test('one row per step that ran: passes, reds and suspended reds; none for skipped, capped or never-run steps', () => {
  const rows = stepRows(table, {key: 'calendar-standin', run});
  assert.deepEqual(rows.map(row => [row.step, row.ok]), [['calendar/month grid', true], ['calendar/pick a day', true], ['calendar/Stop halts a fill', true], ['calendar/next month', false], ['calendar/Notion read', false], ['calendar/held step', false]]);
});

test('the first try is the verdict: a green that needed the environment\'s once-more try is attempt 2', () => {
  const byName = Object.fromEntries(stepRows(table, {key: 'calendar-standin', run}).map(row => [row.name, row]));
  assert.equal(byName['month grid'].attempt, 1);
  assert.equal(byName['pick a day'].attempt, 2);
  assert.equal(byName['next month'].attempt, 1);
});

test('every row says where and when it ran, with the names steps.json uses', () => {
  const [first] = stepRows(table, {key: 'calendar-standin', run});
  assert.deepEqual(first, {step: 'calendar/month grid', name: 'month grid', ok: true, attempt: 1, suite: 'calendar', store: 'standin', machine: 'linux', key: 'calendar-standin', sha: run.sha, runId: '41240000001', kind: 'night', at: run.at});
  const flags = Object.fromEntries(stepRows(table, {key: 'calendar-standin', run}).map(row => [row.name, row]));
  assert.equal(flags['Stop halts a fill'].safety, true);
  assert.equal(flags['Notion read'].environment, true);
  assert.equal(flags['held step'].suspended, true);
});

test('an older steps.json without store or os is read from its artifact key', () => {
  const old = {v: 1, suite: 'calendar', results: [{name: 'month grid', status: 'passed'}]};
  assert.deepEqual(stepRows(old, {key: 'calendar-standin', run}).map(row => [row.store, row.machine]), [['standin', '']]);
  assert.deepEqual(stepRows(old, {key: 'windows-apply-1of3', run}).map(row => [row.store, row.machine]), [['', 'windows']]);
  assert.deepEqual(stepRows(null, {key: 'x', run}), []);
});

test('a run\'s kind comes from its title; runs that test other code give no rows', () => {
  for (const [title, kind] of [['Night burn-in 2/5 · 1234abcd', 'night'], ['Night burn-in Windows 2/5 · 1234abcd', 'night'], ['E2E for PR · calendar · my-branch', 'pr'], ['E2E after merge · abc · calendar', 'after-merge'],
    ['Beta E2E tests desktop-v1', 'beta'], ['E2E check · on time (Worker cron)', 'other'], ['Mutant apply', 'not-main'], ['RC soak desktop-v1', 'not-main'], ['Bisect calendar abc', 'not-main']]) {
    assert.equal(kindOfTitle(title), kind, title);
  }
  assert.deepEqual(stepRows(table, {key: 'calendar', run: {...run, title: 'Mutant apply'}}), []);
});
