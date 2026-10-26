// A CI pool run's AI spend goes to /admin/intelligence/ai-cost like every scheduled AI job (owner, 12 Oct 2026, cost safety): pool-ai-cost.mjs reads THIS run's spend and calls from the
// day report into the file ai-cost-report.mjs --file sends. Never fails the job.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runSpend} from '../pool-ai-cost.mjs';

test('this run\'s spend and calls from the day report: only the rows it ran; nothing ran is $0 and 0 calls', () => {
  const report = {day: '2026-10-12', thisRun: {ran: ['A', 'B'], usd: 0.0712}, results: {A: {usd: 0.0412, aiCalls: 9}, B: {usd: 0.03, aiCalls: 6}, 'Earlier today': {usd: 0.5, aiCalls: 99}}};
  assert.deepEqual(runSpend(report), {usd: 0.0712, calls: 15});
  assert.deepEqual(runSpend({}), {usd: 0, calls: 0});
  assert.deepEqual(runSpend({thisRun: {ran: [], usd: 0}, results: {}}), {usd: 0, calls: 0});
});
