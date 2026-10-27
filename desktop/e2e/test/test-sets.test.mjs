// Every harness test file sits in exactly one set (PR or daily), so a new test must be placed in test-sets.json on purpose.
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {test} from 'node:test';
import {testSets} from '../test-sets.mjs';

const onDisk = readdirSync(new URL('.', import.meta.url)).filter((f) => /\.test\.m?js$/.test(f)).sort();

test('every test file is in exactly one set, and no set names a missing file', () => {
  const {pr, daily} = testSets();
  const seen = new Map();
  for (const [set, files] of [['pr', pr], ['daily', daily]]) for (const f of files) seen.set(f, [...(seen.get(f) || []), set]);
  const twice = [...seen].filter(([, sets]) => sets.length > 1).map(([f]) => f);
  assert.deepEqual(twice, [], 'in both sets');
  assert.deepEqual(onDisk.filter((f) => !seen.has(f)), [], 'in no set: add it to desktop/e2e/test-sets.json ("pr" only if it guards privacy or a judgment)');
  assert.deepEqual([...seen.keys()].filter((f) => !onDisk.includes(f)), [], 'listed but missing');
});

// Why (owner, 27 Oct 2026: "add only what we're missing on the CI"): fill-overlay.test.mjs (the overlay that holds back the person's clicks while the extension fills,
// 19 tests, about 100 s with a browser) joined the PR set as a missing check; the rest of the set still takes about a minute.
test('the PR set stays small', () => {
  assert.ok(testSets().pr.length <= 31, 'the PR set is meant to take about a minute, plus the fill overlay');
});
