#!/usr/bin/env bash
# A beta by hand, in one shot: one release run (desktop.yml -f beta=true, named "Beta by hand"), the same as the nightly, two lanes at once:
#   Mac:     Build · Mac -> E2E · Mac + Linux (every gate suite) -> Release · Mac beta (no high-severity finding, unit suites green, additive Notion schema -> "Beta-approved:")
#   Windows: Build · Windows -> E2E · Windows (the same suites) -> Release · Windows beta ("Beta-approved (Windows):")
#   then Clean up old builds
# Each platform gets its own approval line, but both need every gate suite of BOTH lanes green (owner, 30 Oct 2026): one red leaves all testers on their current beta. Never call tools/beta-approve.sh by hand: it skips the gate.
#   tools/beta-release.sh [--no-watch] [--force "<why>"] [--head | --commit <sha>]
# Built from the newest commit of main whose CI · Tests run finished fully green (tools/beta_pick.py; "N commits behind main" is printed): main already proved it, so the beta
# neither waits for main's queue nor runs those jobs again (owner, 1 Nov 2026: "it's not so imperialistically necessary to be the latest, latest commit. It can be 2-3-4 commits olds... or 5"). --head builds main's head as before
# (the nightly always does); --commit <sha> names one green commit. An older commit runs on a tag beta-pick-<sha7> at that commit (GitHub runs the workflow file of the ref it is started on, so the
# run is that commit's own pipeline); the tag step uses the CI App's token, which may tag a commit whose workflow files differ from main's (desktop.yml).
# No beta while main's e2e is red on a safety or data step (gate G2, 26 Oct 2026; tools/red-main-gate.sh; any other red goes on and is listed, 1 Nov 2026): fixes landed since → only the red suites re-run on main first; --force "<why>" starts it
# anyway and the reason shows in the beta run's log. Why: beta 2 (25 Oct) started 1.5 h after main went red on the same suites.
set -euo pipefail
repo=GarryOne/jobadabra
watch=1 force="" at="" commit=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-watch) watch=0 ;;
    --force) force="${2:?--force needs a reason}"; shift ;;
    --head) at=head ;;
    --commit) commit="${2:?--commit needs a sha}"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
# Why (1 Nov 2026, owner: "Safety strict, rest tolerant"): the gate stops a beta only for a failed safety or data step; any other red goes on and its line goes to the release notes (-f red_not_blocking).
gate_log="$(mktemp)"; trap 'rm -f "$gate_log"' EXIT
if [ -n "$force" ]; then bash "$(dirname "$0")/red-main-gate.sh" "$repo" --force "$force" | tee "$gate_log"; else bash "$(dirname "$0")/red-main-gate.sh" "$repo" | tee "$gate_log" || exit 1; fi
red_note="$(grep '^Red on main, not safety or data: ' "$gate_log" | tail -1 || true)"
ref=main
pick=""
if [ "$at" != head ]; then
  # Why (1 Nov 2026, a8; beta 9): the first real use found no eligible commit, because main's head had just added a workflow file and so differs from every green run (24 of the last 60 main commits change a workflow file). With no commit named, the beta then builds main's head, as before #2883: its Release waits for that commit's CI. A named --commit still stops.
  pick="$(python3 "$(dirname "$0")/beta_pick.py" "$repo" ${commit:+--commit "$commit"})" || { [ -n "$commit" ] && exit 1; echo "Building main's head instead: its Release waits for that commit's CI · Tests (tools/beta_pick.py found no eligible green commit)."; pick=""; }
fi
if [ -n "$pick" ]; then
  sha=${pick%% *}; behind=${pick#* }
  if [ "$behind" -gt 0 ]; then
    # A tag at the green commit itself: the run is that commit's own pipeline, so its tests and its workflows agree (an overlay of main's workflow files on an older commit failed beta 13's unit test).
    ref="beta-pick-${sha:0:7}"
    git push -q -f origin "$sha:refs/tags/$ref"
    echo "Beta built from ${sha:0:7}, $behind commit(s) behind main (the newest fully green CI · Tests commit); tag $ref"
  else
    echo "Beta built from main's head ${sha:0:7} (fully green CI · Tests)"
  fi
fi
gh workflow run desktop.yml -R "$repo" --ref "$ref" -f beta=true ${force:+-f over_red_main="$force"} ${red_note:+-f red_not_blocking="$red_note"}
sleep 5
run=$(gh run list -R "$repo" --workflow desktop.yml --event workflow_dispatch -L 5 --json databaseId,displayTitle,url \
  -q '[.[] | select(.displayTitle == "Beta by hand")][0] | "\(.databaseId) \(.url)"')
echo "Beta by hand started: ${run#* }"
# Watched to the end (7 Oct 2026: a refused release went unnoticed): which version it published, and which platforms approved it. --no-watch returns at once.
if [ "$watch" = 0 ]; then
  echo "Build, then both gates, in that one run (about 45 minutes); a pass adds 'Beta-approved:' (Mac) and 'Beta-approved (Windows):' to the release notes."
  exit 0
fi
id=${run%% *}
gh run watch "$id" -R "$repo" --interval 30 >/dev/null 2>&1 || true
exec bash "$(dirname "$0")/beta-release-report.sh" "$id" "${run#* }"
