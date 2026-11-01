// The e2e daily AI budget (owner, 7 Oct 2026: "$30 a week"): over it, a run skips the paid judge and the screenshot review; an unreadable figure never blocks.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readSpent, verdict} from '../../ai-spend.mjs';

test('over the daily budget skips what is paid; under it, or unreadable, runs as usual', () => {
  assert.equal(verdict({usd: 5.2}, 5).over, true);
  assert.equal(verdict({usd: 1.4}, 5).over, false);
  assert.equal(verdict(null, 5).over, false, 'no figure: never block a run');
  assert.match(verdict({usd: 5.2}, 5).why, /no paid judge/);
});

test('the figure is today\'s e2e jobs, read with the publishing key; no key or an error reads nothing', async () => {
  const asked = [];
  const fetcher = async (url, init) => { asked.push({url, auth: init.headers.Authorization}); return {ok: true, json: async () => ({usd: 2.5, runs: 9})}; };
  assert.deepEqual(await readSpent({key: 'k', fetcher, day: '2026-10-07'}), {usd: 2.5, runs: 9});
  assert.deepEqual(asked[0], {url: 'https://www.jobpilotto.top/ai-cost/data?day=2026-10-07&prefix=e2e-', auth: 'Bearer k'});
  assert.equal(await readSpent({fetcher}), null);
  assert.equal(await readSpent({key: 'k', fetcher: async () => { throw new Error('offline'); }}), null);
});
