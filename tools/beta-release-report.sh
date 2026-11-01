#!/usr/bin/env bash
# What a beta by hand did, in one line: which version it built and whether each platform approved it. Called by tools/beta-release.sh after the run ends.
#   tools/beta-release-report.sh <run id> <run url>
# Why (1 Nov 2026, run 41277723872): the report took the version from the run log's Releasing line, but the log shows the step's own source first, so the version came out empty and a released beta
# (desktop-v0.8.67, approved on both platforms) was reported as finished without a release. It reads what the run leaves behind instead: the version tag the build made at the run's head commit, the
# release notes' approval lines, and the release gate's own one line of why (tools/beta_rate_gate.py).
set -euo pipefail
repo=${BETA_REPO:-GarryOne/jobadabra}
id=${1:?usage: beta-release-report.sh <run id> <run url>}
url=${2:-}
head=$(gh run view "$id" -R "$repo" --json headSha -q .headSha)
started=$(gh run view "$id" -R "$repo" --json createdAt -q .createdAt)
tag=$(gh api "repos/$repo/git/matching-refs/tags/desktop-v" --paginate --jq '.[] | "\(.ref) \(.object.sha)"' \
  | awk -v sha="$head" '$2 == sha {sub("refs/tags/", "", $1); print $1}' | grep -E '^desktop-v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)
log() { gh run view "$id" -R "$repo" --log 2>/dev/null || true; }
# The run's own one line of why, quoted. A run log holds the same words in its step source (lowercase, or inside an echo), which these patterns do not match.
gate_why() { log | grep -o 'Not released: .*' | sort -u || true; }
superseded_why() { log | grep -o '##\[warning\]Workflows changed on main during this build.*' | sed 's/^##\[warning\]//' | sort -u || true; }
if [ -z "$tag" ]; then
  echo "This run made no version tag at ${head:0:7}: see $url"
  superseded_why
elif ! published=$(gh release view "$tag" -R "$repo" --json publishedAt -q .publishedAt 2>/dev/null); then
  echo "${tag}: tagged, but the build finished without a release: see $url"
elif [ -z "$published" ]; then
  # A release still a draft has an empty publishedAt: the tag and the draft are this run's, a build lane never published it.
  echo "${tag}: a draft release, never published (a build lane did not finish): see $url"
elif [[ "$published" < "$started" ]]; then
  # Why (Gitar on #2819): a run that fails before its own tag step, on a commit an earlier run already tagged and released, finds that run's tag at the commit; its approval lines are not this run's result.
  echo "This run released nothing: ${tag} at this commit was released earlier, at ${published}: see $url"
  superseded_why
else
  notes=$(gh release view "$tag" -R "$repo" --json body -q .body)
  mac=$(grep -q '^Beta-approved:' <<<"$notes" && echo "approved" || echo "NOT approved")
  win=$(grep -q '^Beta-approved (Windows):' <<<"$notes" && echo "approved" || echo "NOT approved")
  echo "${tag}: Mac beta ${mac}, Windows beta ${win}. The run: $url"
  if [ "$mac" != approved ] || [ "$win" != approved ]; then gate_why; fi
fi
