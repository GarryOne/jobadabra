// The automatic refill's caps (owner, 17 Oct 2026: $0.50 a run, $5 a month, only rows a refill can turn green). Guards lib/refill.mjs autoRefusal/pickRefill worseOnly, refill-auto.mjs, the PR gate's dispatch step.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {AUTO_MONTH_USD, AUTO_RUN_USD, autoRefusal, autoRunName, pickRefill} from '../../lib/refill.mjs';
import {monthSpend} from '../../refill-auto.mjs';

const workflow = name => fs.readFileSync(new URL(`../../../../.github/workflows/${name}`, import.meta.url), 'utf8');
const form = (filled, left) => ({reached: 'form', filled, left});
const asked = (name, now, live = form(9, 7)) => ({name, outcome: now, liveOutcome: live, network: {hit: 2, extra: 2, notRecorded: 0}, firstMiss: {differs: ['user:left_unfilled (lines 2 of 3)']}});

test('the caps: $0.50 a run, $5 a month, an unreadable month asks nothing', () => {
  assert.deepEqual([AUTO_RUN_USD, AUTO_MONTH_USD], [0.5, 5]);
  assert.equal(autoRefusal(0.04, 1.2), '');
  assert.match(autoRefusal(0.6, 0), /above the \$0.5 a run/);
  assert.match(autoRefusal(0.04, 4.98), /would pass the \$5 a month/);
  assert.equal(autoRefusal(0.5, 4.5), '', 'exactly at the cap still runs');
  assert.match(autoRefusal(0.01, NaN), /could not be read: nothing was asked/);
});

test('the month is read from the cost endpoint for the refill job; no key or a bad answer is NaN', async () => {
  const urls = [];
  const fetcher = async url => { urls.push(url); return {ok: true, json: async () => ({usd: 1.25})}; };
  assert.equal(await monthSpend({key: 'k', fetcher, now: new Date('2026-10-17T10:00:00Z')}), 1.25);
  assert.equal(urls[0], 'https://www.jobadabra.top/ai-cost/data?month=2026-10&prefix=replay-refill');
  assert.ok(Number.isNaN(await monthSpend({fetcher})));
  assert.ok(Number.isNaN(await monthSpend({key: 'k', fetcher: async () => ({ok: false})})));
  assert.ok(Number.isNaN(await monthSpend({key: 'k', fetcher: async () => { throw new Error('x'); }})));
});

test('the automatic pick takes only rows whose outcome fell: a refill can change their verdict, not the others', () => {
  const records = [asked('kept', form(9, 7)), asked('better', form(10, 6)), asked('fell', form(8, 8))];
  assert.deepEqual(pickRefill({pins: ['kept', 'better', 'fell'], records, worseOnly: true}).rows.map(row => row.name), ['fell']);
  assert.deepEqual(pickRefill({pins: ['kept', 'better', 'fell'], records}).rows.map(row => row.name), ['better', 'fell', 'kept'], 'by hand: every stale row, as before');
});

test('the refill workflow checks its caps in its own job and alerts when one stops it; no replay starts it', () => {
  const refill = workflow('replay-refill.yml');
  assert.doesNotMatch(workflow('site-replays.yml'), /gh workflow run replay-refill/, 'owner, 17 Oct 2026: no refill trigger from a replay');
  assert.match(refill, /run-name: .*Replay refill/);
  assert.match(refill, /node refill-auto\.mjs cap/);
  assert.match(refill, /--worse-only --max-usd/);
  assert.match(refill, /refill-auto\.mjs alert/);
  assert.equal(autoRunName(12, 'abcdef0123'), 'Replay refill PR 12 @ abcdef0');
});
