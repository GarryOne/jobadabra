// Form-value waits follow committed answers without sleeping on a real clock.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formsClosedForJob, waitForFormValue} from '../lib/wait-for-form-value.mjs';

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

const url = 'https://fixture.test/job';
for (const {name, forms, sessions, done} of [
  {name: 'no matching session needs no extension report', forms: {known: false, ids: []}, sessions: [{id: 'other', url: 'https://fixture.test/other'}], done: true},
  {name: 'a matching session needs a known report', forms: {known: false, ids: []}, sessions: [{id: 'old', url}], done: false},
  {name: 'a matching session still open is not closed', forms: {known: true, ids: ['old']}, sessions: [{id: 'old', url: `${url}/form`}], done: false},
  {name: 'a matching session gone from the known report is closed', forms: {known: true, ids: ['other']}, sessions: [{id: 'old', url}], done: true},
]) test(name, () => {
  assert.equal(formsClosedForJob({forms, sessions}, url), done);
});
