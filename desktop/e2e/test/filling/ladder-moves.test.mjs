// The moves a test run confirmed (lib/ladder-moves.mjs): read from the app's own log (a run with the real app) or from the extension's requests to a stand-in app (a page case),
// counted exactly as the app's learning counts them, and sent from CI only, marked with their source so test data never poses as a user's (spec 2026-10-12-one-next-move.md, phase 1).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MOVES_SITE, distinctMoves, distinctRepairs, mergeMoves, movesFromLog, movesFromRequests, poolMoves, repairsFromLog, repairsFromRequests, sendMoves} from '../../lib/ladder-moves.mjs';

const at = '2026-10-12T10:00:00.000Z';
const line = (message, data) => `${at} [extension] ${message}${data ? ` ${JSON.stringify(data)}` : ''}`;
const SHAPE = 'jobs.lever.example/acme/*|f8+', POSTING = 'careers.example.ch/jobs/*|0';

test('the app log\'s ladder lines become counted moves, as the app counts them', () => {
  const log = [
    line('page kind: form', {shape: SHAPE, by: 'ai'}),
    line('ladder: confirmed by rung 2', {shape: SHAPE, kind: 'form', outcome: 'form'}),
    line('ladder: confirmed by rung 2', {shape: SHAPE, kind: 'form', outcome: 'form'}),
    line('ladder: learned by rung 3', {shape: POSTING, kind: 'posting', outcome: 'form'}),
    line('ladder: learned answer confirmed', {shape: POSTING}),
    `${at} [review] ladder: confirmed by rung 2 {"shape":"other.example/x|0","kind":"form","outcome":"form"}`,   // another area: not the app's ladder line
    'garbage line',
  ].join('\n');
  assert.deepEqual(movesFromLog(log), [
    {shape: POSTING, rung: 3, kind: 'posting', outcome: 'form', hits: 1, misses: 0},
    {shape: SHAPE, rung: 2, kind: 'form', outcome: 'form', hits: 2, misses: 0},
  ]);
});

test('a contradiction in the log counts a miss; a page kind forgotten with nothing kept counts nothing', () => {
  const log = [
    line('ladder: confirmed by rung 1', {shape: SHAPE, kind: 'form', outcome: 'form'}),
    line('page kind forgotten: a form with no fields', {shape: SHAPE, was: 'form'}),
    line('page kind forgotten: a form with no fields', {shape: '(nothing kept)', was: ''}),
  ].join('\n');
  assert.deepEqual(movesFromLog(log), [{shape: SHAPE, rung: 1, kind: 'form', outcome: 'form', hits: 1, misses: 1}]);
});

test('a log line with text where a fixed value belongs counts nothing', () => {
  const log = [
    line('ladder: confirmed by rung 2', {shape: 'https://x.example/a?token=1', kind: 'form', outcome: 'form'}),
    line('ladder: confirmed by rung 2', {shape: SHAPE, kind: 'Send your CV to jane@x.example', outcome: 'form'}),
    line('ladder: confirmed by rung 9', {shape: SHAPE, kind: 'form', outcome: 'form'}),
    line('ladder: confirmed by rung 2', {shape: SHAPE, kind: 'form', outcome: 'jane@x.example'}),
    `${at} [extension] ladder: confirmed by rung 2 {not json`,
  ].join('\n');
  assert.deepEqual(movesFromLog(log), []);
});

test('a page case\'s requests to the stand-in app become the same counted moves (shape by the app\'s own key)', () => {
  const controls = [{type: 'text', label: 'First name'}, {type: 'email', label: 'Email'}, {type: 'file', label: 'CV'}];
  const requests = [
    {route: '/extension/page-kind', body: JSON.stringify({url: 'https://careers.example.ch/jobs/123', title: 'T'})},   // an ask: no move
    {route: '/extension/page-kind', body: JSON.stringify({verified: true, url: 'https://careers.example.ch/jobs/123', controls: [], rung: 2, outcome: 'form', kind: 'posting', signal: 'confident'})},
    {route: '/extension/page-kind', body: JSON.stringify({verified: true, url: 'https://careers.example.ch/jobs/123/apply', controls, rung: 0, outcome: 'form', kind: 'form', signal: 'confident'})},
    {route: '/extension/log', body: JSON.stringify({verified: true, url: 'https://careers.example.ch/jobs/9', controls: [], rung: 2, outcome: 'form', kind: 'posting'})},   // another route
    {route: '/extension/page-kind', body: '{broken'},
  ];
  assert.deepEqual(movesFromRequests(requests), [
    {shape: 'careers.example.ch/jobs/*/apply|f1-2', rung: 0, kind: 'form', outcome: 'form', hits: 1, misses: 0},
    {shape: POSTING, rung: 2, kind: 'posting', outcome: 'form', hits: 1, misses: 0},
  ]);
});

test('the moves of several rows add up per shape and decision', () => {
  const one = {shape: SHAPE, rung: 2, kind: 'form', outcome: 'form', hits: 1, misses: 0};
  assert.deepEqual(mergeMoves([[one], [one, {...one, rung: 1}], []]), [{...one, rung: 1}, {...one, hits: 2}]);
  assert.deepEqual(distinctMoves([[{...one, hits: 3}], [one, {...one, rung: 1, misses: 2}]]), [{...one, rung: 1, hits: 1}, one], 'replays: each move once');
});

test('sent from CI only, with its source and the narrow CI key; a dry run says what it would send', async () => {
  const rows = [{shape: SHAPE, rung: 2, kind: 'form', outcome: 'form', hits: 1, misses: 0}];
  const calls = [], fetcher = async (url, init) => { calls.push({url, init}); return {ok: true, json: async () => ({ok: true, ladder: 1})}; };
  assert.match(await sendMoves(rows, {source: 'ci', env: {}, fetcher}), /not sent \(a local run/);
  assert.match(await sendMoves(rows, {source: 'ci', env: {CI: 'true'}, fetcher}), /not sent \(REPLAYS_PUBLISH_KEY/);
  assert.match(await sendMoves(rows, {source: 'user', env: {CI: 'true', REPLAYS_PUBLISH_KEY: 'k'}, fetcher}), /not sent \(source/);
  assert.match(await sendMoves(rows, {source: 'ci', env: {CI: 'true', REPLAYS_PUBLISH_KEY: 'k', REAL_EXTENSION_DIR: '/old'}, fetcher}), /not sent \(a control run/);
  assert.match(await sendMoves(rows, {source: 'ci', env: {CI: 'true', REPLAYS_PUBLISH_KEY: 'k', JP_MOVES_DRY: '1'}, fetcher}), /dry run: would send 1 move/);
  assert.match(await sendMoves([], {source: 'ci', env: {CI: 'true', REPLAYS_PUBLISH_KEY: 'k'}, fetcher}), /nothing to send/);
  assert.equal(calls.length, 0);
  assert.match(await sendMoves(rows, {source: 'replay', env: {CI: 'true', REPLAYS_PUBLISH_KEY: 'k', GITHUB_RUN_ID: '42'}, fetcher}), /1 move\(s\) sent \(replay\)/);
  assert.equal(calls[0].url, MOVES_SITE);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual([body.source, body.run, body.ladder], ['replay', '42', rows]);
  assert.match(body.install, /^[\w-]{8,64}$/);
});

test('a CI pool run\'s report: the moves per row that ran, and how many rows that reached a form have one (the phase-1 proof)', async () => {
  const {poolMoves} = await import('../../lib/ladder-moves.mjs');
  const report = {day: '2026-10-12', thisRun: {ran: ['Lever: single page', 'Personio form in German', 'Blocked one']}, results: {
    'Lever: single page': {reached: 'form'}, 'Personio form in German': {reached: 'ready'}, 'Blocked one': {reached: 'code/bot'}, 'Earlier today': {reached: 'form'}}};
  const logs = {'2026-10-12-Lever-single-page.app.log': line('ladder: confirmed by rung 2', {shape: SHAPE, kind: 'form', outcome: 'form'})};
  const out = poolMoves(report, name => logs[name] || '');
  assert.deepEqual(out.rows.map(row => [row.row, row.reached, row.moves.length]), [['Lever: single page', 'form', 1], ['Personio form in German', 'ready', 0], ['Blocked one', 'code/bot', 0]]);
  assert.deepEqual(out.formRows, {reached: 2, withMove: 1});
  assert.deepEqual(out.moves, [{shape: SHAPE, rung: 2, kind: 'form', outcome: 'form', hits: 1, misses: 0}]);
  assert.match(out.lines.join('\n'), /Lever: single page \| form \| 1 \| rung 2 form→form ×1/);
  assert.match(out.lines.at(-1), /rows that reached a form: 2, with a confirmed move: 1/);
});

test('the control level\'s repairs ride the same batch, fixed words and integers only', async () => {
  const {cleanRepair} = await import('../../lib/ladder-moves.mjs');
  const calls = [], fetcher = async (url, init) => { calls.push(JSON.parse(init.body)); return {ok: true, json: async () => ({ok: true})}; };
  const env = {CI: 'true', REPLAYS_PUBLISH_KEY: 'k', GITHUB_RUN_ID: '9'};
  const good = {fp: '1d2pcapx18', verb: 'click_option', ok: 2, failed: 1};
  assert.match(await sendMoves([], {source: 'ci', repairs: [good, {fp: 'NOT VALID', verb: 'x', ok: 1, failed: 0}, {...good, verb: 'Type jane@x.example'}, {...good, ok: 0, failed: 0}], env, fetcher}), /0 move\(s\) and 1 repair\(s\) sent \(ci\)/);
  assert.deepEqual(calls[0].repairs, [good]);
  assert.equal(cleanRepair({...good, extra: 'text'}).extra, undefined);
  await sendMoves([{shape: SHAPE, rung: 2, kind: 'form', outcome: 'form', hits: 1, misses: 0}], {source: 'ci', env, fetcher});
  assert.equal('repairs' in calls[1], false, 'no repairs: no field');
});

test('the control repairs a run did are counted per fingerprint and verb, from the app log (the pool) and from the extension\'s requests (the replays)', () => {
  const log = [
    line('fill: retype on control 3', {worked: true, fp: 'abc123'}), line('fill: retype on control 3', {worked: false, fp: 'abc123'}), line('fill: retype on control 4', {worked: true, fp: 'abc123'}),
    line('fill: choose_option on control 1', {worked: true, fp: 'menu42x'}),
    line('fill: retype on control 2', {worked: true, fp: 'Not A Fingerprint'}), line('fill: retype on control 2', {worked: true}),   // no usable fingerprint: dropped
    line('fill repair', {asked: 2, tried: 2, worked: 1}), line('fill: filled the form', {})].join('\n');
  assert.deepEqual(repairsFromLog(log), [{fp: 'abc123', verb: 'retype', ok: 2, failed: 1}, {fp: 'menu42x', verb: 'choose_option', ok: 1, failed: 0}]);
  const request = results => ({route: '/extension/account-judge', body: JSON.stringify({phase: 'repair-result', results})});
  assert.deepEqual(repairsFromRequests([request([{fp: 'abc123', verb: 'retype', ok: true}, {fp: 'abc123', verb: 'retype', ok: false}]), {route: '/extension/answer', body: '{}'}, request([{fp: 'Bad Fp', verb: 'retype', ok: true}])]),
    [{fp: 'abc123', verb: 'retype', ok: 1, failed: 1}]);
  assert.deepEqual(distinctRepairs([[{fp: 'abc123', verb: 'retype', ok: 3, failed: 0}], [{fp: 'abc123', verb: 'retype', ok: 0, failed: 2}], [{fp: 'menu42x', verb: 'commit', ok: 1, failed: 0}]]),
    [{fp: 'abc123', verb: 'retype', ok: 1, failed: 1}, {fp: 'menu42x', verb: 'commit', ok: 1, failed: 0}], 'a replayed repair is one repair, as a replayed move is one move');
});

test('a pool run\'s repairs come from all its rows\' logs and travel in the pool\'s batch', () => {
  const report = {day: '2026-10-12', thisRun: {ran: ['A', 'B']}, results: {A: {reached: 'form'}, B: {reached: 'form'}}};
  const logs = {'2026-10-12-A.app.log': line('fill: retype on control 1', {worked: true, fp: 'abc123'}), '2026-10-12-B.app.log': line('fill: retype on control 5', {worked: false, fp: 'abc123'})};
  assert.deepEqual(poolMoves(report, name => logs[name] || '').repairs, [{fp: 'abc123', verb: 'retype', ok: 1, failed: 1}]);
});
