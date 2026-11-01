// What each scheduled AI job reports to /ai-cost: its cost from whichever record it leaves, one row per run, never failing the job.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {billedDays, fetchBilled, runRow, spent} from '../../ai-cost-report.mjs';

test('the figure comes from claude-code-action\'s record, a cost file or a plain number', () => {
  const execution = JSON.stringify([{type: 'result', total_cost_usd: 0.25, num_turns: 7}]);
  assert.deepEqual(spent({execution}), {usd: 0.25, calls: 7});
  assert.deepEqual(spent({file: '{"usd": 0.4, "calls": 12}'}), {usd: 0.4, calls: 12});
  assert.deepEqual(spent({file: '{"usd": 0.1, "turns": 3}'}), {usd: 0.1, calls: 3});
  assert.deepEqual(spent({file: '{"spent": 0.31, "considered": 9, "results": []}'}), {usd: 0.31, calls: 9}, 'the proposers\' result files');
  assert.deepEqual(spent({usd: '0'}), {usd: 0, calls: 0}, 'a job that spent nothing still reports, so it shows up');
  assert.equal(spent({file: 'broken'}), null);
  assert.equal(spent({}), null);
});

test('one row per run; a matrix job adds its key so its runs do not replace each other', () => {
  const env = {GITHUB_RUN_ID: '123', GITHUB_REPOSITORY: 'GarryOne/jobadabra'}, now = new Date('2026-10-04T05:00:00Z');
  assert.deepEqual(runRow({job: 'ui-fix', suffix: '#49', env, now, usd: 0.2534567, calls: 5}),
    {job: 'ui-fix', run_id: '123--49', at: '2026-10-04T05:00:00.000Z', usd: 0.253457, calls: 5, repo: 'GarryOne/jobadabra'});
  assert.equal(runRow({job: 'x', env, now, usd: 1, calls: 0}).run_id, '123');
});

test('the Anthropic cost report: cents per day, summed over its lines, following pages', async () => {
  assert.deepEqual(billedDays({data: [{starting_at: '2026-10-03T00:00:00Z', results: [{amount: '150.5'}, {amount: '49.5'}]}]}), [{day: '2026-10-03', usd: 2}]);
  process.env.ANTHROPIC_ADMIN_KEY = 'k';
  const pages = [{data: [{starting_at: '2026-10-02T00:00:00Z', results: [{amount: '100'}]}], has_more: true, next_page: 'p2'}, {data: [{starting_at: '2026-10-03T00:00:00Z', results: [{amount: '300'}]}], has_more: false}];
  const urls = [];
  const days = await fetchBilled(7, async url => { urls.push(url); return {ok: true, json: async () => pages.shift()}; }, new Date('2026-10-04T10:00:00Z'));
  assert.deepEqual(days, [{day: '2026-10-02', usd: 1}, {day: '2026-10-03', usd: 3}]);
  assert.match(urls[0], /starting_at=2026-09-27/);
  assert.match(urls[1], /page=p2/);
});

test('a run reports its provider only when it is OpenAI (none: Anthropic on /ai-cost)', async () => {
  const {runRow} = await import('../../ai-cost-report.mjs');
  const now = new Date('2026-10-09T10:00:00Z'), env = {GITHUB_RUN_ID: '42'};
  assert.equal(runRow({job: 'e2e-app', suffix: 'jobs-openai', usd: 0.1, calls: 2, provider: 'openai', env, now}).provider, 'openai');
  assert.equal('provider' in runRow({job: 'e2e-app', suffix: 'jobs', usd: 0.1, calls: 2, provider: 'anthropic', env, now}), false);
  assert.equal(runRow({job: 'e2e-app', suffix: 'jobs-openai', usd: 0.1, calls: 2, provider: 'openai', env, now}).run_id, '42-jobs-openai');
});
