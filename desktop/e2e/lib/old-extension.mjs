// The extension as it was before a fix (row-to-case --old-commit <sha>): this checkout's extension/ with that commit's changes taken back out, in a temp folder.
// The manifest and the fingerprint file are left as they are (the version bump and its hash change with every commit; they are not the behaviour). Built from git objects only (temp index, no tar), so it works on every CI platform. Guard: e2e/test/old-extension.test.mjs.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const git = (cwd, args, options = {}) => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options});

// -> {dir, extensionDir, remove(), note}; note says when the old build is the tree before the fix, not the checkout minus the fix. Throws an Error naming what is wrong (an unknown commit, no extension change, a change that no longer reverts cleanly).
export function oldExtension({repo = process.cwd(), sha, base = 'HEAD'} = {}) {
  if (!/^[0-9a-f]{7,40}$/i.test(String(sha || ''))) throw new Error(`--old-commit wants a commit hash, got "${sha || ''}"`);
  const top = git(repo, ['rev-parse', '--show-toplevel']).trim();
  try { git(top, ['rev-parse', '--verify', `${sha}^{commit}`]); } catch { throw new Error(`--old-commit ${sha}: no such commit in this checkout (git fetch?)`); }
  const patch = git(top, ['diff', '--binary', `${sha}^`, sha, '--', 'extension', ':(exclude)extension/manifest.json', ':(exclude)extension/fingerprint.json']);
  if (!patch.trim()) throw new Error(`--old-commit ${sha}: the commit changes nothing under extension/ (the manifest and the fingerprint file are left out), so there is no old extension to build`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-old-extension-')), remove = () => fs.rmSync(dir, {recursive: true, force: true});
  try {
    const index = path.join(dir, '.index'), env = {...process.env, GIT_INDEX_FILE: index};
    const checkout = tree => {
      git(top, ['read-tree', tree], {env});
      git(top, ['checkout-index', '-f', '-z', '--stdin', `--prefix=${dir.replace(/\\/g, '/')}/`], {env, input: git(top, ['ls-tree', '-r', '-z', '--name-only', tree, '--', 'extension'])});
      fs.rmSync(index, {force: true});
    };
    checkout(base);
    let note = '';
    try { git(dir, ['apply', '-R', '--whitespace=nowarn', '-p1', '-'], {input: patch}); } catch (error) {
      // The fix no longer reverts cleanly (later commits changed the same lines): the tree just before the fix instead. That old build lacks every later commit too, so it may not replay the live run at all
      // and its control is weaker: it can fail for a reason that is not the fix.
      fs.rmSync(path.join(dir, 'extension'), {recursive: true, force: true});
      checkout(`${sha}^`);
      note = `--old-commit ${sha}: its changes no longer revert cleanly on ${base} (${String(error.stderr || error.message).split('\n')[0]}): the old build is the extension at ${sha}^ instead, without the commits since: its control is weaker (a difference may not be the fix)`;
    }
    return {dir, extensionDir: path.join(dir, 'extension'), remove, note};
  } catch (error) { remove(); throw error; }
}
