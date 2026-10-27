#!/usr/bin/env bash
# Fixes the one conflict a machine can fix: a stacked PR whose parent was squash-merged (the parent's commits are still on the branch, their changes already on main). Run by tools/ship-watch.sh
# in the PR's worktree when GitHub says CONFLICTING: tools/pr-conflict-fix.sh <n> <log>. Drops the parent's commits with `git rebase --onto origin/main <parent's old tip>`, runs the fast push
# checks, pushes with a lease and appends `ship: CONFLICT FIXED #n (stacked parent #m)`. Everything else (a real two-sided conflict, a dirty tree, unpushed commits, a ship running here,
# no merged parent found, a failed check or push) leaves the branch exactly as it was and says nothing: ship-watch's `ship: CONFLICT` line and tools/pr-red-check.sh put it in front of the session.
# Never resolves a two-sided conflict. 18 Oct 2026: #1356 and #1362 sat CONFLICTING for hours after their parent merged. Guard: tests/test_pr_conflict_fix.py.
set -uo pipefail
n="${1:?usage: pr-conflict-fix.sh <n> <log>}"; log="${2:?}"
command -v gh >/dev/null && command -v jq >/dev/null || exit 0
top="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
branch="$(git symbolic-ref --short -q HEAD)" || exit 0
case "$branch" in main|"") exit 0 ;; esac
[ -z "$(git status --porcelain 2>/dev/null)" ] || exit 0   # someone is editing here
ship_running() {  # a tools/ship.sh whose working folder is this worktree (no edits while ship runs)
  [ -z "${PR_CONFLICT_SHIP_RUNNING:-}" ] || return 0
  local pid cwd
  for pid in $(pgrep -f 'tools/ship\.sh' 2>/dev/null); do
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || lsof -a -d cwd -p "$pid" -Fn 2>/dev/null | sed -n 's/^n//p')"
    [ "$cwd" != "$top" ] || return 0
  done
  return 1
}
ship_running && exit 0
git fetch -q origin 2>/dev/null || exit 0
old="$(git rev-parse HEAD)"
[ "$old" = "$(git rev-parse -q --verify "origin/$branch" 2>/dev/null)" ] || exit 0   # unpushed local commits are the session's own
git merge-base --is-ancestor origin/main HEAD 2>/dev/null && exit 0   # already on top of main: not this conflict

# The parent: a merged PR whose last commit is on this branch but not on main (squash-merged, so its commits never reached main). The deepest one is the tip to cut after.
parent=""; parent_n=""; best=-1
while IFS=$'\t' read -r pn oid; do
  [ -n "$oid" ] && git cat-file -e "$oid^{commit}" 2>/dev/null || continue
  git merge-base --is-ancestor "$oid" HEAD 2>/dev/null && ! git merge-base --is-ancestor "$oid" origin/main 2>/dev/null || continue
  [ "$oid" != "$old" ] || continue
  size="$(git rev-list --count "origin/main..$oid")"
  [ "$size" -gt "$best" ] && { best="$size"; parent="$oid"; parent_n="$pn"; }
done < <(. "$(dirname "$0")/pr-rest-lib.sh" && pr_list "$(pr_repo .)" closed | jq -r '.[:60][] | select(.merged) | "\(.number)\t\(.headRefOid)"' 2>/dev/null)   # REST (try 3 on "GraphQL runs out", 27 Oct 2026)
[ -n "$parent" ] || exit 0

if ! git rebase --onto origin/main "$parent" >/dev/null 2>&1; then git rebase --abort >/dev/null 2>&1 || true; git reset -q --hard "$old"; exit 0; fi
back() { git reset -q --hard "$old"; exit 0; }
if [ -f "$top/tools/pre-push-check.sh" ]; then   # the fast pure checks, as ship.sh runs them before a PR push
  payload="$(jq -n --arg command "SHIP_PR=1 git push origin $branch" --arg cwd "$top" '{tool_input: {command: $command}, cwd: $cwd}')"
  bash "$top/tools/pre-push-check.sh" <<<"$payload" >/dev/null 2>&1 || back
fi
SHIP_PR=1 git push -q --force-with-lease="$branch:$old" origin "HEAD:$branch" >/dev/null 2>&1 || back
echo "ship: CONFLICT FIXED #$n (stacked parent #$parent_n)" >> "$log"
