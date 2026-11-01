// The daily watch list's rules (lib/watch-list.mjs): which rows, the month's cap, "worse than the last live run", the one message.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {MONTH_CAP_USD, budget, judgeWatch, measured, replaySkipped, telegramText, watchRows, worse} from '../../lib/watch-list.mjs';
import {matchesOnly} from '../../lib/record-sites.mjs';

const form = (extra = {}) => ({url: 'https://careers.a.example/j/1', reached: 'form', filled: 9, left: 0, ending: 'ready', cause: 'ready', ...extra});
const pool = JSON.parse(fs.readFileSync(new URL('../../smoke-sites.json', import.meta.url), 'utf8')).shapes;

test('the watch list is the pool rows flagged stage watch: ten rows, one per multi-step platform, none picked by a loose name', () => {
  const rows = watchRows(pool).map(row => row.shape);
  assert.equal(rows.length, 10);
  for (const name of ['Richemont Workday', 'Chanel Workday', 'Breitling SuccessFactors', 'Join: form on join.com', 'Databricks (found 2026-10-10)']) assert.ok(rows.includes(name), name);
  const only = rows.join('|');
  assert.deepEqual(pool.filter(row => matchesOnly(row.shape, only)).map(row => row.shape).sort(), [...rows].sort(), '--only names exactly the watch rows: a loose word would record another site');
});

test('every watch row is a public posting the test applicant may visit', () => {
  for (const row of watchRows(pool)) {
    assert.ok(row.urls.length && row.urls.every(url => /^https:\/\//.test(url)), row.shape);
    assert.ok(!/linkedin|glassdoor|indeed|levels\.fyi|reddit/.test(row.urls.join(' ')), row.shape);
  }
});

test('the daily replay skips a watch row, except one still pinned (the scheduled gate needs every pinned row)', () => {
  const skipped = replaySkipped(pool, ['Databricks (found 2026-10-10)']);
  assert.equal(skipped.size, 9);
  assert.ok(!skipped.has('Databricks (found 2026-10-10)') && skipped.has('Richemont Workday'));
});

test('the month caps the run: twice its expected spend, never above what is left, none at the cap', () => {
  const now = new Date('2026-10-17T05:00:00Z');
  assert.deepEqual([budget([], now, 10).maxUsd, budget([], now, 10).capped], [1.2, false]);
  const spent = budget([{at: '2026-10-02T05:00:00Z', usd: 24.5}, {at: '2026-09-30T05:00:00Z', usd: 20}], now, 10);
  assert.deepEqual([spent.spent, spent.remaining, spent.maxUsd, spent.capped], [24.5, 0.5, 0.5, false], 'last month does not count');
  assert.equal(budget([{at: '2026-10-02T05:00:00Z', usd: 24.97}], now, 10).capped, true);
  assert.equal(MONTH_CAP_USD, 25);
});

test('worse means a more severe verdict, an earlier step, fewer fields on the same posting, or a journey that failed after passing', () => {
  const before = measured(form());
  assert.equal(worse(undefined, measured(form({reached: 'posting', ending: 'unresolved', cause: 'no-reason'}))), '', 'the first live run has nothing to be worse than');
  assert.match(worse(before, measured(form({reached: 'posting', ending: 'unresolved', cause: 'no-reason'}))), /stopped early/);
  assert.match(worse(before, measured(form({ending: 'unresolved', cause: 'field-missed', left: 4}))), /fields left/);
  assert.match(worse(before, measured(form(), true)), /journey check failed/);
  assert.match(worse(before, measured(form({filled: 5})), 'Row'), /filled 5, last time 9/);
  assert.equal(worse(measured(form({ending: 'unresolved', cause: 'field-missed', left: 4})), measured(form({ending: 'unresolved', cause: 'field-missed', left: 4}))), '', 'still failing the same way is not worse');
  assert.equal(worse(measured(form(), true), measured(form(), true)), '', 'a journey that already failed is not news');
});

test('a held row, a bot wall or a gone posting is never worse and never replaces the last measured state', () => {
  const previous = {A: measured(form()), B: measured(form())};
  const out = judgeWatch({results: {A: {reached: 'account', ending: 'held', note: 'account-first: held'}, B: form({reached: 'code/bot', ending: 'handed'})}}, ['A', 'B'], previous);
  assert.deepEqual([out.held, out.worse, out.measured], [['A', 'B'], [], []]);
  assert.deepEqual(out.rows, previous, 'the baseline stays the last measured run');
});

test('one message, only when a flow got worse; none on the first run', () => {
  const day = '2026-10-17', first = judgeWatch({results: {A: form({reached: 'posting', ending: 'unresolved', cause: 'no-reason'})}}, ['A'], {});
  assert.equal(telegramText({day, judged: first}), '', 'day 1 sends nothing');
  const judged = judgeWatch({results: {A: form({reached: 'posting', ending: 'unresolved', cause: 'no-reason'}), B: form(), C: {reached: 'account', ending: 'held', note: 'account-first: held'}}}, ['A', 'B', 'C'], {A: measured(form()), B: measured(form()), C: measured(form())});
  const text = telegramText({day, judged, usd: 0.5, monthSpent: 3});
  assert.match(text, /^📉 Daily watch 2026-10-17: 1 of 2 flows worse/);
  assert.match(text, /• A: stopped early/);
  assert.match(text, /1 held/);
  assert.match(text, /month \$3\.00 of \$25\.00/);
  assert.equal(telegramText({day, judged: judgeWatch({results: {B: form()}}, ['B'], {B: measured(form())})}), '', 'nothing worse: no message');
});
