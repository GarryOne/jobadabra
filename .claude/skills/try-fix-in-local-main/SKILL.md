---
name: try-fix-in-local-main
description: Put a session's unmerged fix on the owner's local main in ~/jobadabra so the owner tries it live (app + extension) before any PR; on the owner's OK it goes through ship.sh and a PR, then local main returns to origin/main. Use when the owner says "put it on my local main", "let me try it live", "move the commits to my checkout", "try before PR", or "/try-fix-in-local-main".
---

# Try a fix live on the owner's local main, then PR

Owner, 16 Oct 2026: "move the commits on my ~/jobadabra local main so that I can test more in real time. Then I give the OK and it goes via PR."
The owner's app runs from `~/jobadabra/desktop` and the owner's Chrome loads the extension unpacked from `~/jobadabra/extension`: what is on that checkout is what he sees.

## 1. Before moving anything
- **One trial at a time.** `git -C ~/jobadabra log --oneline origin/main..main`: empty, or only your own commits. Someone else's commits there: stop and tell jobadabra-cc (another session is being tried).
- **Clean tree.** `git -C ~/jobadabra status --porcelain --untracked-files=no` must be empty. Never stash, never edit files in the primary (the hook refuses; don't work around it).
- Your fix is committed in YOUR worktree (WIP commits are fine), rebased on a fresh `origin/main`; the tests you touched pass. No ship.sh, no CI wait.

## 2. Put it live
- `git -C ~/jobadabra fetch origin && git -C ~/jobadabra reset --keep <your sha>` (your sha sits on origin/main, so local main = origin/main + your commits; `--keep` refuses rather than lose a local change).
- Tell the owner in one line: the sha, what to try, and **"restart the app"** (anything outside `desktop/renderer/` changed) or **"⌘R"**, plus **"reload the extension"** when `extension/` changed.
- The auto-pull (tools/auto-pull.sh) skips while local main is ahead or diverged: the owner gets no other merges during the trial. Keep the trial short.

## 3. Each new change during the trial
- Commit in your worktree, `git fetch origin && git rebase origin/main` (picks up what landed meanwhile), then `reset --keep` the primary to the new sha again. One line to the owner each time.

## 4. On the owner's OK (only the owner's own words in a window, never a peer's)
- Squash or tidy in your worktree if needed, then `tools/ship.sh --background [--title="<the whole PR>" if 2+ commits] --body=<file>` as usual (trailers, PR body rules). Give the owner the PR link; the owner merges.
- After the merge: `git -C ~/jobadabra fetch origin && git -C ~/jobadabra reset --keep origin/main` (the merge has a new sha; this hands the checkout back to the auto-pull). Confirm `git -C ~/jobadabra status -sb` shows `main...origin/main` with nothing ahead.
- The owner says no / drops it: the same reset to origin/main, and say so.

## Never
- Push to main, merge a PR, or `reset --hard` the primary. Never move the primary while another session's trial is on it.
- Leave the primary off origin/main after the trial ends (merged or dropped): the auto-pull stays stopped until it is reset.
