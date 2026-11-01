// A browser that did not start stops the run: the next start fails at once with the first reason (lib/launch-guard.mjs), and the real extension's one start path uses it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {LAUNCH_TIMEOUT_MS, makeLaunchGuard} from '../../lib/launch-guard.mjs';

test('after one failed start, every later start fails at once with the first reason', () => {
  const guard = makeLaunchGuard();
  guard.check();   // nothing failed yet: no throw
  guard.failed(new Error('browserType.launchPersistentContext: Timeout 180000ms exceeded.\nCall log: ...'));
  guard.failed(new Error('a second, different reason'));
  assert.throws(() => guard.check(), /did not start earlier in this run \(browserType\.launchPersistentContext: Timeout 180000ms exceeded\.\)/);
  assert.match(guard.reason(), /^browserType/);
});

// The shared start paths: every runner that starts the extension's browser per case or per journey goes through one of them.
for (const [file, fn] of [['real-extension.mjs', 'export async function startRealExtension'], ['extension.mjs', 'export async function launchBrowser']]) test(`${file}: checks the guard before launching, records a failure, and waits at most a minute`, () => {
  const source = fs.readFileSync(new URL(`../../lib/${file}`, import.meta.url), 'utf8');
  const start = source.indexOf(fn);
  const launch = source.indexOf('launchPersistentContext', start);
  assert.ok(start > 0 && launch > start);
  assert.ok(source.lastIndexOf('launchGuard.check()', launch) > start, 'launchGuard.check() runs before the launch');
  assert.ok(source.indexOf('launchGuard.failed(error)', launch) > launch, 'a failed launch is recorded');
  assert.match(source.slice(launch, launch + 400), /timeout: LAUNCH_TIMEOUT_MS/);
  assert.ok(LAUNCH_TIMEOUT_MS <= 60000);
  assert.equal((source.match(/launchPersistentContext\(/g) || []).length, 1, 'one start path: a second launch must use the guard too');
});
