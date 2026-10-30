// The triage reader's queue: one read out at a time, a report only for the active one, no clock waited (lib/triage-reader.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createTriageReader} from '../lib/triage-reader.js';

const clock = () => { const timers = []; return {timers, set: fn => { timers.push(fn); return timers.length - 1; }, clear: id => { timers[id] = null; }, fire: () => timers.forEach(fn => fn && fn())}; };
const reader = (extra = {}) => { let n = 0; return createTriageReader({uuid: () => `id${++n}0000000`, ...extra}); };

test('a queued read is handed to the extension once and answered with the mode table flags', async () => {
  const r = reader(), pending = r.read('https://jobs.example/a');
  const taken = r.take();
  assert.equal(taken.url, 'https://jobs.example/a');
  assert.equal(r.take(), null, 'only one read is out at a time');
  assert.equal(r.report(taken.id, {botCheck: false, loginWall: false, accountCreation: false}), true);
  assert.deepEqual(await pending, {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null});
  assert.equal(r.busy(), false);
});

test('a login wall and a captcha come through as flags', async () => {
  const r = reader(), pending = r.read('https://jobs.example/b');
  r.report(r.take().id, {botCheck: true, loginWall: true});
  const read = await pending;
  assert.deepEqual([read.captcha, read.login, read.accountCreation], [true, true, null], 'a flag nobody gave stays unknown');
});

test('a page that never became a form reads as nothing', async () => {
  const r = reader(), pending = r.read('https://jobs.example/c');
  r.report(r.take().id, {unreadable: true});
  assert.equal(await pending, null);
});

test('a report for an id that is not the active read is refused', async () => {
  const r = reader(), pending = r.read('https://jobs.example/d');
  assert.equal(r.report('nope', {botCheck: false}), false, 'nothing is out yet');
  const {id} = r.take();
  assert.equal(r.report('nope', {botCheck: false}), false);
  assert.equal(r.report(id, {botCheck: false, loginWall: false, accountCreation: false}), true);
  assert.equal(r.report(id, {botCheck: true}), false, 'a second report for the same read is refused');
  await pending;
});

test('a read with no report resolves null when its time is up, and the next read can go', async () => {
  const time = clock(), r = reader({set: time.set, clear: time.clear});
  const first = r.read('https://jobs.example/e'); r.take();
  const second = r.read('https://jobs.example/f');
  assert.equal(r.take(), null, 'the first read is still out');
  time.timers[0]();
  assert.equal(await first, null);
  assert.equal(r.take().url, 'https://jobs.example/f');
  r.cancelAll();
  assert.equal(await second, null);
});

test('Cancel ends every queued and active read with null', async () => {
  const r = reader(), a = r.read('https://jobs.example/g'), b = r.read('https://jobs.example/h');
  r.take();
  assert.equal(r.cancelAll(), 2);
  assert.deepEqual(await Promise.all([a, b]), [null, null]);
  assert.equal(r.busy(), false);
  assert.equal(r.take(), null);
});

test('a read ended without a report (Cancel, a timeout) is handed back once, to close its page; a reported or never-started read is not', async () => {
  const time = clock(), r = reader({set: time.set, clear: time.clear});
  const out = r.read('https://jobs.example/i'), waiting = r.read('https://jobs.example/j'), taken = r.take();
  r.cancelAll();
  await Promise.all([out, waiting]);
  assert.deepEqual(r.takeEnded(), [taken.id], 'only the read the extension holds has a page to close');
  assert.deepEqual(r.takeEnded(), [], 'each is returned once');
  const timed = r.read('https://jobs.example/k'), {id} = r.take();
  time.timers[time.timers.length - 1]();
  assert.equal(await timed, null);
  assert.deepEqual(r.takeEnded(), [id], 'a timeout leaves its page open too');
  const answered = r.read('https://jobs.example/l'), next = r.take();
  r.report(next.id, {botCheck: false, loginWall: false, accountCreation: false});
  await answered;
  assert.deepEqual(r.takeEnded(), [], 'a reported read already closed its own tab');
});
