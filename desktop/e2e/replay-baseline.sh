#!/usr/bin/env bash
# The replay gate's baseline: the newest green scheduled replay on main that kept its results (site-replays.yml "replay-results-<run>"), downloaded into <dir>.
# Prints its results.json path, or "-" when there is none yet. bash replay-baseline.sh <dir>. Needs GH_TOKEN, GITHUB_REPOSITORY. Used by .github/workflows/site-replays-pr.yml.
set -u
dir="${1:?usage: replay-baseline.sh <dir>}"; mkdir -p "$dir"
# Until 28 Oct 2026 (artifacts live 14 days): the runs of the workflow's old file name count too (replay-offline.yml until 14 Oct 2026). Guard: tests/test_replays_site_workflow.py.
for base in $(for wf in site-replays.yml replay-offline.yml; do gh run list -R "$GITHUB_REPOSITORY" --workflow "$wf" --branch main --status success --limit 20 --json databaseId --jq '.[].databaseId'; done); do
  # "replay-results-linux-<run>" since the scheduled replay moved to Linux (15 Oct 2026); the older "replay-results-<run>" (macOS-made) is the fallback until the first Linux run is green.
  for name in "replay-results-linux-$base" "replay-results-$base"; do
    if gh run download "$base" -R "$GITHUB_REPOSITORY" --name "$name" --dir "$dir" >/dev/null 2>&1; then echo "baseline: run $base" >&2; echo "$dir/results.json"; exit 0; fi
  done
done
echo "baseline: none yet" >&2; echo -
