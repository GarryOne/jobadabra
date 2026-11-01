// The build of an older commit (lib/older-tree.mjs): the old app and extension, main's e2e tools over them, the files main added since taken from main. Real git in a temp repo.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {wholeTree} from '../../lib/older-tree.mjs';

test('the old tree keeps its own app and extension, takes main\'s e2e tools and the files main added since', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'older-tree-')), git = (...args) => execFileSync('git', args, {cwd: dir, encoding: 'utf8'}).trim();
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true}); fs.writeFileSync(path.join(dir, file), text); };
  const read = file => fs.readFileSync(path.join(dir, file), 'utf8');
  git('init', '-q'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 'n');
  put('src/ai/prompt.py', 'old prompt\n'); put('extension/fill.js', 'old fill\n'); put('desktop/e2e/replay-net.mjs', 'old tool\n');
  git('add', '-A'); git('commit', '-q', '-m', 'the old build'); const old = git('rev-parse', 'HEAD');
  put('src/ai/prompt.py', 'main prompt\n'); put('extension/fill.js', 'main fill\n'); put('desktop/e2e/replay-net.mjs', 'main tool\n');
  put('worker/src/owner-guard.js', 'added later\n'); put('extension/page/option-groups.js', 'added later too\n');
  git('add', '-A'); git('commit', '-q', '-m', 'main'); const head = git('rev-parse', 'HEAD');
  git('checkout', '-q', old);
  const added = wholeTree(dir, old, head);
  assert.equal(read('src/ai/prompt.py'), 'old prompt\n', 'the old prompts stay (the kept answers are found)');
  assert.equal(read('extension/fill.js'), 'old fill\n');
  assert.equal(read('desktop/e2e/replay-net.mjs'), 'main tool\n', 'main\'s tools');
  assert.deepEqual(added.sort(), ['extension/page/option-groups.js', 'worker/src/owner-guard.js'], 'files only main has, so main\'s tools find what they import');
  assert.equal(read('worker/src/owner-guard.js'), 'added later\n');
});
