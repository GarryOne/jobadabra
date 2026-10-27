#!/usr/bin/env bash
# Watches a PR from the moment tools/ship.sh opens it (so also when ship itself ends FAILED or is killed) and appends to ship's log: `ship: RED #n <check>` (a check
# failed; once per red check, it keeps watching), `ship: GREEN #n` (every check passed; once per green), `ship: MERGED #n <sha>`, `ship: CLOSED #n (unmerged)`
# or `ship: WATCH ENDED #n (still open)` after the cap. `ship: CONFLICT #n` (GitHub says the PR cannot merge into main; once per conflict, UNKNOWN is never reported) is followed at once by
# tools/pr-conflict-fix.sh, which rebases the stacked-parent case and logs `ship: CONFLICT FIXED #n (stacked parent #m)`; a cleared conflict re-arms GREEN. No AI, only gh.
#   tools/ship-watch.sh <n> <log> <pidfile>      SHIP_WATCH_FIX=<script> the fixer (default: next to this file)   SHIP_WATCH_POLL=<s> between looks (default 60)   SHIP_WATCH_CAP=<s> give up after (default 172800 = 48 h)
# `ship: COMMENT #n <owner|bot|other> <comment|review-<state>|line> <url>` (27 Oct 2026): once per new comment or review by the owner, a review bot or anyone else, never a session's own; the ids already told live in <pidfile>.comments,
# so a restart or a second ship repeats none. Costs one extra gh call per look (the line comments; the rest rides on the `gh pr view`). Guard: tests/test_pr_comments.py.
# Started detached by tools/ship.sh when the PR opens (18 Oct 2026: #1321 sat red for hours because the watcher began only after REVIEW); a second ship of the same branch replaces the old watcher through the pid file (18 Oct 2026: the owner merges by hand and
# sessions only learned of it when told). Guard: tests/test_ship_watch.py, tests/test_pr_conflict_fix.py.
set -u
n="${1:?usage: ship-watch.sh <n> <log> <pidfile>}"; log="${2:?}"; pidfile="${3:?}"
poll="${SHIP_WATCH_POLL:-60}"; cap="${SHIP_WATCH_CAP:-172800}"
old="$(cat "$pidfile" 2>/dev/null || true)"
echo $$ > "$pidfile"   # before the kill: the old watcher's exit trap then sees a newer pid and leaves the file alone
[ -z "$old" ] || [ "$old" = "$$" ] || kill "$old" 2>/dev/null || true   # one watcher per branch
trap '[ "$(cat "$pidfile" 2>/dev/null)" != "$$" ] || rm -f "$pidfile"' EXIT
. "$(cd "$(dirname "$0")" && pwd)/pr-comments-lib.sh"
say() { echo "ship: $*" >> "$log"; }
fixer="${SHIP_WATCH_FIX:-$(cd "$(dirname "$0")" && pwd)/pr-conflict-fix.sh}"
# GREEN only when the checks of the PR's CURRENT head sha exist, all concluded green, and the required "All checks passed" is green on that head: right after a push the PR's
# rollup still shows the old head's checks (18 Oct 2026, #1476: GREEN 2 s after a push, RED minutes later). No head, no repo or no answer: not green.
# "All checks passed" is a commit status written by pr-verdict.yml since 26 Oct 2026 (before: a job of pr-gate.yml, still read for a PR whose runs predate it).
head_checks_passed() {
  local repo; repo="$(jq -r '.url // empty' <<<"$1" | sed -E 's#^https?://[^/]+/([^/]+/[^/]+)/pull/.*#\1#')"
  [ -n "$repo" ] && [ -n "$2" ] || return 1
  local runs; runs="$(gh api "repos/$repo/commits/$2/check-runs?per_page=100" --jq '.check_runs | if length > 0 and all(.[]; .status == "completed" and (.conclusion | IN("success","skipped","neutral"))) then (if any(.[]; .name == "All checks passed" and .conclusion == "success") then "gate" else "green" end) else "no" end' 2>/dev/null)"
  case "$runs" in gate) return 0 ;; green) ;; *) return 1 ;; esac
  gh api "repos/$repo/commits/$2/status" --jq '[.statuses[]? | select(.context == "All checks passed")][0].state == "success"' 2>/dev/null | grep -qx true
}
seen="$pidfile.comments"; touch "$seen" 2>/dev/null
# Why (#PR comments, owner 27 Oct 2026): the cursor is a file of told ids, not a timestamp, so an edited or late comment is never lost and a restart never repeats one.
# Why (27 Oct 2026, owner: "Start a fixer"): a watcher that starts on an existing PR has an empty cursor (#2241: 3 gitar-bot comments fixed hours earlier were announced again);
#   an item already answered (a session reply or a later commit, pc_unanswered) is marked told WITHOUT a COMMENT line; unanswered old ones are still told once.
report_comments() {  # <view json> <repo>
  local lines rows open id who kind url t
  lines="$(gh api "repos/$2/pulls/$n/comments?per_page=100" 2>/dev/null)" || lines=""
  rows="$(pc_items "$1" "${lines:-null}")"
  open="$(pc_unanswered "$(jq -r '[.commits[]?.committedDate // empty] | max // ""' <<<"$1")" <<<"$rows" | cut -f1)"
  while IFS=$'\t' read -r id who kind url t; do
    [ -n "$id" ] && [ "$who" != self ] || continue   # a PR with no comments still feeds the loop one empty row
    grep -qxF "$id" "$seen" 2>/dev/null && continue
    echo "$id" >> "$seen"
    grep -qxF "$id" <<<"$open" && say "COMMENT #$n $who $kind $url"
  done <<<"$rows"
}
waited=0; red=""; green=""; conflict=""; lasthead=""
while :; do
  view="$(gh pr view "$n" --json state,mergeCommit,mergeable,headRefOid,url,comments,reviews,commits 2>/dev/null)" || view=""
  state="$(jq -r '.state // empty' <<<"$view" 2>/dev/null)"
  case "$state" in
    MERGED) say "MERGED #$n $(jq -r '.mergeCommit.oid // empty' <<<"$view" | cut -c1-7)"; exit 0 ;;
    CLOSED) say "CLOSED #$n (unmerged)"; exit 0 ;;
  esac
  if [ -n "$state" ]; then
    case "$(jq -r '.mergeable // empty' <<<"$view" 2>/dev/null)" in   # UNKNOWN (GitHub is still working it out) keeps the last known state
      CONFLICTING) if [ -z "$conflict" ]; then conflict=1; say "CONFLICT #$n"; bash "$fixer" "$n" "$log" >/dev/null 2>&1 || true; fi ;;
      MERGEABLE) [ -z "$conflict" ] || { conflict=""; green=""; } ;;
    esac
    repo="$(jq -r '.url // empty' <<<"$view" | sed -E 's#^https?://[^/]+/([^/]+/[^/]+)/pull/.*#\1#')"; [ -z "$repo" ] || report_comments "$view" "$repo"
    checks="$(gh pr checks "$n" --json name,bucket 2>/dev/null)" || checks=""
    now="$(jq -r '[.[]? | select(.bucket == "fail") | .name] | first // empty' <<<"${checks:-[]}" 2>/dev/null)" || now=""
    [ "$now" = "$red" ] || { [ -z "$now" ] || say "RED #$n $now"; red="$now"; }   # once per red check; green again re-arms it
    head="$(jq -r '.headRefOid // empty' <<<"$view" 2>/dev/null)"; [ "$head" = "$lasthead" ] || { green=""; lasthead="$head"; }   # a push re-arms GREEN
    if jq -e 'length > 0 and all(.[]; .bucket == "pass" or .bucket == "skipping")' <<<"${checks:-[]}" >/dev/null 2>&1 && head_checks_passed "$view" "$head"; then
      [ -n "$green" ] || say "GREEN #$n"; green=1   # once per green; a new push that restarts the checks re-arms it
    else green=""; fi
  fi
  [ "$waited" -lt "$cap" ] || { say "WATCH ENDED #$n (still open)"; exit 0; }
  sleep "$poll"; waited=$((waited + poll + 1))
done
