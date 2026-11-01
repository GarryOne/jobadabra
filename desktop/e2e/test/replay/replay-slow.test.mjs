// A pull request's page cases leave the slow ones to main and the daily run unless the PR touches their folder; main and the daily run replay every case (lib/replay-slow.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {loadCases} from '../../lib/page-replay.mjs';
import {readSlow, splitForPr, touchedCases} from '../../lib/replay-slow.mjs';

const item = name => ({name});

test('a slow case is left to main unless the PR touches its folder; a fast or unknown case always runs', () => {
  const cases = ['slow-a-1', 'slow-b-1', 'fast-1', 'brand-new-1'].map(item);
  const {run, left} = splitForPr(cases, {slow: ['slow-a-1', 'slow-b-1'], touched: ['slow-b-1']});
  assert.deepEqual(run.map(one => one.name), ['slow-b-1', 'fast-1', 'brand-new-1']);
  assert.deepEqual(left.map(one => one.name), ['slow-a-1']);
  assert.match(left[0].why, /slow/);
});

test('the PR touches a case through its own folder only', () => {
  assert.deepEqual(touchedCases(['desktop/e2e/recorded/a-1/case.json', 'desktop/e2e/recorded/a-1/page.html', 'desktop/e2e/recorded/b-1/case.json', 'extension/flow.js', 'desktop/e2e/recorded/README.md']).sort(), ['a-1', 'b-1']);
});

test('the slow list names only cases that exist, and is a third of them at most', () => {
  const names = new Set(loadCases().map(one => one.name)), {slow} = readSlow();
  assert.ok(slow.length > 0, 'a slow list');
  for (const name of slow) assert.ok(names.has(name), `${name} is in slow-cases.json but is not a recorded case (regenerate: node tools/slow-page-cases.mjs)`);
  assert.ok(slow.length <= names.size / 3);
});

test('only a pull request splits; main (build.yml) and the daily run replay every case', () => {
  const root = path.join(path.resolve(import.meta.dirname, '..'), '../../..');
  const flow = fs.readFileSync(path.join(root, '.github/workflows/page-cases.yml'), 'utf8');
  assert.match(flow, /JP_REPLAY_PR_SPLIT: \$\{\{ github\.event_name == 'pull_request' && '1' \|\| '' \}\}/);
  assert.ok(!/JP_REPLAY_PR_SPLIT/.test(fs.readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8')), 'main sets no split');
});
