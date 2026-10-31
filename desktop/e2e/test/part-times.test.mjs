// The part-time collector (tools/e2e-part-times.mjs): a part's seconds are its suite step's, the store comes from the run's artifact names, the slowest per leg is kept.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {partRows, slowestByLeg, storeOf, storeOfRunNumber} from '../../../tools/e2e-part-times.mjs';

const step = (name, from, to, conclusion = 'success') => ({name, conclusion, started_at: `2026-10-31T18:${from}Z`, completed_at: `2026-10-31T18:${to}Z`});
const jobs = [
  {name: 'E2E · Mac + Linux · apply-3of3', steps: [step('Set up job', '47:58', '47:59'), step('Run the apply suite (the only try)', '49:16', '59:16', 'failure')]},
  {name: 'E2E · Windows · apply-3of3', steps: [step('Run the apply suite (the only try)', '45:00', '51:00')]},
  {name: 'Build · Mac', steps: [step('Run the apply suite (the only try)', '45:00', '51:00')]},
  {name: 'E2E · Mac + Linux · recorded-1of2', steps: [step('Run the recorded suite (the only try)', '45:00', '45:10', 'skipped')]},
];

test('a part is its suite step, a cut step counts its whole run, other jobs and skipped steps are no part', () => {
  assert.deepEqual(partRows(jobs), [{lane: 'Mac + Linux', part: 'apply-3of3', seconds: 600}, {lane: 'Windows', part: 'apply-3of3', seconds: 360}]);
});

test('the store is the one suffix every artifact of the run carries, else unknown', () => {
  assert.equal(storeOf(['e2e-artifacts-apply-3of3-standin', 'e2e-artifacts-recorded-1of2-standin', 'coverage']), 'standin');
  assert.equal(storeOf(['e2e-artifacts-apply-sqlite', 'e2e-artifacts-apply-standin']), null);
  assert.equal(storeOf(['e2e-artifacts-apply']), null);
});

test('the slowest seconds are kept per store leg and overall', () => {
  const table = slowestByLeg([
    {store: 'sqlite', rows: [{lane: 'Mac + Linux', part: 'apply-3of3', seconds: 549}]},
    {store: 'standin', rows: [{lane: 'Mac + Linux', part: 'apply-3of3', seconds: 600}]},
    {store: 'standin', rows: [{lane: 'Mac + Linux', part: 'apply-3of3', seconds: 580}, {lane: 'Windows', part: 'apply-3of3', seconds: 360}]},
  ]);
  assert.deepEqual(table['Mac + Linux · apply-3of3'], {runs: 3, max: 600, sqlite: 549, standin: 600});
  assert.deepEqual(table['Windows · apply-3of3'], {runs: 1, max: 360, standin: 360});
});

test('alternate gives sqlite to run numbers 0 and 1 and the Notion stand-in to 2 and 3 (lib/store.mjs bit 1)', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(storeOfRunNumber), ['sqlite', 'sqlite', 'standin', 'standin', 'sqlite', 'sqlite', 'standin', 'standin']);
});
