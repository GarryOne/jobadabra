// The CI replay's bookkeeping (replay-records.mjs): the newest record per pool row, its "Replay vs live" record, and "N of M same as live". Pure: no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {deferredRows, fidelityRecord, newestPerRow, sameAsLive, whereOf} from '../../replay-records.mjs';

test('each pool row replays its newest record; a record without a name goes by its posting host', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-records-'));
  const put = (dir, record) => { fs.mkdirSync(path.join(root, dir), {recursive: true}); fs.writeFileSync(path.join(root, dir, 'record.json'), JSON.stringify(record)); };
  put('run1/a', {name: 'Row A', url: 'https://a.test/job', startMs: 1});
  put('run2/a', {name: 'Row A', url: 'https://a.test/job', startMs: 5});
  put('run2/b', {url: 'https://www.b.test/job', startMs: 3});
  const rows = newestPerRow(root);
  assert.deepEqual(rows.map(row => [row.name, row.record.startMs]), [['Row A', 5], ['www.b.test', 3]]);
});

test('two copies of one recording (a refill changes only the answers, not startMs): the later bundle wins, whatever order the folder lists in', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-records-'));
  const put = (dir, record, memo) => { fs.mkdirSync(path.join(root, dir), {recursive: true}); fs.writeFileSync(path.join(root, dir, 'record.json'), JSON.stringify(record)); fs.writeFileSync(path.join(root, dir, 'model-memo.json'), JSON.stringify(memo)); };
  const record = {name: 'Row A', url: 'https://a.test/job', startMs: 7};
  put('mac/net-records-20261015T075956Z/a', record, {old: 1});
  put('mac/net-records-20261015T110251Z/a', record, {old: 1, refilled: 2});
  put('mac/net-records-20261015T081300Z/other', {name: 'Row B', url: 'https://b.test/job', startMs: 9}, {});
  const [a] = newestPerRow(root).filter(row => row.name === 'Row A');
  assert.match(a.dir, /net-records-20261015T110251Z/, 'the refilled copy of the same recording is the one replayed');
  const orig = fs.readdirSync;   // a file system that lists the newest folder first (Linux does not sort): the same row wins
  fs.readdirSync = (dir, ...rest) => { const list = orig(dir, ...rest); return Array.isArray(list) ? [...list].reverse() : list; };
  try { assert.match(newestPerRow(root).find(row => row.name === 'Row A').dir, /net-records-20261015T110251Z/, 'listing order does not decide'); } finally { fs.readdirSync = orig; }
});

test('a row is the same as live only with every live ask answered, no extra ask and no site request missing; a third party miss does not count', () => {
  const row = {name: 'Row A', record: {url: 'https://www.a.test/job'}};
  const same = fidelityRecord(row, {liveAsks: 4, liveHit: 4, misses: 0, counts: {order: 2, notRecorded: ['GET https://tracker.other.test/x (script)']}});
  const off = fidelityRecord(row, {liveAsks: 4, liveHit: 3, misses: 1, counts: {notRecorded: ['GET https://jobs.a.test/api (fetch)']}});
  assert.equal(same.network.notRecorded, 0);
  assert.equal(off.network.notRecorded, 1);
  assert.equal(fidelityRecord(row, null).network, null, 'a replay with no result is reported, never counted as a pass');
  assert.deepEqual(fidelityRecord(row, {liveAsks: 4, liveHit: 1, misses: 3, firstMiss: {differs: ['output'], volatile: []}}).firstMiss, {differs: ['output']}, 'the first miss\'s differing parts go to the gate (names only)');
  assert.equal(fidelityRecord(row, {liveAsks: 4, liveHit: 4}).firstMiss, null);
  assert.equal(sameAsLive([same, off, fidelityRecord(row, null)]), 1);
});

test('a record says where it was made (its own word, else the Mac release folder) and when; an unnamed record finds its pool row by address; a deferred row carries its reason', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-records-'));
  fs.mkdirSync(path.join(root, 'mac', 'x'), {recursive: true});
  fs.writeFileSync(path.join(root, 'mac', 'x', 'record.json'), JSON.stringify({url: 'https://jobs.a.test/job?id=1#jobadabra-fill=ab', startMs: Date.parse('2026-10-13T22:00:00Z')}));
  const [row] = newestPerRow(root, new Map([['https://jobs.a.test/job?id=1', 'Row A (found 2026-10-10)']]));
  assert.equal(row.name, 'Row A (found 2026-10-10)');
  const record = fidelityRecord(row, {liveAsks: 2, liveHit: 2, misses: 0, counts: {}}, {deferred: {'Row A (found 2026-10-10)': 'replay lags'}});
  assert.deepEqual(record.recording, {where: 'mac', at: '2026-10-13T22:00:00.000Z'});
  assert.equal(record.deferred, 'replay lags');
  assert.equal(whereOf({where: 'ci'}, '/x/mac/y'), 'ci', 'the record\'s own word wins');
  assert.equal(whereOf({}, '/records/38473536545/a'), 'ci');
});

test('every deferred row names a real pool row', () => {
  const shapes = new Set(JSON.parse(fs.readFileSync(new URL('../../smoke-sites.json', import.meta.url), 'utf8')).shapes.map(site => site.shape));
  for (const name of Object.keys(deferredRows())) assert.ok(shapes.has(name), `replay-deferred.json: "${name}" is not a pool row`);
});

// A deferral is a dated promise (14 Oct 2026: Databricks was deferred, un-deferred and deferred again in 1.5 h; a parked row was never looked at again).
const deferralProblems = (rows, watch) => Object.keys(rows).flatMap(name => {
  const w = watch?.[name] || {};
  return [...(String(w.owner || '').trim() ? [] : [`"${name}" has no owner`]), ...(/^\d{4}-\d{2}-\d{2}$/.test(w.recheck || '') && !Number.isNaN(Date.parse(w.recheck)) ? [] : [`"${name}" has no re-check date (YYYY-MM-DD)`])];
});

test('every deferred row carries an owner and a re-check date, and the check refuses a row without them', () => {
  const file = JSON.parse(fs.readFileSync(new URL('../../replay-deferred.json', import.meta.url), 'utf8'));
  assert.deepEqual(deferralProblems(file.rows, file.watch), []);
  assert.equal(deferralProblems({a: 'why'}, {}).length, 2);
  assert.equal(deferralProblems({a: 'why'}, {a: {owner: 'x', recheck: 'soon'}}).length, 1);
  assert.equal(deferralProblems({a: 'why'}, {a: {owner: '', recheck: '2026-10-21'}}).length, 1);
});

test('a shard "k/n" takes every n-th row from the k-th; no or a bad spec takes all (the scheduled replay\'s 5 runners)', async () => {
  const {shardOf} = await import('../../replay-records.mjs');
  const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepEqual(shardOf(rows, '0/5'), ['a', 'f']);
  assert.deepEqual(shardOf(rows, '4/5'), ['e']);
  assert.deepEqual([0, 1, 2, 3, 4].flatMap(k => shardOf(rows, `${k}/5`)).sort(), rows, 'every row once');
  for (const spec of ['', '5/5', 'x', '1/0']) assert.deepEqual(shardOf(rows, spec), rows);
});

test('the CLI prints one line per row as it starts and ends, so a CI step is never silent for minutes', async () => {
  const {spawnSync} = await import('node:child_process');
  const os = await import('node:os');
  const fsm = await import('node:fs');
  const pathm = await import('node:path');
  const root = fsm.mkdtempSync(pathm.join(os.tmpdir(), 'replay-records-'));
  fsm.mkdirSync(pathm.join(root, 'records', 'row-a'), {recursive: true});
  fsm.writeFileSync(pathm.join(root, 'records', 'row-a', 'record.json'), JSON.stringify({name: 'Row A', url: 'https://jobs.example.com/a', startMs: 1}));
  const ran = spawnSync(process.execPath, [new URL('../../replay-records.mjs', import.meta.url).pathname, pathm.join(root, 'records'), pathm.join(root, 'out')], {encoding: 'utf8', timeout: 60000});
  assert.match(ran.stderr, /replay-records: \[1\/1\] Row A: replaying/);
  assert.match(ran.stderr, /replay-records: \[1\/1\] Row A: no result \(\d+ s\)/);
  fsm.rmSync(root, {recursive: true, force: true});
});

test('a replay\'s loose hits (kept answers served although the system side changed) go to the record, parts by name', () => {
  const row = {name: 'Row A', record: {url: 'https://www.a.test/job'}};
  const got = fidelityRecord(row, {liveAsks: 4, liveHit: 4, misses: 0, looseHits: 2, looseParts: ['system:0', 'model']});
  assert.deepEqual([got.network.loose, got.network.looseParts], [2, ['system:0', 'model']]);
  assert.equal(fidelityRecord(row, {liveAsks: 4, liveHit: 4, misses: 0}).network.loose, 0);
});
