// lib/heavy.mjs: an e2e entry point re-runs itself under the heavy-run lock, and only when it is the main script.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {heavy, yieldHeavy} from '../../lib/heavy.mjs';

const here = fileURLToPath(new URL('../..', import.meta.url));
const script = here + 'suite.mjs';
const calls = [];
const fake = {run: (...call) => { calls.push(call); return {status: 7}; }, exit: code => calls.push(['exit', code])};

test('the main script re-runs itself under the lock and exits with the run\'s code', () => {
  calls.length = 0;
  assert.equal(heavy('e2e-jobs', pathToFileURL(script).href, {argv: ['node', script, 'jobs'], env: {}, ...fake}), true);
  assert.equal(calls[0][0], 'bash');
  assert.match(calls[0][1][0], /tools\/heavy-lock\.sh$/);
  assert.equal(calls[0][1][1], 'e2e-jobs');
  assert.deepEqual(calls[0][1].slice(-2), [script, 'jobs']);
  assert.deepEqual(calls[1], ['exit', 7]);
});

test('a class given by the entry point reaches the lock; none leaves the environment alone', () => {
  calls.length = 0;
  heavy('e2e-smoke', pathToFileURL(script).href, {argv: ['node', script], env: {A: '1'}, klass: 'proof', ...fake});
  assert.equal(calls[0][2].env.JOB_PILOTTO_HEAVY_CLASS, 'proof');
  assert.equal(calls[0][2].env.A, '1');
  calls.length = 0;
  heavy('e2e-smoke', pathToFileURL(script).href, {argv: ['node', script], env: {}, ...fake});
  assert.equal(calls[0][2].env, undefined);
  calls.length = 0;   // an explicit class in the environment wins over the entry point's default (the capture pass's per-row runs are pool, not proof)
  heavy('e2e-smoke', pathToFileURL(script).href, {argv: ['node', script, '--only', 'x'], env: {JOB_PILOTTO_HEAVY_CLASS: 'pool'}, klass: 'proof', ...fake});
  assert.notEqual(calls[0][2]?.env?.JOB_PILOTTO_HEAVY_CLASS, 'proof');
});

test('an import, a held lock, the off switch and --list do nothing', () => {
  for (const [argv, env] of [[['node', here + 'other.mjs'], {}], [['node', script], {JP_HEAVY_HELD: '1'}], [['node', script], {JOB_PILOTTO_HEAVY: '0'}], [['node', script, '--list'], {}]]) {
    calls.length = 0;
    assert.equal(heavy('x', pathToFileURL(script).href, {argv, env, ...fake}), false);
    assert.equal(calls.length, 0);
  }
});

test('every heavy entry point calls it (a new browser suite entry must too)', () => {
  for (const file of ['suite.mjs', 'run-all.mjs', 'record-sites.mjs']) assert.match(fs.readFileSync(here + file, 'utf8'), /heavy\(['`][$\w{}.\[\]-]+['`], import\.meta\.url[,)]/, file);
});

test('yieldHeavy asks the lock only inside a hold, never throws, and smoke calls it once per site', () => {
  calls.length = 0;
  assert.equal(yieldHeavy({env: {}, run: (...call) => { calls.push(call); return {status: 0}; }}), false);
  assert.equal(yieldHeavy({env: {JP_HEAVY_HELD: '1', JOB_PILOTTO_HEAVY: '0'}, run: (...call) => { calls.push(call); return {status: 0}; }}), false);
  assert.equal(calls.length, 0);
  assert.equal(yieldHeavy({env: {JP_HEAVY_HELD: '1'}, run: (...call) => { calls.push(call); return {status: 0}; }}), true);
  assert.deepEqual(calls[0][1].slice(1), ['yield']);
  assert.equal(yieldHeavy({env: {JP_HEAVY_HELD: '1'}, run: () => { throw new Error('no bash'); }}), false);
  assert.match(fs.readFileSync(here + 'record-sites.mjs', 'utf8'), /for \(const \{shape, like = \[\], urls = \[\]\} of chosen\) \{\n\s+yieldHeavy\(\);/);
});
