// The daily watch's two CLIs (watch-pick.mjs, watch-report.mjs): the pick at the month's cap, the report's one message, the state it hands on.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {main as pick} from '../../watch-pick.mjs';
import {failedJourneys, main as report} from '../../watch-report.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
const quiet = async fn => { const log = console.log; const lines = []; console.log = (...args) => lines.push(args.join(' ')); try { return {code: await fn(), lines}; } finally { console.log = log; } };
const form = (extra = {}) => ({url: 'https://careers.a.example/j/1', reached: 'form', filled: 9, left: 0, ending: 'ready', cause: 'ready', usd: 0.05, ...extra});
const state = (dir, run, body) => { fs.mkdirSync(path.join(dir, run), {recursive: true}); fs.writeFileSync(path.join(dir, run, 'watch.json'), JSON.stringify(body)); };

test('the pick lists the watch rows and sets its outputs; at the cap it records nothing and tells once a month', async () => {
  const dir = tmp(), out = path.join(dir, 'out'), states = path.join(dir, 'states'), github = path.join(dir, 'output.txt'), sent = [];
  const env = {WATCH_NOW: '2026-10-17T05:00:00Z', GITHUB_OUTPUT: github}, send = async text => { sent.push(text); return 'sent'; };
  await quiet(() => pick([out, states], env, send));
  const first = fs.readFileSync(github, 'utf8');
  assert.match(first, /count=10\n/);
  assert.match(first, /only=.*Richemont Workday/);
  assert.match(first, /max_usd=1\.20\n/);
  assert.deepEqual(sent, [], 'under the cap: no message');
  state(states, '1', {at: '2026-10-03T05:00:00Z', usd: 24.99, rows: {}});
  fs.writeFileSync(github, '');
  await quiet(() => pick([out, states], env, send));
  assert.match(fs.readFileSync(github, 'utf8'), /count=0\n.*cap_alert=1/s);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Daily watch paused/);
  state(states, '2', JSON.parse(fs.readFileSync(path.join(out, 'alert-state', 'watch.json'), 'utf8')));
  await quiet(() => pick([out, states], env, send));
  assert.equal(sent.length, 1, 'told once a month');
});

test('the report: day 1 sends nothing, a worse flow sends ONE message, the state keeps each row\'s last measured result', async () => {
  const dir = tmp(), reports = path.join(dir, 'reports'), states = path.join(dir, 'states'), sent = [];
  fs.mkdirSync(reports, {recursive: true});
  fs.writeFileSync(path.join(dir, 'picked.json'), JSON.stringify({rows: ['Row A', 'Row B', 'Row C']}));
  const run = (results, at, outName) => { fs.writeFileSync(path.join(reports, '2026-10-17.json'), JSON.stringify({results, thisRun: {ran: Object.keys(results)}})); return quiet(() => report([reports, path.join(dir, 'picked.json'), path.join(dir, outName), states], {WATCH_NOW: at}, async text => { sent.push(text); return 'sent'; })); };
  await run({'Row A': form(), 'Row B': form(), 'Row C': {reached: 'account', ending: 'held', note: 'account-first: held'}}, '2026-10-17T05:30:00Z', 'out1');
  assert.deepEqual(sent, [''], 'day 1: nothing to say (the poster is called with an empty text and sends nothing)');
  const one = JSON.parse(fs.readFileSync(path.join(dir, 'out1', 'watch.json'), 'utf8'));
  assert.deepEqual(Object.keys(one.rows).sort(), ['Row A', 'Row B']);
  assert.equal(one.usd, 0.1);
  state(states, '1', one);
  await run({'Row A': form({reached: 'posting', ending: 'unresolved', cause: 'no-reason'}), 'Row B': form(), 'Row C': {reached: 'account', ending: 'held', note: 'account-first: held'}}, '2026-10-18T05:30:00Z', 'out2');
  assert.equal(sent.length, 2);
  assert.match(sent[1], /1 of 2 flows worse/);
  assert.match(sent[1], /• Row A: stopped early/);
  assert.match(sent[1], /1 held/);
});

test('journey-run\'s failure lines name the rows, a failed or missing journey alike', () => {
  const log = ['journey-run: Row A (daily watch row)', 'journey-run: FAIL Row A (exit 1)', 'journey-run: FAIL Row B: no record of this row (a journey with nothing to replay is red, never skipped)', 'journey-run: 2 FAILED of 3'].join('\n');
  assert.deepEqual([...failedJourneys(log)].sort(), ['Row A', 'Row B']);
});
