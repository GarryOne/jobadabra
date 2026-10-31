// The Worker's cron triggers start the nightly build and the three-a-day e2e runs on time (src/scheduler.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CRONS, jobsFor, runScheduled, zurichHour} from '../src/scheduler.js';

const at = iso => new Date(iso);

test('the nightly build starts at 04:00 in Zurich, in summer (02:00 UTC) and in winter (03:00 UTC), and only then', () => {
  assert.equal(zurichHour(at('2026-10-05T02:00:00Z')), 4);   // UTC+2
  assert.equal(zurichHour(at('2026-12-05T03:00:00Z')), 4);   // UTC+1
  assert.deepEqual(jobsFor('0 2 * * *', at('2026-10-05T02:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}]);
  assert.deepEqual(jobsFor('0 3 * * *', at('2026-10-05T03:00:00Z')), []);   // 05:00 in summer: not its turn
  assert.deepEqual(jobsFor('0 3 * * *', at('2026-12-05T03:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}]);
  assert.deepEqual(jobsFor('0 2 * * *', at('2026-12-05T02:00:00Z')), []);   // 03:00 in winter
});

test('the three-a-day e2e runs start the scheduled plan; an unknown cron starts nothing', () => {
  assert.deepEqual(jobsFor('47 21,23,1 * * *', at('2026-10-05T09:47:00Z')), [{workflow: 'e2e.yml', inputs: {scheduled: 'true'}}]);
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-10-05T00:00:00Z')), [], '02:00 Zurich in summer: no replay is started here any more (owner, 17 Oct 2026)');
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-10-05T01:00:00Z')), [], '03:00 in summer: nothing');
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-10-05T02:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}], 'the nightly: 04:00 Zurich in summer');
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-12-05T01:00:00Z')), [], 'in winter 01:00 UTC is 02:00: nothing either');
  assert.deepEqual(jobsFor('0 0,1,2,3 * * *', at('2026-12-05T03:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}], 'and 03:00 UTC is 04:00');
  assert.deepEqual(jobsFor('1 1 * * *', at('2026-10-05T01:01:00Z')), []);
  assert.deepEqual(jobsFor('40 */3 * * *', at('2026-10-05T09:40:00Z')), [{workflow: 'self-heal-stats.yml', inputs: {scheduled: 'true'}}]);
  assert.deepEqual(jobsFor('0 2,3 * * *', at('2026-10-05T02:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}], 'the one nightly trigger fires at 02:00 UTC in summer');
  assert.deepEqual(jobsFor('0 2,3 * * *', at('2026-10-05T03:00:00Z')), [], 'and at 03:00 UTC it is 05:00 in summer: not its turn');
  assert.deepEqual(jobsFor('0 2,3 * * *', at('2026-12-05T03:00:00Z')), [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}], 'in winter 03:00 UTC is 04:00');
  assert.ok(CRONS.length <= 3, 'the account has 5 cron triggers across ALL Workers and the others hold 2: a 4th here was refused (14 Oct 2026)');
  assert.deepEqual(CRONS, ['0 0,1,2,3 * * *', '47 21,23,1 * * *', '*/10 * * * *']);
});

test('the ten-minute cron starts the PR verdict sweep on every tick without dispatch inputs', () => {
  for (const minute of ['00', '10', '20', '30', '40', '50']) {
    const jobs = jobsFor('*/10 * * * *', at(`2026-10-31T00:${minute}:00Z`));
    assert.deepEqual(jobs.filter(job => job.workflow === 'pr-verdict.yml'), [{workflow: 'pr-verdict.yml'}], minute);
  }
});

test('sharing the ten-minute cron preserves exactly eight stats starts per UTC day', () => {
  const starts = [], legacy = [];
  for (let hour = 0; hour < 24; hour++) {
    for (const minute of [0, 10, 20, 30, 40, 50]) {
      const now = new Date(Date.UTC(2026, 9, 31, hour, minute));
      const stats = jobsFor('*/10 * * * *', now).filter(job => job.workflow === 'self-heal-stats.yml');
      if (stats.length) {
        assert.deepEqual(stats, [{workflow: 'self-heal-stats.yml', inputs: {scheduled: 'true'}}]);
        starts.push(now.toISOString().slice(11, 16));
      }
      if (minute === 40 && hour % 3 === 0) legacy.push(...jobsFor('40 */3 * * *', now));
    }
  }
  assert.deepEqual(starts, ['00:40', '03:40', '06:40', '09:40', '12:40', '15:40', '18:40', '21:40']);
  assert.equal(legacy.length, 8, 'the old cron keeps working during deployment');
});

test('a scheduled start calls the dispatcher; a failed one tells the owner, lets the others start, then fails the cron', async () => {
  const calls = [], told = [];
  const dispatch = async (env, inputs, workflow) => { calls.push([workflow, inputs]); };
  const started = await runScheduled({cron: '0 2 * * *', scheduledTime: Date.parse('2026-10-05T02:00:00Z')}, {}, {dispatch, notify: async text => told.push(text)});
  assert.deepEqual(started, ['desktop.yml']);
  assert.deepEqual(calls, [['desktop.yml', {nightly: 'true'}]]);
  const failing = async () => { throw new Error('GitHub dispatch failed: 403 Resource not accessible'); };
  await assert.rejects(runScheduled({cron: '47 21,23,1 * * *', scheduledTime: Date.parse('2026-10-05T09:47:00Z')}, {}, {dispatch: failing, notify: async text => told.push(text)}),
    /scheduled start failed: e2e\.yml: GitHub dispatch failed: 403/, 'a cron that started nothing must not report success (6 Oct 2026: a day of 401s, every cron "success")');
  assert.match(told[0], /e2e\.yml failed.*403/);
});

test('a refused dispatch (not a 404) is raised', async () => {
  const refused = async () => { throw new Error('GitHub dispatch failed: 403 nope'); };
  await assert.rejects(runScheduled({cron: '0 0,1,2,3 * * *', scheduledTime: Date.parse('2026-10-05T02:00:00Z')}, {}, {dispatch: refused}), /403/);
});

test('failed verdict sweep ticks fail the cron without paging and still allow stats to start', async () => {
  for (const minute of ['10', '40']) {
    const calls = [], told = [], reported = [];
    const dispatch = async (env, inputs, workflow) => {
      calls.push(workflow);
      if (workflow === 'pr-verdict.yml') throw new Error('GitHub dispatch failed: 403 nope');
    };
    await assert.rejects(runScheduled({cron: '*/10 * * * *', scheduledTime: Date.parse(`2026-10-31T00:${minute}:00Z`)}, {},
      {dispatch, notify: async text => told.push(text), report: async text => reported.push(text)}), /scheduled start failed: pr-verdict\.yml: GitHub dispatch failed: 403/);
    assert.deepEqual(calls, minute === '40' ? ['pr-verdict.yml', 'self-heal-stats.yml'] : ['pr-verdict.yml']);
    assert.deepEqual(told, [], 'a sustained sweep failure must not page Telegram 144 times a day');
    assert.deepEqual(reported, [], 'the ten-minute sweep must not churn the watchdog issue');
  }
});
