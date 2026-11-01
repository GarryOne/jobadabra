// test/reporter-by-file.mjs: a line per test file (OK / FAILED), the error only for what failed, and a non-zero exit. (Run in a scratch folder: a failing test file of its own.)
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {test} from 'node:test';

const reporter = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reporter-by-file.mjs');
const run = body => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-reporter-'));
  fs.writeFileSync(path.join(dir, 'a.test.js'), `import test from 'node:test'; import assert from 'node:assert/strict';\n${body}`);
  const result = spawnSync(process.execPath, ['--test', `--test-reporter=${pathToFileURL(reporter).href}`, 'a.test.js'], {cwd: dir, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'NODE_TEST_CONTEXT'))});   // inside a test run this variable makes a nested `node --test` run nothing
  fs.rmSync(dir, {recursive: true, force: true});
  return result;
};

test('passing tests print one OK line for the file and a summary, with no per-test noise', () => {
  const result = run("test('adds', () => assert.equal(1 + 1, 2)); test('subtracts', () => assert.equal(3 - 1, 2));");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^OK {6}a\.test\.js {2}\(2 tests, \d+ ms\)$/m);
  assert.match(result.stdout, /OK: 1 files, 2 tests, 2 passed, 0 failed/);
  assert.ok(result.stdout.split('\n').length < 8, result.stdout);
});

test('a failing test prints FAILED, its name and its error; a failing subtest is listed once, not with its parent', () => {
  const result = run("test('the total', () => assert.equal(2 + 2, 5, 'two and two make four')); test('group', async t => { await t.test('inner bad', () => { throw new Error('boom'); }); });");
  assert.notEqual(result.status, 0, 'a failure fails the run');
  assert.match(result.stdout, /^FAILED {2}a\.test\.js/m);
  assert.match(result.stdout, /✖ the total {3}\(a\.test\.js\)[\s\S]*two and two make four/);
  assert.ok(result.stdout.indexOf('✖ the total') < result.stdout.indexOf('FAILED  a.test.js'), 'the errors come before the file list');
  assert.match(result.stdout, /✖ inner bad[\s\S]*boom/);
  assert.doesNotMatch(result.stdout, /✖ group/, 'the parent only says "1 subtest failed"');
  assert.doesNotMatch(result.stdout, /node:internal/, 'no runner frames');
  assert.match(result.stdout, /FAILED: 1 files, 2 tests, 0 passed, 2 failed/);
});

// A run that is still going: the second file waits until the harness has SEEN a line in the output and creates the release file. A reporter that holds its lines to the end never shows it,
// the second file gives up after a hang guard, and the test fails: so "live" is proven by state, never by a sleep.
function live(first, seenLine, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-reporter-live-'));
  const release = path.join(dir, 'release');
  fs.writeFileSync(path.join(dir, 'a.test.js'), `import test from 'node:test'; import assert from 'node:assert/strict';\n${first}`);
  fs.writeFileSync(path.join(dir, 'b.test.js'), `import test from 'node:test'; import fs from 'node:fs';
test('waits for the harness to see the line', async () => { const until = Date.now() + 15000; while (!fs.existsSync(${JSON.stringify(release)})) { if (Date.now() > until) throw new Error('the reporter printed nothing before the end'); await new Promise(resolve => setTimeout(resolve, 25)); } });`);
  const child = spawn(process.execPath, ['--test', `--test-reporter=${pathToFileURL(reporter).href}`, 'a.test.js', 'b.test.js'], {cwd: dir, env: {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NODE_TEST'))), ...extraEnv}});
  let out = '', seenBeforeEnd = false;
  child.stdout.on('data', chunk => { out += chunk; if (!fs.existsSync(release) && seenLine.test(out)) { seenBeforeEnd = true; fs.writeFileSync(release, 'go'); } });
  return new Promise(resolve => child.on('close', code => { fs.rmSync(dir, {recursive: true, force: true}); resolve({code, out, seenBeforeEnd: seenBeforeEnd && !out.includes('the reporter printed nothing before the end')}); }));   // a line that only arrived with the end of the run does not count
}

test('a run says it started and how many files, before anything has finished', async () => {
  const result = await live("test('fine', () => {});", /tests: started · 2 files/);
  assert.equal(result.seenBeforeEnd, true, result.out);
  assert.match(result.out, /^jp-reporter-live-\w+ tests: started · 2 files$/m);
});

test('a failing test shows at once, with its error, while the other file is still running', async () => {
  const result = await live("test('breaks early', () => assert.equal(1, 2, 'one is not two'));", /✖ breaks early[\s\S]*one is not two/);
  assert.equal(result.seenBeforeEnd, true, result.out);
  assert.notEqual(result.code, 0);
  assert.ok(result.out.indexOf('✖ breaks early') < result.out.indexOf('All files:'), 'seen before the summary');
});

test('a quiet stretch prints a progress line with the files seen, the failures and the time', async () => {
  const result = await live("test('fine', () => {});", /tests: 1\/2 files · 0 failed · \d+s/, {JOBADABRA_PROGRESS_MS: '150'});
  assert.equal(result.seenBeforeEnd, true, result.out);
  assert.equal(result.code, 0, result.out);
});
