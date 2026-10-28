#!/usr/bin/env bash
# The release checks every platform's beta approval shares (e2e.yml promote for Mac/Linux, e2e-windows.yml approve-windows): the unit suites are green on the
# commit, and (soak on) the Notion schema is additive over the current stable. Each platform's own end-to-end suites are checked by its own job.
#   tools/release-checks.sh <tag> <commit sha>      exit 1, with the reason on stdout, when the build must not be offered
set -euo pipefail
tag=${1:?usage: tools/release-checks.sh <tag> <sha>}; ref=${2:?usage: tools/release-checks.sh <tag> <sha>}
repo=${GITHUB_REPOSITORY:-GarryOne/jobadabra}

# A beta cut right after a push to main meets main's own build.yml still running on the same commit (beta 17, 24 Oct 2026: "build.yml on b5c13d0: none", the run was 35 min in):
# wait for it, bounded, and decide on its result; only red, cancelled (see below) or a run still going after the wait stop the release.
wait_max=${RELEASE_CI_WAIT:-3600}; poll=${RELEASE_CI_POLL:-30}; waited=0; said=-60
while :; do
  open=$(gh run list -R "$repo" --workflow build.yml --commit "$ref" --json status --jq '[.[] | select(.status != "completed")] | length' 2>/dev/null) || open=0
  case "$open" in ''|*[!0-9]*) open=0;; esac
  [ "$open" -gt 0 ] || break
  if [ "$waited" -ge "$wait_max" ]; then echo "build.yml on ${ref:0:7} is still running after ${waited} s: not waiting any longer."; break; fi
  if [ $((waited - said)) -ge 60 ]; then echo "build.yml on ${ref:0:7} is still running; waiting (${waited} s of ${wait_max} s)"; said=$waited; fi
  sleep "$poll"; waited=$((waited + poll))
done
verdict=$(gh run list -R "$repo" --workflow build.yml --commit "$ref" --status completed --json conclusion | python3 "$(dirname "${BASH_SOURCE[0]}")/e2e_gate.py" ci)
# A push to main cancels the older commit's build.yml run (15 Oct 2026): the newest commit's run decides, so a cancelled run is green when a NEWER commit of main passed.
# Why (28 Oct 2026, owner): a cancelled beta must wait for the newer main build that decides for it.
while [ "$verdict" = superseded ]; do
  newer=$(python3 "$(dirname "${BASH_SOURCE[0]}")/e2e_gate.py" newer-green "$repo" "$ref" || true)
  if [ -n "$newer" ]; then verdict=green; echo "build.yml on ${ref:0:7} was replaced by a newer push; ${newer:0:7} (newer, on main) is green"; break; fi
  newer=$(python3 "$(dirname "${BASH_SOURCE[0]}")/e2e_gate.py" newer-running "$repo" "$ref" || true)
  # Why (28 Oct 2026, owner): only absence of both newer green and pending builds is a final red verdict.
  if [ -z "$newer" ]; then verdict=red; break; fi
  # Why (28 Oct 2026, owner): own and replacement builds share one bounded wait, even across repeated pushes.
  if [ "$waited" -ge "$wait_max" ]; then echo "build.yml on newer commit ${newer:0:7} is still running after ${waited} s: not waiting any longer."; verdict=red; break; fi
  if [ $((waited - said)) -ge 60 ]; then echo "waiting for the newer commit ${newer:0:7}'s build.yml (${waited} s of ${wait_max} s)"; said=$waited; fi
  sleep "$poll"; waited=$((waited + poll))
done
echo "build.yml on ${ref:0:7}: $verdict"
if [ "$verdict" != green ]; then echo "$tag stays a pre-release: build.yml is not green on its commit."; exit 1; fi

# The schema is additive over the current stable, so "Back to stable" cannot split anybody's data.
if [ "${JOB_PILOTTO_SOAK:-}" = on ]; then
  stable=$(gh release list -R "$repo" -L 20 --json tagName,isPrerelease,isDraft -q '[.[] | select(.isDraft | not) | select(.isPrerelease | not)][0].tagName')
  if [ -z "$stable" ] || [ "$stable" = "$tag" ]; then echo "No older stable to compare the schema with."; exit 0; fi
  tmp=$(mktemp -d)
  gh api "repos/$repo/contents/config/notion_schema.json?ref=$stable" -q .content | base64 -d > "$tmp/stable-schema.json"
  gh api "repos/$repo/contents/config/notion_schema.json?ref=$tag" -q .content | base64 -d > "$tmp/candidate-schema.json"
  status=0
  echo "Schema $tag vs stable $stable:"
  python3 "$(dirname "${BASH_SOURCE[0]}")/check_schema_additive.py" "$tmp/stable-schema.json" "$tmp/candidate-schema.json" || status=$?
  if [ "$status" != 0 ]; then echo "$tag is not offered to beta testers: it changes the Notion schema in a way the older app cannot undo."; exit 1; fi
fi
