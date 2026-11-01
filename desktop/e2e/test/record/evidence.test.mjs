// Evidence for a finding (the screenshot of the page) is kept in the repository itself, at a tag, so an issue or a pull request can show it with a plain image link.
// Tested against a local bare repository: no network.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {publishFiles, rawUrl} from '../../lib/evidence.mjs';

const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
function bareRemote(withBranch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
  const bare = path.join(dir, 'remote.git');
  git(dir, 'init', '--bare', '-b', 'main', bare);
  if (withBranch) {
    const seed = path.join(dir, 'seed');
    git(dir, 'clone', bare, seed);
    git(seed, 'checkout', '-b', 'pr-assets');
    fs.writeFileSync(path.join(seed, 'old.txt'), 'older evidence');
    git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.');
    git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'seed');
    git(seed, 'push', 'origin', 'pr-assets');
  }
  return {dir, bare};
}
const png = dir => { const file = path.join(dir, 'shot.png'); fs.writeFileSync(file, Buffer.from([137, 80, 78, 71])); return file; };

test('the raw address of a file at a tag is a plain image link for an issue or a pull request', () => {
  assert.equal(rawUrl('o/r', 'ui-evidence-7', 'ui-loop/a b/c.png'), 'https://raw.githubusercontent.com/o/r/ui-evidence-7/ui-loop/a%20b/c.png');
});

test('a batch of files is published as a tag of its own, no branch, and each file comes back with its link', () => {
  const {dir, bare} = bareRemote(true);
  const urls = publishFiles({repo: 'o/r', remote: bare, tag: 'ui-evidence-777', files: [{from: png(dir), to: 'ui-loop/fp1/777-focus.png'}], message: 'Evidence of run 777'});
  assert.equal(urls['ui-loop/fp1/777-focus.png'], 'https://raw.githubusercontent.com/o/r/ui-evidence-777/ui-loop/fp1/777-focus.png');
  assert.match(git(dir, 'ls-remote', '--tags', bare), /refs\/tags\/ui-evidence-777/);
  assert.doesNotMatch(git(dir, 'ls-remote', '--heads', bare), /ui-evidence|evidence/, 'no branch is created or touched: GitHub shows a "recent pushes" banner for branches');
  const check = path.join(dir, 'check');
  git(dir, 'clone', '--branch', 'ui-evidence-777', bare, check);
  assert.ok(fs.existsSync(path.join(check, 'ui-loop/fp1/777-focus.png')));
});

test('publishing again under the same tag name makes a new tag: nothing is moved or forced', () => {
  const {dir, bare} = bareRemote(false);
  const one = publishFiles({repo: 'o/r', remote: bare, tag: 'ui-evidence-1', files: [{from: png(dir), to: 'a/1.png'}], message: 'one'});
  const two = publishFiles({repo: 'o/r', remote: bare, tag: 'ui-evidence-1', files: [{from: png(dir), to: 'b/2.png'}], message: 'two'});
  assert.match(one['a/1.png'], /\/ui-evidence-1\//);
  assert.match(two['b/2.png'], /\/ui-evidence-1-2\//);
  const tags = git(dir, 'ls-remote', '--tags', bare);
  assert.match(tags, /refs\/tags\/ui-evidence-1\b/);
  assert.match(tags, /refs\/tags\/ui-evidence-1-2\b/);
});

test('a file that is not there is skipped, not an error: a finding without a screenshot still gets its issue', () => {
  const {dir, bare} = bareRemote(false);
  const urls = publishFiles({repo: 'o/r', remote: bare, tag: 'ui-evidence-9', files: [{from: path.join(dir, 'missing.png'), to: 'x/y.png'}], message: 'none'});
  assert.deepEqual(urls, {});
  assert.equal(git(dir, 'ls-remote', '--tags', bare).trim(), '');
});
