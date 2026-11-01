// Tests of the pool's one order (lib/record-sites-order.mjs) and that every record-sites.mjs mode goes through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {orderPool, testedCounts} from '../../lib/record-sites-order.mjs';
import {runShare} from '../../lib/record-sites.mjs';

const pool = ['a', 'b', 'c', 'd', 'e'].map(shape => ({shape})), names = list => list.map(item => item.shape);
const report = (day, ...shapes) => ({day, results: Object.fromEntries(shapes.map(shape => [shape, {reached: 'form'}]))});

test('a pass stopped halfway, resumed by --all, starts with the rows it did not reach', () => {
  const stopped = [report('2026-10-11', 'a', 'b', 'c')];
  assert.deepEqual(names(orderPool(pool, stopped, '2026-10-12').order), ['d', 'e', 'a', 'b', 'c']);
});

test('never run first, then fewer runs beat an older last run, then the oldest, then the pool\'s own order', () => {
  const reports = [report('2026-10-01', 'a', 'b'), report('2026-10-05', 'a'), report('2026-10-08', 'c'), report('2026-10-09', 'a')];
  // a: 3 runs, b: 1 (old), c: 1 (newer), d,e never
  assert.deepEqual(names(orderPool(pool, reports, '2026-10-12').order), ['d', 'e', 'b', 'c', 'a']);
  assert.deepEqual(names(orderPool(pool, [], '2026-10-12').order), ['a', 'b', 'c', 'd', 'e'], 'nothing run: the pool\'s own order');
});

test('runs older than 14 days leave the count but not "last run"', () => {
  const counts = testedCounts([report('2026-09-01', 'a'), report('2026-10-10', 'b')], '2026-10-12');
  assert.deepEqual(counts.a, {count: 0, last: '2026-09-01'});
  assert.equal(counts.b.count, 1);
  const order = orderPool(pool.slice(0, 2), [report('2026-09-01', 'a'), report('2026-10-10', 'b')], '2026-10-12').order;
  assert.deepEqual(names(order), ['a', 'b'], 'a has 0 runs in the window, b has 1');
});

test('a row resting today is skipped and listed, not counted as tested', () => {
  const out = orderPool(pool, [], '2026-10-12', {rested: item => item.shape === 'a'});
  assert.deepEqual(names(out.order), ['b', 'c', 'd', 'e']);
  assert.deepEqual(names(out.rested), ['a']);
  assert.equal(out.lines.length, 4);
  assert.match(out.lines[0], /b: 0 run\(s\).*never run/);
});

test('a share takes the front of the same order; every mode in record-sites.mjs orders through orderPool, --only is the fixer\'s own', () => {
  assert.deepEqual(names(runShare(orderPool(pool, [report('2026-10-11', 'a', 'b')], '2026-10-12').order, 2)), ['c', 'd']);
  const source = fs.readFileSync(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '..', 'record-sites.mjs'), 'utf8');
  assert.match(source, /const ranked = only \? \{order: pool[^}]*\} : orderPool\(/, '--only keeps the pool as asked, everything else is ordered');
  assert.match(source, /const chosen = only \|\| process\.argv\.includes\('--all'\) \? ranked\.order : runShare\(ranked\.order/, 'share and --all take the one order');
  assert.doesNotMatch(source, /runShare\(pool/, 'no mode orders rows another way');
});
