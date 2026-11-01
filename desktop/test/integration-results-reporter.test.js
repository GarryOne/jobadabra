// The integration results reporter (desktop/integration/results-reporter.mjs): one JSON file of tests, repo-relative files, pass/fail, time and the failure's first line.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import results from '../integration/results-reporter.mjs';

async function run(events) {
  let out = '';
  for await (const chunk of results((async function* () { yield* events; })())) out += chunk;
  return JSON.parse(out);
}
const pass = (name, ms = 5, extra = {}) => ({type: 'test:pass', data: {name, file: `/work/repo/desktop/integration/app/a.test.js`, details: {duration_ms: ms, type: 'test'}, ...extra}});

test('passes and failures become rows; suites, skips and the parent of a failing subtest are not tests', async () => {
  process.env.INTEGRATION_LAYER = 'store'; process.env.INTEGRATION_PLATFORM = 'linux';
  const file = await run([pass('one', 12.4), {type: 'test:pass', data: {name: 'a suite', details: {type: 'suite', duration_ms: 99}}}, pass('later', 1, {skip: true}),
    {type: 'test:fail', data: {name: 'two', file: `/work/repo/desktop/integration/app/a.test.js`, details: {duration_ms: 7, type: 'test', error: {message: 'wrapped', cause: {message: 'expected 1\nreceived 2'}}}}},
    {type: 'test:fail', data: {name: 'parent', file: `/work/repo/desktop/integration/app/a.test.js`, details: {duration_ms: 9, type: 'test', error: {code: 'ERR_TEST_FAILURE', message: '1 subtest failed'}}}}]);
  assert.deepEqual([file.v, file.layer, file.platform, file.tests.length], [1, 'store', 'linux', 2]);
  assert.deepEqual(file.tests[0], {name: 'one', file: 'desktop/integration/app/a.test.js', ok: true, ms: 12});
  assert.deepEqual([file.tests[1].ok, file.tests[1].failure], [false, 'expected 1']);
  assert.ok(file.ms >= 0);
});
