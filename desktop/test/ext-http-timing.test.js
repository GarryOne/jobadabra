// A slow extension request says when it arrived, when it ended, and how long its AI calls waited for a CLI slot versus ran (nightly run 41162490590: 106 s before a page-kind answer, unlocated).
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import {test} from 'node:test';
import {slots} from '../lib/ai/cli-base.js';
import {SLOW_MS, noteAiLimiter, timed} from '../lib/ext-http-timing.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function request(url, handle, clock) {
  const res = new EventEmitter(), lines = [], fired = [];
  const done = timed({url}, res, handle, {log: (area, text) => lines.push(`[${area}] ${text}`), now: () => clock.at, after: (fn, ms) => { fired.push({fn, ms}); return fired.length; }, cancel: () => {}});
  return {res, lines, fired, done};
}

test('a request open past 2 s writes "open" once, then "finish" with its elapsed time and its AI limiter wait and run time', async () => {
  const clock = {at: 1000}, ran = request('/extension/page-kind?url=https://x.test/job', async () => { noteAiLimiter(90000, 12000); noteAiLimiter(100, 50); }, clock);
  await ran.done;
  assert.equal(ran.fired[0].ms, SLOW_MS);
  clock.at = 3000; ran.fired[0].fn();
  clock.at = 107100; ran.res.emit('close');
  const id = ran.lines[0].match(/\] (\d+) /)[1];
  assert.deepEqual(ran.lines, [
    `[ext-http] ${id} /extension/page-kind phase=open elapsed_ms=2000`,
    `[ext-http] ${id} /extension/page-kind phase=finish elapsed_ms=106100 ai_queue_ms=90100 ai_run_ms=12050 ai_calls=2`,
  ]);
});

test('a request under 2 s writes nothing, and the query string (job addresses) never reaches the log', async () => {
  const clock = {at: 0}, ran = request('/extension/log?secret=1', async () => {}, clock);
  await ran.done;
  clock.at = 1999; ran.res.emit('close');
  assert.deepEqual(ran.lines, []);
  const slow = request('/extension/me?url=https://private.example/job', async () => {}, clock);
  clock.at = 5000; slow.fired[0].fn();
  assert.doesNotMatch(slow.lines.join('\n'), /private\.example|\?/);
});

test('the real CLI limiter reports a call\'s wait for a slot to the request it belongs to, per request', async () => {
  const queue = slots(1), clock = {at: 0}, outcomes = [];
  const first = request('/extension/page-kind', () => queue(() => pause(60)), clock);
  const second = request('/extension/page-kind', () => queue(() => pause(10)), clock);
  await Promise.all([first.done, second.done]);
  for (const ran of [first, second]) { clock.at = 5000; ran.res.emit('close'); outcomes.push(ran.lines.at(-1)); }
  const [a, b] = outcomes.map(line => Object.fromEntries([...line.matchAll(/(ai_\w+)=(\d+)/g)].map(([, key, value]) => [key, Number(value)])));
  assert.ok(a.ai_queue_ms < 30 && a.ai_run_ms >= 50, `the first ran at once: ${JSON.stringify(a)}`);
  assert.ok(b.ai_queue_ms >= 45, `the second waited behind the first: ${JSON.stringify(b)}`);
  assert.ok(b.ai_run_ms < 50, `the second's run time excludes its wait: ${JSON.stringify(b)}`);
});

test('every request of the app\'s local server goes through timed()', () => {
  assert.match(fs.readFileSync(new URL('../lib/server.js', import.meta.url), 'utf8'), /http\.createServer\(\(req, res\) => timed\(req, res,/);
});
