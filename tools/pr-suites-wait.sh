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

jobs_json() { gh api "repos/${repo}/actions/runs/${id}/jobs?per_page=100" 2>/dev/null || echo '{"jobs":[]}'; }
# The jobs of e2e.yml that are not a suite (they run before or after the suites and gate nothing): the verdict is the suites'.
# Guard: tests/test_pr_suites_wait.py AfterSuiteJobs reads e2e.yml, so a new job there must be named here.
NOT_SUITES='["plan","Nothing tested","HTML report","Code → suite map","Telegram alert","promote","Windows follows"]'
suites() { jq -c --argjson ns "$NOT_SUITES" '[.jobs[] | select(.name as $n | $ns | index($n) | not)]' <<<"$1"; }
failed_jobs() { jq -r '[.[] | select(.conclusion == "failure") | .name] | join(", ")' <<<"$1"; }
red_exit() {   # $1: the red jobs, $2: what the run did
  {
    echo "::error::The PR's e2e run ${2}: ${1:-see the run}."
    echo "❌ E2E suites red on this PR (${1:-$2}): ${url}"
    echo "Read the failed step's screenshot and log in that run (skill fix-failing-e2e), fix the test or the product, push again."
  } | tee -a "$summary"
  exit 1
}

# A suite job that ended red already decides (its second try ran inside the job): stop at once, never wait for the rest of the run.
# Why: 26 Oct 2026, #1992's wander and quality were red at 02:12 and the PR waited 31 minutes for the other suites before it was blocked.
# Every poll says what it waits for (owner, 26 Oct 2026, at 12 minutes of a silent wait: "Why its waiting? For what? I see no logs, no updates"):
# each suite as it ends, then one line with the count, the running suites and their minutes, and the ones still waiting for a runner.
state= last= said=0 done_names=
while :; do
  state="$(gh api "repos/${repo}/actions/runs/${id}" --jq '"\(.status) \(.conclusion // "-")"' 2>/dev/null)"
  s_json="$(suites "$(jobs_json)")"
  red="$(failed_jobs "$s_json")"
  [ -n "$red" ] && red_exit "$red" "has a red suite, not waiting for the others"
  now=$(date +%s)
  while IFS=$'\t' read -r name mins; do
    [ -z "$name" ] && continue
    case ",$done_names," in *",$name,"*) continue ;; esac
    done_names="${done_names},${name}"; echo "✓ ${name} (${mins})"
  done < <(jq -r '.[] | select(.status == "completed") | [.name, (if .started_at and .completed_at then "\(((.completed_at|fromdateiso8601) - (.started_at|fromdateiso8601)) / 60 | floor) min" else "-" end)] | @tsv' <<<"$s_json")
  line="$(jq -r --argjson now "$now" '
    (map(select(.status == "completed" and (.conclusion == "success" or .conclusion == "skipped"))) | length) as $ok
    | (map(select(.status == "in_progress") | "\(.name) (\(if .started_at then (($now - (.started_at|fromdateiso8601)) / 60 | floor) else 0 end) min)") | join(", ")) as $run
    | (map(select(.status == "queued" or .status == "waiting" or .status == "pending") | .name) | join(", ")) as $wait
    | "⏳ \($ok) of \(length) suites passed" + (if $run != "" then " · running: " + $run else "" end) + (if $wait != "" then " · waiting for a runner: " + $wait else "" end)' <<<"$s_json")"
  if [ "$line" != "$last" ] || [ $(( now - said )) -ge 120 ]; then echo "${line} · ${url}"; last="$line"; said=$now; fi
  # All suites green: pass now, without waiting for the jobs after them (the report, an alert). Why: #2017 waited 5 minutes for "HTML report".
  if jq -e 'length > 0 and all(.[]; .status == "completed" and (.conclusion == "success" or .conclusion == "skipped"))' <<<"$s_json" >/dev/null; then
    echo "✅ The PR's e2e suites passed ($(jq length <<<"$s_json") of $(jq length <<<"$s_json")): ${url}" | tee -a "$summary"; exit 0
  fi
  case "$state" in completed\ *) break ;; esac
  if [ $(( now - start )) -ge "$wait_max" ]; then
    echo "::error::The e2e run is still running after $(( wait_max / 60 )) min (a suite waiting on its lock?): ${url}" | tee -a "$summary"; exit 1
  fi
  sleep "$poll"
done

conclusion="${state#completed }"
if [ "$conclusion" = success ] || [ "$conclusion" = skipped ]; then
  echo "✅ The PR's e2e suites passed: ${url}" | tee -a "$summary"; exit 0
fi
red_exit "$(failed_jobs "$(suites "$(jobs_json)")")" "ended ${conclusion}"
