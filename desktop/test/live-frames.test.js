// The live view shows the NEWEST picture, never a backlog (owner, 28 Oct 2026: "the live view it's very laggish"): measured, the stream is fast (47 frames a second, 13-23 KB each)
// and the window shows about 45 a second when idle, so on a busy window the old pictures queue up and the view runs seconds behind. renderer/live-frames.js drops what is stale.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFramePacer} from '../renderer/live-frames.js';

// A manual clock: schedule() queues the paint, tick() is one display refresh.
const clock = () => { const queue = []; return {schedule: fn => { queue.push(fn); return queue.length; }, tick: () => queue.splice(0).forEach(fn => fn()), pending: () => queue.length}; };

test('a burst of pictures between two refreshes paints the newest once; the stale ones are never decoded', () => {
  const {schedule, tick, pending} = clock(), painted = [];
  const pacer = createFramePacer(frame => painted.push(frame), schedule);
  for (let i = 1; i <= 100; i++) pacer.push({data: `jpeg${i}`});
  assert.equal(pending(), 1, 'one paint is asked for, however many pictures came');
  tick();
  assert.deepEqual(painted, [{data: 'jpeg100'}]);
});

test('a consumer slower than the producer stays on the latest picture: 60 pictures over 20 slow refreshes paint 20 times, each the newest at that refresh', () => {
  const {schedule, tick} = clock(), painted = [];
  const pacer = createFramePacer(frame => painted.push(frame.n), schedule);
  let n = 0;
  for (let refresh = 0; refresh < 20; refresh++) { for (let k = 0; k < 3; k++) pacer.push({n: ++n}); tick(); }
  assert.equal(painted.length, 20);
  assert.deepEqual(painted, Array.from({length: 20}, (_, i) => (i + 1) * 3), 'never behind: each paint is the last picture that had arrived');
});

test('nothing paints without a picture, and a picture after a refresh asks for the next one', () => {
  const {schedule, tick, pending} = clock(), painted = [];
  const pacer = createFramePacer(frame => painted.push(frame.n), schedule);
  tick();
  assert.deepEqual(painted, []);
  pacer.push({n: 1}); tick(); pacer.push({n: 2});
  assert.equal(pending(), 1);
  tick();
  assert.deepEqual(painted, [1, 2]);
});

test('clear drops a picture that has not painted yet (the view moved to another session)', () => {
  const {schedule, tick} = clock(), painted = [];
  const pacer = createFramePacer(frame => painted.push(frame.n), schedule);
  pacer.push({n: 1}); pacer.clear(); tick();
  assert.deepEqual(painted, []);
});

test('the window paints stream pictures only through the pacer: no picture is set on the image anywhere else but showPicture', async () => {
  const {readFileSync} = await import('node:fs');
  const page = readFileSync(new URL('../renderer/pages/session-live.js', import.meta.url), 'utf8');
  assert.equal((page.match(/\.img\.src\s*=|v\.img\.src\s*=/g) || []).length, 1, 'one place sets the picture: showPicture');
  assert.match(page, /kind === 'frame'\) view\.frames\.push\(message\)/, 'a frame goes to the pacer, not to the image');
});
