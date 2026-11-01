#!/bin/sh
# Links the main checkout's installed folders (node_modules of desktop, desktop/e2e, worker, site, and .venv) into a worktree, so its tests, lint and push gate run at once.
# Why (29 Oct 2026, owner, #2462): a bare git worktree add had none, the push gate ran 437 s, failed in "desktop (clean checkout)" and hid the cause: one linker, called by every way a worktree is made
# (tools/worktree.sh, the post-checkout hook) and named by the push gate's refusal. .venv: the app runs the engine with <repo>/.venv/bin/python when it exists, else the system python3 with no `anthropic`.
# usage: tools/link-modules.sh [<tree>]   (default: here). Idempotent; never changes the main checkout or a folder the tree already has. Guard: tests/test_worktree.py.
tree="${1:-$PWD}"
common="$(git -C "$tree" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || exit 0
main="$(dirname "$common")"
[ -d "$main" ] && [ "$(cd "$main" && pwd -P)" != "$(cd "$tree" && pwd -P)" ] || exit 0   # the main checkout itself, or a clone: nothing to link from
for dir in desktop/node_modules desktop/e2e/node_modules app-core/node_modules site/node_modules .venv; do
  # Why (1 Nov 2026): until the main checkout has its own app-core/node_modules, it holds this folder as worker/node_modules: link that one meanwhile.
  [ "$dir" = app-core/node_modules ] && [ ! -d "$main/$dir" ] && [ -d "$main/worker/node_modules" ] && [ ! -e "$tree/$dir" ] && [ -d "$tree/app-core" ] && { ln -s "$main/worker/node_modules" "$tree/$dir"; continue; }
  [ -d "$main/$dir" ] && [ ! -e "$tree/$dir" ] && [ -d "$tree/$(dirname "$dir")" ] && ln -s "$main/$dir" "$tree/$dir"
done
exit 0
