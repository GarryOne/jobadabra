// A suite that quotes UI text a PR removes runs only the step that quotes it (PR 2 of the PR-checks plan; on #1992 six suites ran whole for one removed label).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newSideRanges, stepCalls, stepsQuoting, stepsTouched} from '../lib/pr-suites.mjs';

const SUITE = `import {x} from '../lib/y.mjs';
const helper = () => 'Old helper text here';
export default async ctx => {
  await ctx.run('Open, the Jobs page', async () => { await see('More employers'); /* ) */ const s = "a ) b"; });
  await ctx.run(\`Card for \${name}\`, async () => { await see('Dynamic name text'); });
  await ctx.run('Live updates keep each result', async () => {
    await see(\`More employers\`);
  });
};`;

test('each ctx.run call: its literal name and its extent, past strings and comments with parentheses', () => {
  const calls = stepCalls(SUITE);
  assert.deepEqual(calls.map(call => call.name), ['Open, the Jobs page', null, 'Live updates keep each result']);
  assert.ok(SUITE.slice(calls[0].start, calls[0].end).includes('a ) b'));
});

test('a quote inside steps picks those steps; outside a literal step or in a lib the whole suite', () => {
  const sources = {'suites/jobs.mjs': SUITE};
  assert.deepEqual(stepsQuoting({jobs: ['More employers']}, sources), {jobs: {steps: ['Open, the Jobs page', 'Live updates keep each result'], whole: false}});
  assert.equal(stepsQuoting({jobs: ['Old helper text here']}, sources).jobs.whole, true);
  assert.equal(stepsQuoting({jobs: ['Dynamic name text']}, sources).jobs.whole, true);
  assert.equal(stepsQuoting({jobs: ['Only in a lib file']}, sources).jobs.whole, true);
});

// A change to a suite's own file runs the steps it touches (owner, 26 Oct 2026: "a change to a suite runs that suite's affected steps (apply/applyflows included)").
const OWN = `import {x} from '../lib/y.mjs';
const helper = () => 1;
export default async ctx => {
  await ctx.run('first step', async () => {
    await one();
  });

  await ctx.run('second step', async () => {
    await two();
  });
};`;

test('a changed line inside a step picks that step; its first and closing lines count as inside it', () => {
  assert.deepEqual(stepsTouched(OWN, [[5, 5]]), {steps: ['first step'], whole: false});
  assert.deepEqual(stepsTouched(OWN, [[8, 8]]), {steps: ['second step'], whole: false}, 'the `await ctx.run(` line: a renamed or new step');
  assert.deepEqual(stepsTouched(OWN, [[10, 10]]), {steps: ['second step'], whole: false}, 'the closing `});`');
  assert.deepEqual(stepsTouched(OWN, [[5, 9]]), {steps: ['first step', 'second step'], whole: false}, 'a range across two steps picks both; the blank line between is nobody\'s');
});

test('a changed line outside any step (an import, a helper, the suite\'s frame) runs the whole suite', () => {
  assert.equal(stepsTouched(OWN, [[1, 1]]).whole, true);
  assert.equal(stepsTouched(OWN, [[2, 2]]).whole, true);
  assert.equal(stepsTouched(OWN, [[11, 11]]).whole, true);
});

test('a comment-only or blank changed line runs nothing', () => {
  const text = `// header\n${OWN}`;
  assert.deepEqual(stepsTouched(text, [[1, 1]]), {steps: [], whole: false});
  assert.deepEqual(stepsTouched(OWN, [[7, 7]]), {steps: [], whole: false});
});

test('newSideRanges: the added or changed lines on the new side; a deletion is the line after it', () => {
  const diff = '--- a/x\n+++ b/desktop/e2e/suites/a.mjs\n@@ -4,0 +5,2 @@\n+a\n+b\n@@ -9 +11 @@\n-x\n+y\n@@ -20,2 +21,0 @@\n-z\n-w\n';
  assert.deepEqual(newSideRanges(diff), {'desktop/e2e/suites/a.mjs': [[5, 6], [11, 11], [22, 22]]});
});
