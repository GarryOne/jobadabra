// Async browser reads use the shared state poll instead of an async waitForFunction predicate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';

const root = new URL('../', import.meta.url);
const allowed = new Set([
  // TODO(AI): migrate wizard's async predicate in its owning PR (29 Oct 2026).
  'lib/wizard.mjs',
]);
const asyncPredicate = /\bwaitForFunction\s*\(\s*async\b/;

function files(dir) {
  return fs.readdirSync(new URL(dir, root), {withFileTypes: true}).flatMap(entry => {
    const name = path.posix.join(dir, entry.name);
    return entry.isDirectory() ? files(name + '/') : /\.[cm]?js$/.test(name) ? [name] : [];
  });
}

test('suite and harness state waits have no unapproved async waitForFunction predicates', () => {
  const hits = [...files('suites/'), ...files('lib/')].filter(file => asyncPredicate.test(fs.readFileSync(new URL(file, root), 'utf8')));
  assert.deepEqual(hits.filter(file => !allowed.has(file)), [], 'poll page.evaluate with pollUntil so only the resolved value can settle');
  assert.deepEqual([...allowed].filter(file => !hits.includes(file)), [], 'remove obsolete exceptions when their owning PR migrates them');
});
