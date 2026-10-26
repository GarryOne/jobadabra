#!/usr/bin/env bash
# Waits for the e2e run a pull request started (pr-suites.yml) and fails when it ends red, so the PR's suites block the merge through "All checks passed".
# Why (26 Oct 2026, gate G1a): the run was report only; on 25 Oct two run-view PRs saw cardstates red on their own run and merged, and beta 2 failed on it.
# A flaky suite (red, then green on the same commit) already ends its job green in e2e.yml; red twice is a real failure here.
# Usage: tools/pr-suites-wait.sh <repo> <branch> <head sha> <started at, ISO UTC>   (needs GH_TOKEN with actions: read)
# Tests: tests/test_pr_suites_wait.py
set -uo pipefail
repo="${1:?repo}" branch="${2:?branch}" sha="${3:?head sha}" since="${4:?started at}"
poll="${PR_SUITES_POLL:-30}" find_max="${PR_SUITES_FIND_S:-300}" wait_max="${PR_SUITES_WAIT_S:-4200}"   # 70 min: "All checks passed" gives up at 60
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

# The dispatched run of this commit, started at or after the dispatch (an older run of the same commit is a previous push's, already judged).
find_run() {
  gh api "repos/${repo}/actions/workflows/e2e.yml/runs?event=workflow_dispatch&branch=${branch}&head_sha=${sha}&per_page=20" \
    --jq ".workflow_runs[] | select(.head_sha == \"${sha}\" and .created_at >= \"${since}\") | .id" 2>/dev/null | grep -E '^[0-9]+$' | tail -1
}
start=$(date +%s); id=
while [ -z "$id" ]; do
  id="$(find_run)"
  [ -n "$id" ] && break
  if [ $(( $(date +%s) - start )) -ge "$find_max" ]; then
    echo "::error::No e2e run of ${sha:0:7} appeared within ${find_max}s after the dispatch: re-run this job." | tee -a "$summary"; exit 1
  fi
  sleep "$poll"
done
url="https://github.com/${repo}/actions/runs/${id}"
echo "Waiting for the PR's e2e run: ${url}" | tee -a "$summary"

state=
while :; do
  state="$(gh api "repos/${repo}/actions/runs/${id}" --jq '"\(.status) \(.conclusion // "-")"' 2>/dev/null)"
  case "$state" in completed\ *) break ;; esac
  if [ $(( $(date +%s) - start )) -ge "$wait_max" ]; then
    echo "::error::The e2e run is still running after $(( wait_max / 60 )) min (a suite waiting on its lock?): ${url}" | tee -a "$summary"; exit 1
  fi
  sleep "$poll"
done

conclusion="${state#completed }"
if [ "$conclusion" = success ] || [ "$conclusion" = skipped ]; then
  echo "✅ The PR's e2e suites passed: ${url}" | tee -a "$summary"; exit 0
fi
red="$(gh api "repos/${repo}/actions/runs/${id}/jobs?per_page=100" --jq '.jobs[] | select(.conclusion == "failure") | .name' 2>/dev/null | paste -sd, - | sed 's/,/, /g')"
{
  echo "::error::The PR's e2e run ended ${conclusion}: ${red:-see the run}."
  echo "❌ E2E suites red on this PR (${red:-$conclusion}): ${url}"
  echo "Read the failed step's screenshot and log in that run (skill fix-failing-e2e), fix the test or the product, push again."
} | tee -a "$summary"
exit 1
