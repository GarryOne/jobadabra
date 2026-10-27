// The scoring of the fast local checks (check:fill) without a browser: a failure lands in the bucket the form benchmark would give it, a drop from main's numbers is red,
// a quick run is compared only over its own cases, and a harness that ran nothing is never a pass. Run: node --test test/check-fill.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bucketOf, compare, summarize} from '../lib/check-fill-score.mjs';

const fail = (...failures) => ({ok: false, failures});

test('a passing case is right; a missing result (the browser died) is not reached', () => {
  assert.equal(bucketOf({ok: true, failures: []}), 'right');
  assert.equal(bucketOf(undefined), 'not reached');
});

test('a failure names its bucket: wrong value, empty box, page not reached', () => {
  assert.equal(bucketOf(fail('valueIs: #n|Test')), 'wrong');
  assert.equal(bucketOf(fail('notTold: pressed the Apply button')), 'wrong');
  assert.equal(bucketOf(fail('truth: start holds "02.11.2026"')), 'wrong');
  assert.equal(bucketOf(fail('filled: #email')), 'empty');
  assert.equal(bucketOf(fail('present: #lang-box .select__single-value')), 'empty');
  assert.equal(bucketOf(fail('asked: First name')), 'not reached');
  assert.equal(bucketOf(fail('error: page crashed')), 'not reached');
  assert.equal(bucketOf(fail('filled: #a', 'valueIs: #b|x')), 'wrong', 'a wrong value is worse than an empty box');
});

test('a case main had right that is not right is red; one main had not right never is', () => {
  const base = summarize([{name: 'a', bucket: 'right'}, {name: 'b', bucket: 'empty'}, {name: 'c', bucket: 'right'}]);
  const same = compare(base, summarize([{name: 'a', bucket: 'right'}, {name: 'b', bucket: 'empty'}]));
  assert.deepEqual(same.red, []);
  assert.deepEqual(same.main, {right: 1, wrong: 0, empty: 1, 'not reached': 0}, 'main is counted over the cases this run has');
  assert.deepEqual(compare(base, summarize([{name: 'a', bucket: 'empty'}, {name: 'b', bucket: 'right'}])).red, ['a (empty)']);
  assert.deepEqual(compare(base, summarize([{name: 'new', bucket: 'wrong'}])).red, [], 'a case main never saw is only counted');
});
