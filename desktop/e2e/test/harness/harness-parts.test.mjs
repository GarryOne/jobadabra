// The harness runs as 3 parallel CI parts (harness.yml): each part runs its share of the files, together exactly the whole folder (owner, 1 Nov 2026: "let's just split the harness tests").
// Plays Gitar's finding on #2793: node reads --test-shard only before the files, so npm's extra arguments after the glob made all 3 parts run everything.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const E2E = fileURLToPath(new URL('../..', import.meta.url));
const script = JSON.parse(fs.readFileSync(path.join(E2E, 'package.json'), 'utf8')).scripts.test;
const workflow = fs.readFileSync(path.join(E2E, '../../.github/workflows/harness.yml'), 'utf8');

test('the npm script takes its part from TEST_SHARD, before the files', () => {
  assert.match(script, /--test-shard=\$\{TEST_SHARD:-1\/1\} test\/\*\/\*\.test\.mjs/);
});

test('harness.yml runs one job per part and hands each its TEST_SHARD', () => {
  assert.match(workflow, /part: \[1, 2, 3\]/);
  assert.match(workflow, /TEST_SHARD: \$\{\{ matrix\.part \}\}\/3\n(\s+#.*\n)*\s+run: npm test\n/);
});

// Why: the script's own command line with the glob swapped for two stand-in files; a part must run exactly one of them (a positive control: both parts together run both).
test('two parts of two files run one file each, and together both', () => {
  const ran = [];
  for (const part of ['1/2', '2/2']) {
    const command = script.replace('test/*/*.test.mjs', 'test/fixtures/parts/part-a.test.mjs test/fixtures/parts/part-b.test.mjs').replace('--test-reporter=spec', '--test-reporter=tap');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT'));
    const done = spawnSync('sh', ['-c', command], {cwd: E2E, env: {...env, TEST_SHARD: part}, encoding: 'utf8', timeout: 60000});
    assert.equal(done.status, 0, done.stdout + done.stderr);
    ran.push([...(done.stdout + done.stderr).matchAll(/ok \d+ - (stand-in part-\w)/g)].map(match => match[1]));
  }
  assert.deepEqual(ran.map(names => names.length), [1, 1], JSON.stringify(ran));
  assert.deepEqual(ran.flat().sort(), ['stand-in part-a', 'stand-in part-b']);
});
