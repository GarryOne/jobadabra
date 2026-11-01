// Guards lib/replay-shard.mjs: the CI matrix splits the recorded cases across jobs; every case runs in exactly one shard, whatever the shard count.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadCases} from '../../lib/page-replay.mjs';
import {costOf, parseShard, readSeconds, shardOf} from '../../lib/replay-shard.mjs';
import {readSlow, splitForPr} from '../../lib/replay-slow.mjs';

test('every recorded case lands in exactly one shard, for any shard count', () => {
  const cases = loadCases();
  assert.ok(cases.length > 20, 'the recorded cases are found');
  for (let count = 1; count <= 9; count += 1) {
    const names = [];
    for (let index = 1; index <= count; index += 1) names.push(...shardOf(cases, index, count).map(one => one.name));
    assert.deepEqual(names.sort(), cases.map(one => one.name).sort(), `${count} shards: no case dropped or run twice`);
  }
});

test('the shards are balanced by what a case costs, not by count', () => {
  const cases = Array.from({length: 8}, (_, n) => ({name: `c${n}`, expect: {seconds: n < 2 ? 60 : 10, notTold: ['x']}, pages: []}));
  const [a, b] = [shardOf(cases, 1, 2), shardOf(cases, 2, 2)];
  assert.notEqual(a.filter(one => one.expect.seconds === 60).length, 2, 'the two long cases are not in one shard');
  assert.notEqual(b.filter(one => one.expect.seconds === 60).length, 2);
});

test('a shard spec is "i/n" with 1 <= i <= n, and anything else is refused', () => {
  assert.deepEqual(parseShard('2/4'), {index: 2, count: 4});
  assert.equal(parseShard(''), null, 'no spec: the whole set');
  for (const bad of ['0/4', '5/4', '1/0', 'a/b', '3']) assert.throws(() => parseShard(bad), /shard/, bad);
});

test('measured seconds win over the declared window, and a case the measured run lacks costs a typical 25 s', () => {
  const item = {name: 'a-1', expect: {seconds: 60, notTold: ['x']}};
  assert.equal(costOf(item, {'a-1': 7}), 7);
  assert.equal(costOf(item, {'b-1': 7}), 25, 'measured run exists, this case is not in it');
  assert.equal(costOf(item, {}), 60, 'no measurement at all: the declared window');
});

test('the two shards of a pull request carry the same measured seconds, within 5% of the total', () => {
  const seconds = readSeconds(), all = loadCases();
  assert.ok(Object.keys(seconds).length > 50, 'CI case seconds are there (fixtures/slice-ci-seconds.json)');
  const {run} = splitForPr(all, {slow: readSlow().slow, touched: []});
  const load = index => shardOf(run, index, 2).reduce((sum, one) => sum + costOf(one, seconds), 0);
  const [first, second] = [load(1), load(2)];
  assert.ok(Math.abs(first - second) <= 0.05 * (first + second), `shard 1 ${first} s, shard 2 ${second} s`);
});
