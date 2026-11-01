// The build of an older commit, for "Confirmed offline" (verify-row.mjs): the whole old tree (its app, extension and src, so its AI prompts are the old ones and the kept answers are found), main's e2e tools over desktop/e2e, and every
// file main added since unioned in so main's tools find what they import (worker/src/owner-guard.js, extension/page/option-groups.js, 15 Oct 2026). The overlay of the extension alone left main's prompts: asks 5 / hit 0 on Personio.
// Guard: e2e/test/replay/older-tree.test.mjs.
import {execFileSync} from 'node:child_process';

const gitIn = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20}).trim();

// `dir` is a worktree at `commit`; `head` is main's commit. -> the files unioned from main.
export function wholeTree(dir, commit, head) {
  gitIn(dir, 'checkout', head, '--', 'desktop/e2e');
  const added = gitIn(dir, 'diff', '--name-only', '--diff-filter=A', commit, head, '--', '.', ':(exclude)desktop/e2e').split('\n').filter(Boolean);
  for (let at = 0; at < added.length; at += 200) gitIn(dir, 'checkout', head, '--', ...added.slice(at, at + 200));
  return added;
}
