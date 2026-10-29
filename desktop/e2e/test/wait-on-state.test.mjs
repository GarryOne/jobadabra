// Shared state waits follow committed answers, closed tabs and app logs without real clock sleeps.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {formsClosedForJob, pollUntil, waitForFormValue, waitForLogLine, waitJobFormClosed} from '../lib/wait-on-state.mjs';

const clock = () => {
  let ms = 0;
  const ticks = [], logs = [];
  return {ticks, logs, now: () => ms, pause: async tick => { ticks.push(tick); ms += tick; }, log: line => logs.push(line)};
};

test('an answer already committed returns immediately without a tick or log', async () => {
  const time = clock();
  assert.deepEqual(await waitForFormValue(async () => '4', '4', time), {value: '4', ms: 0});
  assert.deepEqual(time.ticks, []);
  assert.deepEqual(time.logs, []);
});

test('a predicate accepts the answer after three ticks and logs the measured wait', async () => {
  const time = clock();
  const values = ['', '', '', '9'];
  assert.deepEqual(await waitForFormValue(async () => values.shift(), value => value === '9', time), {value: '9', ms: 750});
  assert.deepEqual(time.ticks, [250, 250, 250]);
  assert.equal(time.logs.length, 1);
  assert.match(time.logs[0], /750 ms/);
});

test('a hang returns the last value and elapsed ms without sleeping beyond its cap', async () => {
  const time = clock();
  const result = await waitForFormValue(async () => time.now() < 500 ? '' : '7', '9', {...time, capMs: 625});
  assert.deepEqual(result, {value: '7', ms: 625});
  assert.deepEqual(time.ticks, [250, 250, 125]);
  assert.deepEqual(time.logs, []);
});

test('a read that throws during navigation is retried until the answer commits', async () => {
  const time = clock();
  let reads = 0;
  assert.deepEqual(await waitForFormValue(async () => {
    if (++reads === 1) throw new Error('execution context replaced');
    return '5';
  }, '5', time), {value: '5', ms: 250});
  assert.deepEqual(time.logs, []);
});

test('the default hang cap allows a value to land well after the old five seconds', async () => {
  const time = clock();
  assert.deepEqual(await waitForFormValue(async () => time.now() < 44000 ? '' : '5', '5', time), {value: '5', ms: 44000});
  assert.deepEqual(await waitForFormValue(async () => 'wrong', '5', time), {value: 'wrong', ms: 45000});
});

test('read time counts toward the cap and a failed read preserves the last value', async () => {
  const time = clock();
  let reads = 0;
  assert.deepEqual(await waitForFormValue(async () => {
    await time.pause(400);
    if (++reads > 1) throw new Error('page navigating');
    return '7';
  }, '9', {...time, capMs: 1000}), {value: '7', ms: 1050});
});

test('an untolerated poll propagates read errors without a tick', async () => {
  const time = clock(), error = new Error('log unreadable');
  await assert.rejects(pollUntil(async () => { throw error; }, () => true, time), failure => failure === error);
  assert.deepEqual(time.ticks, []);
});

test('tolerance retains the last good value without running the predicate on failed reads', async () => {
  const time = clock(), accepted = [];
  const result = await waitForFormValue(async () => {
    if (time.now() > 0) throw new Error('page navigating');
    return '7';
  }, value => { accepted.push(value); return false; }, {...time, capMs: 500});
  assert.deepEqual(result, {value: '7', ms: 500});
  assert.deepEqual(accepted, ['7']);
});

test('an unread initial value cannot satisfy an empty wanted string', async () => {
  const time = clock();
  const result = await waitForFormValue(async () => {
    if (time.now() === 0) throw new Error('page navigating');
    return '';
  }, '', time);
  assert.deepEqual(result, {value: '', ms: 250});
});

const url = 'https://fixture.test/job';
for (const {name, forms, sessions, done} of [
  {name: 'no matching session needs no extension report', forms: {known: false, ids: []}, sessions: [{id: 'other', url: 'https://fixture.test/other'}], done: true},
  {name: 'a matching session needs a known report', forms: {known: false, ids: []}, sessions: [{id: 'old', url}], done: false},
  {name: 'a matching session still open is not closed', forms: {known: true, ids: ['old']}, sessions: [{id: 'old', url: `${url}/form`}], done: false},
  {name: 'a matching session gone from the known report is closed', forms: {known: true, ids: ['other']}, sessions: [{id: 'old', url}], done: true},
]) test(name, () => {
  assert.equal(formsClosedForJob({forms, sessions}, url), done);
});

test('a slow closed-tab wait logs the closure rather than a field value', async () => {
  const time = clock();
  const page = {evaluate: async read => {
    const previous = globalThis.window;
    globalThis.window = {pilot: {
      formsOpen: async () => ({known: true, ids: time.now() < 750 ? ['old'] : []}),
      sessions: async () => [{id: 'old', url}],
    }};
    try { return await read(); } finally {
      if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
    }
  }};
  await waitJobFormClosed(page, url, time);
  assert.deepEqual(time.logs, ['  the app reported the earlier form closed 750 ms after the tab was closed']);
});

const logFile = t => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-wait-state-'));
  fs.mkdirSync(path.join(profile, 'logs'));
  t.after(() => fs.rmSync(profile, {recursive: true, force: true}));
  return {profile, file: path.join(profile, 'logs', 'app.log')};
};

test('a log wait needs no finished lines when no app start was logged', async t => {
  const {profile, file} = logFile(t), time = clock();
  fs.writeFileSync(file, 'unrelated line\n');
  assert.equal(await waitForLogLine(profile, /finished/g, time), undefined);
  assert.deepEqual(time.ticks, []);
  assert.deepEqual(time.logs, []);
});

test('a log wait counts every app start and stays silent when the final completion arrives', async t => {
  const {profile, file} = logFile(t), time = clock();
  fs.writeFileSync(file, '[app] start 1\nfinished\n[app] start 2\n');
  const pause = async tick => {
    await time.pause(tick);
    if (time.now() === 500) fs.appendFileSync(file, 'finished\n');
  };
  assert.equal(await waitForLogLine(profile, /finished/g, {...time, pause}), undefined);
  assert.deepEqual(time.ticks, [250, 250]);
  assert.deepEqual(time.logs, []);
});

test('a hung log wait expires at the cap and keeps its exact custom error', async t => {
  const {profile, file} = logFile(t), time = clock();
  fs.writeFileSync(file, '[app] start 1\n');
  await assert.rejects(waitForLogLine(profile, /startup moves finished/g, {...time, what: 'the move', capMs: 500}), {
    message: 'the move never finished (no "startup moves finished" in the app\'s log)',
  });
  assert.deepEqual(time.ticks, [250, 250]);
});

test('a finished log at the cap is accepted and the default error names the regex', async t => {
  const {profile, file} = logFile(t), time = clock();
  fs.writeFileSync(file, '[app] start 1\n');
  const pause = async tick => { await time.pause(tick); fs.appendFileSync(file, 'finished\n'); };
  await waitForLogLine(profile, /finished/g, {...time, pause, capMs: 100});
  assert.deepEqual(time.ticks, [100]);
  fs.writeFileSync(file, '[app] start 1\n');
  await assert.rejects(waitForLogLine(profile, /finished/g, {...time, capMs: -1}), {
    message: 'finished never finished (no "finished" in the app\'s log)',
  });
});
