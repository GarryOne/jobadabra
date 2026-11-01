#!/usr/bin/env bash
# A beta by hand, in one shot: one release run (desktop.yml -f beta=true, named "Beta by hand"), the same as the nightly, two lanes at once:
#   Mac:     Build · Mac -> E2E · Mac + Linux (every gate suite) -> Release · Mac beta (no high-severity finding, unit suites green, additive Notion schema -> "Beta-approved:")
#   Windows: Build · Windows -> E2E · Windows (the same suites) -> Release · Windows beta ("Beta-approved (Windows):")
#   then Clean up old builds
# Each platform gets its own approval line, but both need every gate suite of BOTH lanes green (owner, 30 Oct 2026): one red leaves all testers on their current beta. Never call tools/beta-approve.sh by hand: it skips the gate.
#   tools/beta-release.sh [--no-watch] [--force "<why>"]
# No beta while main's e2e is red on a safety or data step (gate G2, 26 Oct 2026; tools/red-main-gate.sh; any other red goes on and is listed, 1 Nov 2026): fixes landed since → only the red suites re-run on main first; --force "<why>" starts it
# anyway and the reason shows in the beta run's log. Why: beta 2 (25 Oct) started 1.5 h after main went red on the same suites.
set -euo pipefail
repo=GarryOne/jobadabra
watch=1 force=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-watch) watch=0 ;;
    --force) force="${2:?--force needs a reason}"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
# Why (1 Nov 2026, owner: "Safety strict, rest tolerant"): the gate stops a beta only for a failed safety or data step; any other red goes on and its line goes to the release notes (-f red_not_blocking).
gate_log="$(mktemp)"; trap 'rm -f "$gate_log"' EXIT
if [ -n "$force" ]; then bash "$(dirname "$0")/red-main-gate.sh" "$repo" --force "$force" | tee "$gate_log"; else bash "$(dirname "$0")/red-main-gate.sh" "$repo" | tee "$gate_log" || exit 1; fi
red_note="$(grep '^Red on main, not safety or data: ' "$gate_log" | tail -1 || true)"
gh workflow run desktop.yml -R "$repo" --ref main -f beta=true ${force:+-f over_red_main="$force"} ${red_note:+-f red_not_blocking="$red_note"}
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
