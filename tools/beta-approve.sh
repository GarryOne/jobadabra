#!/usr/bin/env bash
# Mark a pre-release as approved for beta testers: it passed the unit suites and every end-to-end suite on its own commit.
# Only approved builds are offered to people who switched on "Beta" in the app (desktop/lib/updater.js looks for the marker line
# in the release notes). It does NOT make the build stable: that is canary-promote.yml (more end-to-end runs, no blocking finding, healthy beta use).
#   tools/beta-approve.sh desktop-v0.5.3             Mac (and Linux): unit suites + every Mac/Linux end-to-end suite (e2e.yml promote)
#   tools/beta-approve.sh --windows desktop-v0.5.3   Windows: unit suites + every Windows end-to-end suite (e2e-windows.yml approve-windows). Each platform
#   reads only its own line (desktop/lib/updater.js approvedFor; one release, one version, neither platform waits for the other; owner, 6 Oct 2026).
set -euo pipefail
repo=GarryOne/jobadabra
windows=''; if [ "${1:-}" = --windows ]; then windows=1; shift; fi
tag=${1:?usage: tools/beta-approve.sh [--windows] <tag>}
marker='Beta-approved:'; [ -n "$windows" ] && marker='Beta-approved (Windows):'
body=$(gh release view "$tag" -R "$repo" --json body -q .body)
if printf '%s\n' "$body" | grep -qF -- "$marker"; then echo "$tag is already approved ($marker)."; exit 0; fi
sha=$(gh api "repos/$repo/commits/$tag" -q '.sha[0:7]')
line="$marker unit suites and every end-to-end suite passed on commit $sha ($(date -u +%Y-%m-%d))"
[ -n "$windows" ] && line="$marker unit suites and every Windows end-to-end suite passed on commit $sha ($(date -u +%Y-%m-%d))"
# Why (1 Nov 2026, owner: "Auto-retry in betas only"): a beta released past a step that passed on its retry lists it ("Passed on retry in this beta: <suite · step>, …"); desktop.yml writes the line to the file, empty when none retried.
retry=''; [ -n "${PASSED_ON_RETRY_FILE:-}" ] && [ -s "$PASSED_ON_RETRY_FILE" ] && retry=$(cat "$PASSED_ON_RETRY_FILE")
gh release edit "$tag" -R "$repo" --notes "$(printf '%s\n\n%s' "$body" "$line${retry:+$'\n'$retry}")"
echo "$tag: $line"
python3 "$(dirname "${BASH_SOURCE[0]}")/sync_release_labels.py" || echo "(release labels not refreshed: run tools/sync_release_labels.py)"
