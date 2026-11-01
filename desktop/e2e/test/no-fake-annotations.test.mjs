// A green job must show no fake errors: test fixtures that fail on purpose never print real GitHub `::error` annotations (owner saw "2 errors" on a green harness job, #2784).
// Plays the owner's scenario: the files that call the annotation writers run as GitHub does (GITHUB_ACTIONS=true) and nothing starting with `::error` reaches stdout.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {writeSuiteFailures} from '../lib/artifacts.mjs';

// Why (1 Nov 2026, c27): a fixed list, each file builds a failed step and calls writeSuiteFailures or writeFinalFailures. This file is not in it (a replay never includes itself).
const WRITER_TESTS = ['artifacts.test.mjs', 'no-real-ai.test.mjs', 'ai-misses-ratchet.test.mjs', 'ai-miss-cause.test.mjs'];

test('writeSuiteFailures has no env default: a caller must say which env it means', () => {
  assert.throws(() => writeSuiteFailures('unused', 'activity', []), /explicit env/);
});

// Why: under `node --test` the child would inherit NODE_TEST_CONTEXT and print the runner's binary stream instead of its own report.
const withoutRunnerContext = env => Object.fromEntries(Object.entries(env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'));

for (const file of WRITER_TESTS) {
  test(`${file} prints no GitHub annotation when GITHUB_ACTIONS=true leaks in`, () => {
    const done = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], {
      env: {...withoutRunnerContext(process.env), GITHUB_ACTIONS: 'true', CI: 'true'}, encoding: 'utf8', timeout: 120000,
    });
    assert.equal(done.status, 0, `${file} must pass first:\n${done.stdout}\n${done.stderr}`);
    assert.match(done.stdout, /(# pass [1-9]|ℹ pass [1-9]|✔)/, `${file} really ran its tests (positive control)`);
    const annotations = done.stdout.split('\n').filter(line => /^\s*(# )?::(error|warning)/.test(line));
    assert.deepEqual(annotations, [], `${file} printed real annotations on stdout`);
  });
}
