// Proves the consolidated caps equal the original generated modules, including shared steps.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {test} from 'node:test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
const suites = ['applyflows', 'failureschannels', 'interactions', 'jobs', 'settings'];
// The main parent of bb 2/9 still contains all five originals; full history is present in both harness workflows.
const original = 'c7361702852401d441836014f9e46f39f402e5c7';

test('every consolidated suite cap equals its original git module', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hang-caps-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  // Before the fold, read HEAD directly; after deletion, keep this proof tied to the pre-fold main commit.
  const revision = git('ls-tree', 'HEAD', '--', 'desktop/e2e/lib/applyflows-caps.mjs').trim() ? 'HEAD' : original;
  for (const suite of suites) {
    const file = `${suite}-caps.mjs`;
    writeFileSync(path.join(dir, file), git('show', `${revision}:desktop/e2e/lib/${file}`));
  }
  const {hangCapsFor} = await import('../lib/hang-caps.mjs');
  for (const suite of suites) {
    const {hangCaps} = await import(pathToFileURL(path.join(dir, `${suite}-caps.mjs`)).href);
    assert.deepEqual(hangCapsFor(suite), hangCaps, suite);
    const exported = await import(`../suites/${suite}.mjs`);
    assert.equal(exported.hangCaps, hangCapsFor(suite), `${suite}: the suite uses the loader's table`);
  }
});
