#!/usr/bin/env bash
# Merges the suites' Playwright blob zips into one HTML report and NEVER fails the job: a report is a view of the run, not its verdict.
# Why: gate runs 40054602771 and 40058169671 (24 Oct 2026) had every suite green and still ended red, because one blob zip was corrupt (zlib "invalid code lengths set")
# and `merge-reports` crashed. A corrupt zip is left out and named in the log; a merge that still fails is said in the log and leaves no report.
# Usage: merge-e2e-report.sh <dir with blob zips, searched recursively> <output dir>; prints made=1 to $GITHUB_OUTPUT when a report was made.
# Tests: tests/test_merge_e2e_report.py
set -uo pipefail

blobs="${1:?dir with the blob zips}"; out="${2:?output dir}"
output="${GITHUB_OUTPUT:-/dev/null}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
flat="$(mktemp -d)"; bad=""; good=0

while IFS= read -r zip; do
  if python3 -I -c 'import sys, zipfile; sys.exit(1 if zipfile.ZipFile(sys.argv[1]).testzip() else 0)' "$zip" 2>/dev/null; then
    cp "$zip" "$flat/$good-$(basename "$zip")"; good=$((good + 1))
  else
    bad="$bad $(basename "$zip")"
  fi
done < <(find "$blobs" -name '*.zip' | sort)

[ -z "$bad" ] || echo "⚠️ Report: left out a corrupt suite blob (its suite's result is unchanged):${bad}"
if [ "$good" -eq 0 ]; then echo "No readable suite report: none for this run."; exit 0; fi

if (cd "$root/desktop/e2e" && PLAYWRIGHT_HTML_OUTPUT_DIR="$out" PLAYWRIGHT_HTML_OPEN=never npx playwright merge-reports -c report/merge.config.mjs --reporter html "$flat"); then
  echo "made=1" >> "$output"
else
  echo "⚠️ Report: the HTML report could not be merged. The run's verdict is the suites' results only."
fi
exit 0
