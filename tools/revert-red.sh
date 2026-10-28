#!/usr/bin/env bash
# Offer an owner-reviewed revert PR for a twice-red after-merge backbone commit.
# Job: run the backbone
# Usage: tools/revert-red.sh [--dry-run] <sha> [--runs-json <REST evidence>]
# Invariants: only a branch push + PR creation; no main push, merge, force, or ship fallback.
set -euo pipefail
sha=""; dry=0; evidence=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1 ;;
    --runs-json) shift; evidence="${1:?--runs-json needs a path}" ;;
    --*) echo "revert-red: unknown option $1" >&2; exit 2 ;;
    *) [ -z "$sha" ] || { echo 'revert-red: only one SHA is accepted' >&2; exit 2; }; sha="$1" ;;
  esac
  shift
done
[ -n "$sha" ] || { echo 'usage: tools/revert-red.sh [--dry-run] <sha>' >&2; exit 2; }
# Why (28 Oct 2026, owner): saved JSON is a preview, never authority to change main or open a PR.
[ -z "$evidence" ] || [ "$dry" = 1 ] || { echo 'revert-red: evidence files require --dry-run' >&2; exit 2; }
here="$(cd "$(dirname "$0")/.." && pwd)"
full="$(git -C "$here" rev-parse --verify --end-of-options "$sha^{commit}")" || exit 2
repo="${GITHUB_REPOSITORY:-$(git -C "$here" remote get-url origin | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##')}"
args=(--repo "$repo" --sha "$full")
[ -z "$evidence" ] || args+=(--runs-json "$evidence")
proof="$(python3 -B "$here/tools/backbone_red.py" "${args[@]}")" || { echo "revert-red: $proof" >&2; exit 2; }
subject="$(git -C "$here" log -1 --format=%s "$full")"
case "$subject" in Revert\ *) echo 'revert-red: refusing to revert a revert automatically' >&2; exit 2 ;; esac
topic="revert-red-${full:0:7}"
title="Revert ${full:0:7}: backbone red twice"
merged="$(python3 -B -c 'import json,sys; print(json.loads(sys.argv[1])["pr"])' "$proof")"
run="$(python3 -B -c 'import json,sys; print(json.loads(sys.argv[1])["urls"][-1])' "$proof")"
body="$(cat <<BODY
Restore the backbone by reverting $full for owner review.

**Why:** The same backbone suite failed in two distinct completed after-merge workflow attempts on this commit. Breaking merge: #$merged.
**Unblocks:** Review of the restoration and, later, a corrected version of #$merged.

- Revert the merged PR rather than request a fix-forward.
- The owner merges this PR after its required checks; this script never merges.
- Evidence: $proof

| | Before | Proposed after owner review |
|---|---|---|
| Breaking merge | On main | Reverted |
| Backbone | Two red observations | Restoration checked by PR CI |

No screenshots: restoration of the breaking merge, no new UI.

Fixes-backbone-red: $run
BODY
)"
printf 'Title: %s\nBranch: %s -> main (owner merges)\nBody:\n%s\n' "$title" "$topic" "$body"
# Why (28 Oct 2026, owner): dry-run is fully read-only, including branches, fetches, temp files and bytecode.
[ "$dry" = 0 ] || { echo 'revert-red: dry-run; nothing changed'; exit 0; }
prior="$(gh api "repos/$repo/pulls?head=${repo%/*}:$topic&base=main&state=all&per_page=100")"
prior_url="$(python3 -B -c 'import json,sys; print(next((p["html_url"] for p in json.loads(sys.argv[1])), ""))' "$prior")"
[ -z "$prior_url" ] || { echo "revert-red: already offered to the owner: $prior_url"; exit 0; }
# Re-read live proof immediately before any local mutation; a newer merge or green cancels the offer.
python3 -B "$here/tools/backbone_red.py" --repo "$repo" --sha "$full" >/dev/null
# Why (28 Oct 2026, owner): the owner merges every revert; do not delegate to ship's configurable landing modes.
tree="$(cd "$here" && sh tools/worktree.sh "$topic" | tail -n 1)"
cd "$tree"
[ "$(git rev-parse HEAD)" = "$full" ] || { echo 'revert-red: main moved before worktree creation; nothing pushed' >&2; exit 2; }
parents="$(git rev-list --parents -n 1 "$full" | awk '{print NF-1}')"
revert_args=(-n)
[ "$parents" -lt 2 ] || revert_args+=(-m 1)
git revert "${revert_args[@]}" "$full" || { echo "revert-red: conflict; kept $tree; nothing pushed" >&2; exit 1; }
msg="$(mktemp)"; body_file="$(mktemp)"
trap 'rm -f "$msg" "$body_file"' EXIT
{ echo "$title"; echo; echo "This reverts commit $full."; echo
  echo "Evidence: $proof"; echo
  echo 'Rung: none: revert of a proven backbone red'
  echo 'Fixture: none: restore the parent of the breaking merge'
  echo 'Recorded-unneeded: revert of the breaking merge'
  echo 'E2E-cause: none restore backbone after two failures'
  echo "Expect-changed-by: owner request 28 Oct 2026 to revert twice-red merges ($full)"
  echo "Fixes-backbone-red: $run"
  echo 'Why-changed: breaking merge decisions — restore its parent after two backbone reds'
} > "$msg"
git commit -q -F "$msg"
printf '%s\n' "$body" > "$body_file"
# A final read catches main advancing or a red/green flip during the local revert.
python3 -B "$here/tools/backbone_red.py" --repo "$repo" --sha "$full" >/dev/null
printf 'revert-red: opening PR requested by twice-red evidence sha=%s pr=%s\n' "$full" "$merged"
git push origin "HEAD:refs/heads/$topic"
gh pr create --repo "$repo" --base main --head "$topic" --title "$title" --body-file "$body_file"
