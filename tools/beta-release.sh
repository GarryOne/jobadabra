#!/usr/bin/env bash
# A beta by hand, in one shot: one release run (desktop.yml -f beta=true, named "Beta by hand"), the same as the nightly, two lanes at once:
#   Mac:     Build · Mac -> E2E · Mac + Linux (every gate suite) -> Release · Mac beta (no high-severity finding, unit suites green, additive Notion schema -> "Beta-approved:")
#   Windows: Build · Windows -> E2E · Windows (the same suites) -> Release · Windows beta ("Beta-approved (Windows):")
#   then Clean up old builds
# Each platform gets its own approval line, but both need every gate suite of BOTH lanes green (owner, 30 Oct 2026): one red leaves all testers on their current beta. Never call tools/beta-approve.sh by hand: it skips the gate.
#   tools/beta-release.sh [--no-watch] [--force "<why>"]
# Only on a proved commit (tools/night_proof.py): no --force past it.
# No beta while main's e2e is red (gate G2, 26 Oct 2026; tools/red-main-gate.sh): fixes landed since → only the red suites re-run on main first; --force "<why>" starts it
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
# A beta by hand starts ONLY on a commit the night proved (owner, 1 Nov 2026: "Only on a proved commit"): main's head, the commit this run would build, needs 5 green night burn-in
# passes on Mac + Linux and on Windows, a green build.yml and both unit results of a build. Not proved: it says what is missing and starts nothing; --force does not go past it
# (a beta is never forced). Why: 68 of 90 betas by hand ended red in 24 days. tools/night_proof.py, tests/test_night_proof.py.
python3 "$(dirname "$0")/night_proof.py" --repo "$repo" || exit 1
if [ -n "$force" ]; then bash "$(dirname "$0")/red-main-gate.sh" "$repo" --force "$force"; else bash "$(dirname "$0")/red-main-gate.sh" "$repo" || exit 1; fi
gh workflow run desktop.yml -R "$repo" --ref main -f beta=true ${force:+-f over_red_main="$force"}
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
version=$(gh run view "$id" -R "$repo" --log 2>/dev/null | sed -n 's/.*Releasing \([0-9.]*\).*/\1/p' | head -1)
if gh run view "$id" -R "$repo" --log 2>/dev/null | grep -q "not released"; then
  echo "Build ${version:-?} was NOT released (workflows changed on main during it): a new build of main started by itself."
elif notes=$(gh release view "desktop-v$version" -R "$repo" --json body -q .body 2>/dev/null); then
  mac=$(grep -q '^Beta-approved:' <<<"$notes" && echo "approved" || echo "NOT approved")
  win=$(grep -q '^Beta-approved (Windows):' <<<"$notes" && echo "approved" || echo "NOT approved")
  echo "desktop-v${version}: Mac beta ${mac}, Windows beta ${win}. The run: ${run#* }"
else
  echo "Build ${version:-?} finished without a release: see ${run#* }"
fi
