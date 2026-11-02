#!/usr/bin/env bash
# Watches a PR from the moment tools/ship.sh opens it (so also when ship itself ends FAILED or is killed) and appends to ship's log: `ship: RED #n <check> <head-sha>` (a check
# failed; once per red check, it keeps watching), `ship: GREEN #n` (every check passed; once per green), `ship: READY #n <sha>` (below), `ship: MERGED #n <sha>`, `ship: CLOSED #n (unmerged)`
# or `ship: WATCH ENDED #n (still open)` after the cap. `ship: CONFLICT #n` (GitHub says the PR cannot merge into main; once per conflict, UNKNOWN is never reported) is followed at once by
# tools/pr-conflict-fix.sh, which rebases the stacked-parent case and logs `ship: CONFLICT FIXED #n (stacked parent #m)`; a cleared conflict re-arms GREEN. No AI, only gh.
#   tools/ship-watch.sh <n> <log> <pidfile> [<owner/repo>, default: the cwd's origin, fixed at start]      SHIP_WATCH_FIX=<script> the fixer (default: next to this file)   SHIP_WATCH_POLL=<s> between looks (default 60)   SHIP_WATCH_CAP=<s> give up after (default 172800 = 48 h)
# `ship: COMMENT #n <owner|bot|other> <comment|review-<state>|line> <url>` (27 Oct 2026): once per new comment or review by the owner, a review bot or anyone else, never a session's own; the ids already told live in <pidfile>.comments,
# so a restart or a second ship repeats none. Every read is REST with the last ETag (tools/pr-rest-lib.sh), free while nothing changed. Guard: tests/test_pr_comments.py.
# `ship: READY #n <sha>` (30 Oct 2026): the owner's "ready" on this head: every check green, Gitar ✅ Approved (its label), no "Working on PR comments" label, no unanswered
# owner or other comment, no conflict and not a draft; once per head, re-armed when any of it drops. Only READY lets a session tell the owner a PR is ready.
# Started detached by tools/ship.sh when the PR opens (18 Oct 2026: #1321 sat red for hours because the watcher began only after REVIEW); a second ship of the same branch replaces the old watcher through the pid file (18 Oct 2026: the owner merges by hand and
# sessions only learned of it when told). Guard: tests/test_ship_watch.py, tests/test_pr_conflict_fix.py.
set -u
n="${1:?usage: ship-watch.sh <n> <log> <pidfile> [<owner/repo>]}"; log="${2:?}"; pidfile="${3:?}"
here="$(cd "$(dirname "$0")" && pwd)"; . "$here/pr-comments-lib.sh"; . "$here/pr-rest-lib.sh"
# Why (27 Oct 2026, web #177's watcher looked for 17 h after the merge): the repo is fixed when the watch starts; every look names it, so a worktree deleted after the merge changes nothing.
repo="${4:-$(pr_repo .)}"; start_dir="$PWD"
# Why (27 Oct 2026, owner's GraphQL limit ran out across ~8 sessions and every watcher went blind): a refused look waits twice as long each time, up to SHIP_WATCH_BACKOFF_MAX.
# Why (2 Nov 2026, owner: "let's check every 1 imnute"; PRs sat red for minutes): a look every 60 s, not 120; the ETag reads below made an unchanged look free, so the 27 Oct limit no longer sets the pace.
#   Each look reads REST with the last ETag (tools/pr-rest-lib.sh): an unchanged answer is free, so a look costs about one call.
poll="${SHIP_WATCH_POLL:-60}"; cap="${SHIP_WATCH_CAP:-172800}"; backoff_max="${SHIP_WATCH_BACKOFF_MAX:-900}"; backoff=0
old="$(cat "$pidfile" 2>/dev/null || true)"
echo $$ > "$pidfile"   # before the kill: the old watcher's exit trap then sees a newer pid and leaves the file alone
[ -z "$old" ] || [ "$old" = "$$" ] || kill "$old" 2>/dev/null || true   # one watcher per branch
trap '[ "$(cat "$pidfile" 2>/dev/null)" != "$$" ] || rm -f "$pidfile"' EXIT
# Why (30 Oct 2026, owner: "Sessions are not watching their PR to be ready. Their PRs are broken but they take no action"): the session that shipped the PR is told by this
#   watcher itself, not by a wait it must remember to re-arm: a Codex session through its thread (tools/codex-pr-events.py), a Claude Code session through cmux's
#   agent message (tools/claude-pr-events.py: red, conflict, comment, ready, merged, closed). Outside a cmux session both exit 0 silently and the log stays the channel.
notify_session() {
  if [ -n "${CODEX_THREAD_ID:-${CODEX_SESSION_ID:-}}" ]; then python3 "$here/codex-pr-events.py" "$log"
  else python3 "$here/claude-pr-events.py" "$log"; fi
}
say() { echo "ship: $*" >> "$log"; notify_session; }
finish_terminal() {
  # Why (30 Oct 2026, owner; #2558): retry delivery locally, never keep polling GitHub after the PR merged or closed.
  local attempt
  for attempt in 1 2; do
    notify_session && return 0
    [ "$attempt" = 2 ] || sleep 1
  done
  echo "ship: $([ -n "${CODEX_THREAD_ID:-${CODEX_SESSION_ID:-}}" ] && echo CODEX || echo CLAUDE) DELIVERY PENDING #$n (PR $1; events remain in the log)" >> "$log"
}

[ -n "$repo" ] || { say "WATCH ENDED #$n (no GitHub repository)"; exit 0; }
fixer="${SHIP_WATCH_FIX:-$here/pr-conflict-fix.sh}"
seen="$pidfile.comments"; touch "$seen" 2>/dev/null
# Why (#PR comments, owner 27 Oct 2026): the cursor is a file of told ids, not a timestamp, so an edited or late comment is never lost and a restart never repeats one.
# Why (27 Oct 2026, owner: "Start a fixer"): a watcher that starts on an existing PR has an empty cursor (#2241: 3 gitar-bot comments fixed hours earlier were announced again);
#   an item already answered (a session reply or a later commit, pc_unanswered) is marked told WITHOUT a COMMENT line; unanswered old ones are still told once.
#   Only items created before this watcher started may be silenced (gitar-bot on #2258): a comment that arrives while it runs and meets an unrelated push before the next look is still told.
started="${SHIP_WATCH_STARTED:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
report_comments() {  # <view json>; sets $waiting: the owner's and others' items still unanswered (a bot's are judged by Gitar's verdict label)
  local lines rows open id who kind url t last summary
  lines="$(pr_get "repos/$repo/pulls/$n/comments?per_page=100")" || lines=""
  rows="$(pc_items "$1" "${lines:-null}")"
  last="$(pc_last_authored "$1")"
  open="$(pc_unanswered "$last" <<<"$rows" | cut -f1)"
  waiting="$(pc_unanswered "$last" <<<"$rows" | awk -F'\t' '$2 == "owner" || $2 == "other"' | grep -c . || true)"
  while IFS=$'\t' read -r id who kind url t; do
    [ -n "$id" ] && [ "$who" != self ] || continue   # a PR with no comments still feeds the loop one empty row
    grep -qxF "$id" "$seen" 2>/dev/null && continue
    echo "$id" >> "$seen"
    if [[ "$t" > "$started" ]] || grep -qxF "$id" <<<"$open"; then
      summary=""
      if [ "$who" = bot ] && [ "$kind" = comment ]; then summary="$(pc_gitar_summary "$1" "$id")"; fi
      # Why (#2618, 30 Oct 2026): Gitar deletes and re-posts an unchanged verdict after a push; compare only with the last summary actually reported for this PR.
      if [ -n "$summary" ] && [ "$(cat "$seen.gitar-$n" 2>/dev/null)" = "$summary" ]; then continue; fi
      say "COMMENT #$n $who $kind $url"
      [ -z "$summary" ] || printf '%s\n' "$summary" > "$seen.gitar-$n"
    fi
  done <<<"$rows"
}
waited=0; red=""; green=""; conflict=""; ready=""; waiting=0
while :; do
  view="$(pr_view "$repo" "$n" full)" || view=""
  state="$(jq -r '.state // empty' <<<"$view" 2>/dev/null)"
  if [ -n "$state" ]; then
    head="$(jq -r '.headRefOid // empty' <<<"$view")"
    # Publish before any notification, including comments and retrying a previously undelivered RED.
    printf '%s %s\n' "$n" "$head" > "$log.head.$$" && mv -f "$log.head.$$" "$log.head"
  fi
  case "$state" in
    MERGED) say "MERGED #$n $(jq -r '.mergeCommit.oid // empty' <<<"$view" | cut -c1-7)"; finish_terminal MERGED; exit 0 ;;
    CLOSED) say "CLOSED #$n (unmerged)"; finish_terminal CLOSED; exit 0 ;;
  esac
  if [ -n "$state" ]; then
    case "$(jq -r '.mergeable // empty' <<<"$view" 2>/dev/null)" in   # UNKNOWN (GitHub is still working it out) keeps the last known state
      CONFLICTING) if [ -z "$conflict" ]; then conflict=1; say "CONFLICT #$n"; (cd "$start_dir" && bash "$fixer" "$n" "$log") >/dev/null 2>&1 || true; fi ;;
      MERGEABLE) [ -z "$conflict" ] || { conflict=""; green=""; } ;;
    esac
    report_comments "$view"
    # Why (18 Oct 2026, #1476; 30 Oct 2026, #2618): checks use this PR snapshot's head and RED names it; old rollups and manual runs must not decide it.
    #   GREEN also needs the required "All checks passed" green on it: a status pr-verdict.yml writes since 26 Oct 2026 (before: a check-run of pr-gate.yml with that name).
    checks="$(pr_checks "$repo" "$head")" || checks=""
    now="$(jq -r '[.[]? | select(.bucket == "fail") | .name] | first // empty' <<<"${checks:-[]}" 2>/dev/null)" || now=""
    key="${now:+$head:$now}"
    [ "$key" = "$red" ] || { [ -z "$now" ] || say "RED #$n $now $head"; red="$key"; }   # once per red check; green again re-arms it
    if jq -e 'length > 0 and all(.[]; .bucket == "pass" or .bucket == "skipping") and any(.[]; .name == "All checks passed")' <<<"${checks:-[]}" >/dev/null 2>&1; then
      [ -n "$green" ] || say "GREEN #$n"; green=1   # once per green; a push brings new pending checks, which re-arms it
    else green=""; fi
    # Why (30 Oct 2026, owner via d3: "my PRs are not fully approved by Gitar"): d3 told the owner ready on GREEN while Gitar read "approved with suggestions".
    # Why (#2618, 30 Oct 2026): an intentionally held draft is never ready for the owner's merge.
    if [ -n "$green" ] && [ -z "$conflict" ] && [ "${waiting:-0}" = 0 ] \
      && jq -e '(.isDraft != true) and (.labels // [] | index("Gitar: approved")) and (.labels // [] | index("Working on PR comments") | not)' <<<"$view" >/dev/null 2>&1; then
      [ "$ready" = "$head" ] || say "READY #$n ${head:0:7}"; ready="$head"
    elif [ -n "$checks" ]; then ready=""; fi   # a failed check read clears GREEN for one look, never READY: no second READY for the same head
  fi
  notify_session   # retry a failed delivery even if the PR state has not changed
  [ "$waited" -lt "$cap" ] || { say "WATCH ENDED #$n (still open)"; exit 0; }
  if [ -n "$view" ]; then backoff=0; else backoff=$(( backoff ? backoff * 2 : (poll > 0 ? poll : 1) * 2 )); [ "$backoff" -le "$backoff_max" ] || backoff="$backoff_max"; fi
  pause=$(( backoff ? backoff : poll )); sleep "$pause"; waited=$((waited + pause + 1))
done
