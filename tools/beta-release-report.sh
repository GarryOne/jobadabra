#!/usr/bin/env bash
# What a beta by hand did, in one line: which version it built and whether each platform approved it. Called by tools/beta-release.sh after the run ends.
#   tools/beta-release-report.sh <run id> <run url>
# Why (1 Nov 2026, #41277723872): the report read the version from the run log's "Releasing X" line, which the log now shows first as the step's own source (`echo "Releasing $version"`), so the version
# came out empty and a released beta (desktop-v0.8.67, approved on both platforms) was reported as "finished without a release". It reads what the run leaves behind instead: the version tag the build
# made at the run's head commit, the release notes' "Beta-approved" lines, and the release gate's own "Not released: <why>" line (tools/beta_rate_gate.py).
set -euo pipefail
repo=${BETA_REPO:-GarryOne/jobadabra}
id=${1:?usage: beta-release-report.sh <run id> <run url>}
url=${2:-}
head=$(gh run view "$id" -R "$repo" --json headSha -q .headSha)
tag=$(gh api "repos/$repo/git/matching-refs/tags/desktop-v" --paginate --jq '.[] | "\(.ref) \(.object.sha)"' \
  | awk -v sha="$head" '$2 == sha {sub("refs/tags/", "", $1); print $1}' | grep -E '^desktop-v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)
if [ -z "$tag" ]; then
  echo "The build made no version tag at ${head:0:7}: see $url"
elif notes=$(gh release view "$tag" -R "$repo" --json body -q .body 2>/dev/null); then
  mac=$(grep -q '^Beta-approved:' <<<"$notes" && echo "approved" || echo "NOT approved")
  win=$(grep -q '^Beta-approved (Windows):' <<<"$notes" && echo "approved" || echo "NOT approved")
  echo "${tag}: Mac beta ${mac}, Windows beta ${win}. The run: $url"
  if [ "$mac" != approved ] || [ "$win" != approved ]; then
    # The gate's one line of why, quoted ("Not released: red: Mac + Linux: focusdismiss"); a run log holds the same text lowercase in its step source, which this does not match.
    why=$(gh run view "$id" -R "$repo" --log 2>/dev/null | grep -o 'Not released: .*' | sort -u || true)
    [ -z "$why" ] || printf '%s\n' "$why"
  fi
else
  echo "${tag}: the build finished without a release (workflows changed on main during it: a new build of main started by itself): see $url"
fi
