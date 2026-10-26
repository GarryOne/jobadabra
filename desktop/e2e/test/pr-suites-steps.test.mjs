// A suite that quotes UI text a PR removes runs only the step that quotes it (PR 2 of the PR-checks plan; on #1992 six suites ran whole for one removed label).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stepCalls, stepsQuoting} from '../lib/pr-suites.mjs';

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
