// lib/frame-targets.js: the iframes that run in their own process get their own sessions, only for this tab, opened once and dropped when gone (Gitar on #2354, 28 Oct 2026).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {openFrameTargets} from '../lib/frame-targets.js';

const ADDRESS = 'ws://127.0.0.1:9333/devtools/page/PAGE';
const row = (id, parentId, type = 'iframe') => ({id, parentId, type, webSocketDebuggerUrl: `ws://127.0.0.1:9333/devtools/page/${id}`});
function setup(rows) {
  const state = {rows, opened: [], detached: [], asked: []};
  const openCdp = async url => { state.opened.push(url); return {detach: async () => { state.detached.push(url); }}; };
  const frames = openFrameTargets(ADDRESS, openCdp, async url => { state.asked.push(url); return state.rows; });
  return {state, frames};
}

test('only iframes whose parent is this tab are opened, once each, over the tab\'s own debugging port', async () => {
  const {state, frames} = setup([row('A', 'PAGE'), row('B', 'OTHER'), row('C', 'PAGE', 'page')]);
  assert.deepEqual((await frames.list()).map(f => f.id), ['A']);
  await frames.list();
  assert.deepEqual(state.opened, ['ws://127.0.0.1:9333/devtools/page/A'], 'the same iframe is not opened again');
  assert.deepEqual(state.asked, ['http://127.0.0.1:9333/json/list', 'http://127.0.0.1:9333/json/list']);
});

test('an iframe that is gone is detached, and close() detaches the rest', async () => {
  const {state, frames} = setup([row('A', 'PAGE'), row('D', 'PAGE')]);
  await frames.list();
  state.rows = [row('D', 'PAGE')];
  assert.deepEqual((await frames.list()).map(f => f.id), ['D']);
  assert.deepEqual(state.detached, ['ws://127.0.0.1:9333/devtools/page/A']);
  await frames.close();
  assert.equal(state.detached.length, 2);
});

test('a browser that cannot be asked, or an address that is not one, lists no frames', async () => {
  assert.deepEqual(await openFrameTargets(ADDRESS, async () => ({}), async () => { throw new Error('refused'); }).list(), []);
  assert.deepEqual(await openFrameTargets('not an address', async () => ({}), async () => [row('A', 'PAGE')]).list(), []);
});

// Gitar on #2354 (28 Oct 2026): a slow open let a second read open the same target, and a list() still running at close() kept a session nobody detached.
function slowOpen() {
  const state = {opened: [], detached: [], release: null};
  const openCdp = url => new Promise(resolve => { state.opened.push(url); state.release = () => resolve({detach: async () => { state.detached.push(url); }}); });
  return {state, openCdp};
}

test('two reads that overlap share one list, so a target is opened once', async () => {
  const {state, openCdp} = slowOpen();
  const frames = openFrameTargets(ADDRESS, openCdp, async () => [row('A', 'PAGE')]);
  const first = frames.list(), second = frames.list();
  await new Promise(resolve => setImmediate(resolve));
  state.release();
  assert.deepEqual((await Promise.all([first, second])).map(list => list.map(f => f.id)), [['A'], ['A']]);
  assert.equal(state.opened.length, 1, 'one socket, not two');
  await frames.close();
  assert.equal(state.detached.length, 1, 'and it is the one detached');
});

test('a list still opening when the view closes detaches what it opened and keeps nothing', async () => {
  const {state, openCdp} = slowOpen();
  const frames = openFrameTargets(ADDRESS, openCdp, async () => [row('A', 'PAGE')]);
  const running = frames.list();
  await new Promise(resolve => setImmediate(resolve));
  const closing = frames.close();
  state.release();
  await closing;
  assert.deepEqual(await running, [], 'nothing is handed out after close');
  assert.equal(state.detached.length, 1, 'the late session is detached');
  assert.deepEqual(await frames.list(), [], 'a closed set lists none and opens none');
  assert.equal(state.opened.length, 1);
});
