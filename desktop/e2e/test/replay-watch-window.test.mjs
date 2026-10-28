// The watch window of a case with only "must not happen" checks ends on the real signal (the fill is over and the page went quiet), never later than its deadline, and never early while the fill runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {watchWindow} from '../lib/page-replay.mjs';

const pageWith = states => { let index = 0; return {evaluate: async () => (states[Math.min(index++, states.length - 1)])}; };
const pageOf = states => { const page = pageWith(states); return () => page; };
const took = async run => { const began = Date.now(); await run(); return Date.now() - began; };

test('a finished fill and a quiet page end the window early', async () => {
  const ms = await took(() => watchWindow(pageOf([{state: 'running'}, {state: 'done'}]), () => [], Date.now() + 10000, {quietMs: 600, minMs: 600}));
  assert.ok(ms < 4000, `took ${ms} ms`);
});

test('a fill still running keeps the whole window', async () => {
  const ms = await took(() => watchWindow(pageOf([{state: 'running'}]), () => [], Date.now() + 2000, {quietMs: 300, minMs: 300}));
  assert.ok(ms >= 1900, `ended after ${ms} ms while the fill ran`);
});

test('a page with no fill state keeps the whole window', async () => {
  const ms = await took(() => watchWindow(pageOf([null]), () => [], Date.now() + 2000, {quietMs: 300, minMs: 300}));
  assert.ok(ms >= 1900, `ended after ${ms} ms with no fill state`);
});

test('a request that keeps coming keeps the window open', async () => {
  const requests = [], timer = setInterval(() => requests.push({route: '/extension/log'}), 200);
  const ms = await took(() => watchWindow(pageOf([{state: 'done'}]), () => requests, Date.now() + 2000, {quietMs: 800, minMs: 300}));
  clearInterval(timer);
  assert.ok(ms >= 1900, `ended after ${ms} ms while requests kept coming`);
});

test('the panel\'s repeated report is not an act: it does not keep the window open', async () => {
  const requests = [], timer = setInterval(() => requests.push({route: '/extension/review'}), 200);
  const ms = await took(() => watchWindow(pageOf([{state: 'done'}]), () => requests, Date.now() + 10000, {quietMs: 600, minMs: 600}));
  clearInterval(timer);
  assert.ok(ms < 4000, `took ${ms} ms`);
});

test('only a pull request\'s page cases run the quick window; main, the daily run and a local run wait the whole window', async () => {
  const fs = await import('node:fs'), path = await import('node:path'), {windowMode} = await import('../lib/page-replay.mjs');
  const flow = fs.readFileSync(path.join(import.meta.dirname, '../../../.github/workflows/page-cases.yml'), 'utf8');
  assert.match(flow, /JP_REPLAY_WINDOW: \$\{\{ github\.event_name == 'pull_request' && 'quick' \|\| github\.event_name == 'workflow_dispatch' && inputs\.window \|\| 'full' \}\}/);   // a by-hand run picks its mode (default full) to measure PR seconds per case
  assert.match(flow, /schedule:\s*\n\s*- cron:/, 'the daily full run');
  assert.ok(!/JP_REPLAY_WINDOW/.test(fs.readFileSync(path.join(import.meta.dirname, '../../../.github/workflows/build.yml'), 'utf8')), 'main sets no quick mode');
  const was = process.env.JP_REPLAY_WINDOW;
  try {
    delete process.env.JP_REPLAY_WINDOW; assert.equal(windowMode(), 'full');
    process.env.JP_REPLAY_WINDOW = 'full'; assert.equal(windowMode(), 'full');
    process.env.JP_REPLAY_WINDOW = 'quick'; assert.equal(windowMode(), 'quick');
  } finally { if (was === undefined) delete process.env.JP_REPLAY_WINDOW; else process.env.JP_REPLAY_WINDOW = was; }
});

// Gitar on #2378 (28 Oct 2026): the extension leaves the fill's card id (a bare uuid) in <html data-jobpilotto-fill>; fillState now says `unreadable` for it, which is truthy, and the quick window
// ended on it. A wait leans on a state only when the page wrote one; a mark that is not a state is "nothing written", as before. Real reader, real in-page function, a stubbed document.
const cardIdPage = () => ({evaluate: async fn => {
  globalThis.document = {URL: 'https://e2e.wd3.myworkdayjobs.com/x', documentElement: {dataset: {jobpilottoFill: '3f2a9c1e-7b64-4d0a-9a53-0c1d2e3f4a5b'}}};
  try { return await fn(); } finally { delete globalThis.document; }
}});

test('a page whose mark is only the card id keeps the whole window, as a page with no state does', async () => {
  const ms = await took(() => watchWindow(() => cardIdPage(), () => [], Date.now() + 2000, {quietMs: 300, minMs: 300}));
  assert.ok(ms >= 1900, `ended after ${ms} ms on a mark that is not a state`);
});

test('a card-id mark is not waited for after a case, as a page with no state is not', async () => {
  const {fillSettled} = await import('../lib/page-replay.mjs');
  const ms = await took(() => fillSettled(cardIdPage(), 4000));
  assert.ok(ms < 250, `waited ${ms} ms for a mark that is not a state`);
});
