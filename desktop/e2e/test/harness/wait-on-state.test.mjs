// Shared state waits follow committed answers, closed tabs and app logs without real clock sleeps.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {currentLaunchLog} from '../../lib/app-log.mjs';
import {withLimit} from '../../lib/runner.mjs';
import {stageWithin, extensionDecisions, formsClosedForJob, pollUntil, stepClock, stepTimeLeft, waitForDecisions, waitForFormValue, waitForLogLine, waitJobFormClosed, waitCapNote} from '../../lib/wait-on-state.mjs';

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

// Why (1 Nov 2026, main 47580bb run 41342226333 + PR run 41343009693): extension-form-shapes printed no subtest and died at the file's 180 s limit. The cap was checked only BETWEEN reads, so one read
// (a page or worker evaluate) that never settled outlived every cap. The real timer here is the point of the test: 30 ms stands for the cap, a read that never answers for the wedged page.
test('a read that never answers ends the wait at the cap with the last value, marked hung (the cap was only checked between reads)', async () => {
  let reads = 0;
  const result = await pollUntil(() => (++reads === 1 ? Promise.resolve('7') : new Promise(() => {})), value => value === '9', {capMs: 30, tickMs: 1, readGraceMs: 0, log: () => {}});
  assert.deepEqual([result.value, result.hung, reads], ['7', true, 2]);
});

test('a browser call that never settles fails naming its step; one that settles keeps its value and its error', async () => {
  await assert.rejects(stageWithin('the extension start: opening its first tab', 30, new Promise(() => {})), /the extension start: opening its first tab did not finish within 0 s/);
  assert.equal(await stageWithin('a call', 1000, Promise.resolve(7)), 7);
  const error = new Error('page closed');
  await assert.rejects(stageWithin('a call', 1000, Promise.reject(error)), failure => failure === error);
});

test('a read that fails after the wait gave up on it is not an unhandled rejection, and a read that fails in time still propagates', async () => {
  const unhandled = [], listener = error => unhandled.push(error);
  process.on('unhandledRejection', listener);
  try {
    let fail;
    const late = new Promise((_, reject) => { fail = reject; });
    const result = await pollUntil(() => late, () => false, {capMs: 20, tickMs: 1, readGraceMs: 0, log: () => {}});
    fail(new Error('page closed after the cap'));
    await new Promise(resolve => setImmediate(resolve));   // Why: lets Node deliver an unhandled rejection if there were one; a state wait is not possible for "nothing happened"
    assert.deepEqual([result.hung, unhandled.length], [true, 0]);
  } finally { process.off('unhandledRejection', listener); }
  const error = new Error('read failed in time');
  await assert.rejects(pollUntil(async () => { throw error; }, () => true, {capMs: 1000, log: () => {}}), failure => failure === error);
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


test('old completions cannot cover a later launch', async t => {
  const {profile, file} = logFile(t), time = clock();
  fs.writeFileSync(file, '[app] start old\nstartup moves finished\nstartup moves finished\n[app] start new\n');
  await assert.rejects(waitForLogLine(profile, /startup moves finished/g, {...time, capMs: 500}), /never finished/);
  assert.deepEqual(time.ticks, [250, 250]);
});

test('an empty log with no recorded start is already settled', async t => {
  const {profile, file} = logFile(t), time = clock();
  fs.writeFileSync(file, '');
  assert.equal(await waitForLogLine(profile, /startup moves finished/g, time), undefined);
  assert.deepEqual(time.ticks, []);
  assert.deepEqual(time.logs, []);
});

test('a logged start without a completion cannot pass', async t => {
  const {profile, file} = logFile(t), time = clock();
  fs.writeFileSync(file, '[app] start new\n');
  await assert.rejects(waitForLogLine(profile, /startup moves finished/g, {...time, capMs: 500}), /never finished/);
  assert.deepEqual(time.ticks, [250, 250]);
});

test('a completion after the last start passes even if an older launch never completed', async t => {
  const {profile, file} = logFile(t), time = clock();
  fs.writeFileSync(file, '[app] start old\n[app] start new\nstartup moves finished\n');
  await waitForLogLine(profile, /startup moves finished/g, {...time, capMs: 500});
  assert.deepEqual(time.ticks, []);
});

test('the latest launch stays pending across a midnight log roll', async t => {
  const {profile, file} = logFile(t), time = clock();
  fs.writeFileSync(file, '[app] start old\nstartup moves finished\nstartup moves finished\n[app] start new\n');
  const pause = async tick => {
    await time.pause(tick);
    fs.renameSync(file, path.join(profile, 'logs', 'app-2026-10-28.log'));
    fs.writeFileSync(file, 'startup moves finished\n');
  };
  await waitForLogLine(profile, /startup moves finished/g, {...time, pause, capMs: 500});
  assert.deepEqual(time.ticks, [250]);
});

test('launch-scoped reads exclude retained telemetry until the expected launch starts', t => {
  const {profile, file} = logFile(t);
  fs.writeFileSync(file, '[app] start old\n[telemetry] reporting is off: demo mode\n');
  assert.equal(currentLaunchLog(profile, 2), '');
  fs.appendFileSync(file, '[app] start new\n');
  assert.doesNotMatch(currentLaunchLog(profile, 2), /reporting is off/);
  fs.appendFileSync(file, '[telemetry] reporting is off: the end-to-end journey\n');
  assert.match(currentLaunchLog(profile, 2), /reporting is off/);
});


test('a fresh one-start log captures its own start count after replacing a completed launch', async t => {
  const {profile, file} = logFile(t), time = clock();
  fs.writeFileSync(file, '[app] start old\nstartup moves finished\n');
  await waitForLogLine(profile, /startup moves finished/g, time);
  assert.deepEqual(time.ticks, []);
  fs.rmSync(file);
  fs.writeFileSync(file, '[app] start fresh\n');
  const pause = async tick => {
    await time.pause(tick);
    fs.appendFileSync(file, 'startup moves finished\n');
  };
  await waitForLogLine(profile, /startup moves finished/g, {...time, pause, capMs: 500});
  assert.deepEqual(time.ticks, [250], 'the fresh launch must finish before this call settles');
});

// Beta 41090972183 (applyflows, 30 Oct 2026): the form was done at 16:51:04, but the batch carrying "page kind corrected" was still on its way (batches landed 14-62 s late).
const CORRECTED = /page kind corrected: a posting with no Apply but a form's fields/;
const beforeBatch = '2026-10-30T16:50:24.474Z [extension] page kind forgotten: a posting with no Apply but a form\'s fields {}\n';
const afterBatch = `${beforeBatch}2026-10-30T16:51:30.000Z [extension] fill: page kind corrected: a posting with no Apply but a form's fields {"extensionAt":"2026-10-30T16:50:24.480Z"}\n`;

test('a decision line that lands after the form is done is waited for, where one read at that moment misses it', async () => {
  const time = clock();
  const read = async () => time.now() < 26000 ? beforeBatch : afterBatch;
  assert.doesNotMatch(await read(), CORRECTED, 'the control: the single read the step made sees no line');
  const {value, ms} = await waitForDecisions(read, [CORRECTED], time);
  assert.match(value, CORRECTED);
  assert.equal(ms, 26000);
  assert.match(time.logs[0], /decision lines were read 26000 ms/);
});

test('every expected decision line must be in the log, and a g flag cannot make a match flicker', async () => {
  const time = clock();
  const lines = ['account button: pressed {}', 'account button: pressed {}\naccount result: created {}'];
  const {value} = await waitForDecisions(async () => lines[Math.min(time.now() / 250, 1)], [/account button: pressed/g, /account result: created/g], time);
  assert.match(value, /account result: created/);
  assert.deepEqual(time.ticks, [250]);
});

test('a decision line that never arrives is waited for until just before the step\'s own hang cap, and a failed read is retried', async () => {
  const time = clock();
  let reads = 0;
  const read = async () => { if (++reads === 2) throw new Error('log rolled'); return beforeBatch; };
  stepClock(90000);
  try {
    const {value, ms} = await waitForDecisions(read, [CORRECTED], time);
    assert.equal(value, beforeBatch);
    assert.ok(ms > 87000 && ms <= 88000, `ended 2 s before the step's cap, never at a shorter cap of its own (${ms} ms)`);
  } finally { stepClock(null); }
  assert.deepEqual(time.logs, []);
});

test('the runner\'s step limit is the clock a wait inside the step sees, and it ends with the step', async () => {
  assert.equal(stepTimeLeft(), undefined, 'no step: a wait keeps pollUntil\'s own default');
  const left = await withLimit(Promise.resolve().then(() => stepTimeLeft()), 5000, 'a step');
  assert.ok(left > 2000 && left <= 3000, `inside the step: ${left} ms left for the wait, 2 s kept to report`);
  assert.equal(stepTimeLeft(), undefined, 'after the step: no clock');
});

// Gitar on #2620: with the wait running to the cap itself, the hang timer won and the step's own check never ran.
test('a decision that never arrives fails the step with the step\'s own message, not as a hang', async () => {
  const step = async () => {
    const {value} = await waitForDecisions(async () => beforeBatch, [CORRECTED], {log: () => {}});
    if (String(value).search(CORRECTED) === -1) throw new Error('the page-kind correction is not in the extension\'s decisions');
  };
  const error = await withLimit(Promise.resolve().then(step), 2600, 'a step').then(() => null, failure => failure);
  assert.match(String(error?.message), /not in the extension's decisions/);
  assert.notEqual(error.stepHang, true, 'a missing decision is the product\'s failure, not a hang');
});

// #2612 (owner, 30 Oct 2026): the decision is read where it is made. Captured shape: extension/log.js entries; server-env.js onLog renders them in app.log.
const entry = {at: '2026-10-30T16:50:24.480Z', kind: 'fill', text: 'page kind corrected: a posting with no Apply but a form\'s fields', fields: {shape: 'posting|x', version: '0.8.53'}, sent: false};
const browserWith = worker => ({serviceWorker: async () => worker});

test('a decision still in the extension\'s store is read before app.log has it, in app.log\'s own line shape', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-decisions-'));
  fs.mkdirSync(path.join(profile, 'logs'));
  fs.writeFileSync(path.join(profile, 'logs', 'app.log'), beforeBatch);
  const text = await extensionDecisions({browser: browserWith({evaluate: async () => [entry]}), profile});
  assert.match(text, CORRECTED);
  assert.ok(text.split('\n').includes(`2026-10-30T16:50:24.480Z [extension] fill: page kind corrected: a posting with no Apply but a form's fields ${JSON.stringify(entry.fields)}`));
  const control = await extensionDecisions({browser: browserWith({evaluate: async () => { throw new Error('worker restarting'); }}), profile});
  assert.doesNotMatch(control, CORRECTED, 'the control: app.log alone does not have it yet');
  assert.match(control, /page kind forgotten/, 'a worker that cannot be read leaves app.log');
});

test('an expired wait uses one timing form with elapsed seconds and the last observation', () => {
  assert.equal(waitCapNote('the wait for the late form', 1.25, ['https://fixture.test/posting']),
    'the wait for the late form did not finish within 1.25 s (last seen: ["https://fixture.test/posting"])');
  assert.equal(waitCapNote('the fill', 90, null), 'the fill did not finish within 90 s (last seen: null)');
});
