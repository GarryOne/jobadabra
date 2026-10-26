#!/usr/bin/env bash
# No beta while main's e2e is red (gate G2, owner's yes 26 Oct 2026). tools/beta-release.sh calls it before it dispatches a beta.
#   main green (tools/main_e2e_state.py)                  → exit 0
#   red, and no commit on main since the red run           → exit 1: fix it first (the beta would show the same reds)
#   red, commits landed since                              → re-runs ONLY the red suites on main now and waits: green → exit 0, red → exit 1
#   --force "<why>" (as beta-release.sh's)                → exit 0 with the reds named; beta-release.sh puts the reason in the beta run's summary
# Why: 25 Oct 2026, main's 21:47 run was red on cardstates, interactions and settings; beta 2 started 1.5 h later and failed on the same suites.
# Usage: tools/red-main-gate.sh <repo> [--force "<why>" | --status]   --status only reads (exit 0 green, 1 red); any other option is refused and starts nothing (26 Oct 2026: a --dry-run was ignored and re-ran main's red suites)     RED_MAIN_POLL / RED_MAIN_FIND_S / RED_MAIN_WAIT_S for tests.
# Tests: tests/test_red_main_gate.py
set -uo pipefail
repo="${1:?repo}"; shift
force="" status=""
case "${1:-}" in
  "") ;;
  --force) force="${2:?--force needs a reason}" ;;
  --status) status=1 ;;   # read-only: name the red suites, start nothing
  *) echo "Unknown option: $1 (use --force \"<why>\" or --status). Nothing started." >&2; exit 2 ;;
esac
here="$(cd "$(dirname "$0")" && pwd)"
poll="${RED_MAIN_POLL:-30}" find_max="${RED_MAIN_FIND_S:-300}" wait_max="${RED_MAIN_WAIT_S:-3600}"

reds="$(python3 "$here/main_e2e_state.py" --repo "$repo")"
if [ -z "$reds" ]; then echo "Main's e2e: no suite red."; exit 0; fi
echo "Main's e2e is red:"; awk -F'\t' '{ printf "  %s (since %s, %s)\n", $1, $2, $4 }' <<<"$reds"
if [ -n "$status" ]; then exit 1; fi
if [ -n "$force" ]; then echo "Starting the beta anyway (--force): $force"; exit 0; fi

head="$(gh api "repos/${repo}/commits/main" --jq .sha 2>/dev/null)"
if [ -z "$head" ]; then echo "Could not read main's head: no beta. Re-run, or --force \"<why>\"."; exit 1; fi
if ! awk -F'\t' -v h="${head:0:7}" '$2 != h { found = 1 } END { exit !found }' <<<"$reds"; then
  echo "No commit on main since those runs: no beta (it would fail on the same suites). Fix them (skill fix-failing-e2e), or --force \"<why>\"."
  exit 1
fi

suites="$(cut -f1 <<<"$reds" | paste -sd, -)"
since="$(date -u -d '-5 seconds' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-5S +%Y-%m-%dT%H:%M:%SZ)"   # GNU first, macOS fallback
echo "Commits landed since: re-checking ${suites} on main ${head:0:7} before the beta (about 10-15 min)..."
if ! gh workflow run e2e.yml -R "$repo" --ref main -f suite="$suites" >/dev/null; then echo "Could not start the re-check: no beta."; exit 1; fi
start=$(date +%s); id=
while [ -z "$id" ]; do
  id="$(gh api "repos/${repo}/actions/workflows/e2e.yml/runs?event=workflow_dispatch&branch=main&per_page=10" \
    --jq ".workflow_runs[] | select(.created_at >= \"${since}\" and (.display_title | contains(\"${suites}\"))) | .id" 2>/dev/null | grep -E '^[0-9]+$' | tail -1)"
  [ -n "$id" ] && break
  if [ $(( $(date +%s) - start )) -ge "$find_max" ]; then echo "The re-check run did not appear: no beta."; exit 1; fi
  sleep "$poll"
done
url="https://github.com/${repo}/actions/runs/${id}"
echo "Re-check: ${url}"
while :; do
  st="$(gh api "repos/${repo}/actions/runs/${id}" --jq '"\(.status) \(.conclusion // "-")"' 2>/dev/null)"
  case "$st" in completed\ *) break ;; esac
  if [ $(( $(date +%s) - start )) -ge "$wait_max" ]; then echo "The re-check is still running after $(( wait_max / 60 )) min: no beta. ${url}"; exit 1; fi
  sleep "$poll"
done
if [ "${st#completed }" = success ]; then
  echo "Re-check green: main's e2e is green again."
  GITHUB_REPOSITORY="$repo" python3 "$here/e2e_bisect.py" after-run "$id" || true   # closes the red-main issues of the suites green again (gate G2b)
  exit 0
fi
echo "Re-check ${st#completed }: main is still red (${url}). No beta: fix the suite (skill fix-failing-e2e), or --force \"<why>\"."
exit 1
