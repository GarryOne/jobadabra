#!/usr/bin/env bash
# Says "this red or conflicting PR is blocked for real" so tools/pr-red-check.sh stops blocking the session: tools/pr-red-ack.sh <n> "<reason>" (also say the reason to the owner).
# The acknowledgement holds for exactly the checks that are red now; another red check (or the same one after a green) is a new problem and speaks again.
set -uo pipefail
n="${1:?usage: pr-red-ack.sh <pr number> \"<why it cannot be fixed now>\"}"; reason="${2:?say why it is blocked}"
common="$(git rev-parse --path-format=absolute --git-common-dir)" || exit 1
dir="${PR_RED_DIR:-$common/pr-red}"; mkdir -p "$dir"
. "$(dirname "$0")/pr-rest-lib.sh"; repo="$(pr_repo .)"   # REST (try 3 on "GraphQL runs out", 27 Oct 2026)
view="$(pr_view "$repo" "$n" 2>/dev/null)" && list="$(pr_checks "$repo" "$(jq -r .headRefOid <<<"$view")" 2>/dev/null)" || { view='{}'; list='[]'; }
checks="$(jq -rn --argjson v "$view" --argjson c "$list" '([$c[] | select(.bucket == "fail") | .name] | unique | join(",")) as $red | (if $v.mergeable == "CONFLICTING" then "conflict" else "" end) as $c | if $c == "" then $red elif $red == "" then $c else "\($red)+\($c)" end' 2>/dev/null)" || checks=""
[ -n "$checks" ] || { echo "pr-red-ack: #$n has no red check or conflict right now (nothing to acknowledge)"; exit 0; }
printf '%s\n%s\n' "$checks" "$reason" > "$dir/ack-$n"
echo "pr-red-ack: #$n ($checks) acknowledged: $reason"
