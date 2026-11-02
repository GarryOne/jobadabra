#!/usr/bin/env bash
# prepare-top.sh [N] — draft application kits for your N best-matching jobs that don't have one yet.
#
# Picks the N highest-scored open jobs from Job Matches (not applied/dismissed, no kit), then starts
# one `prepare` run on GitHub Actions per job — the same path as the 📝 Prepare button, where the
# Claude API key lives. Each kit is ~USD 0.04 (Sonnet 5) and lands on the job's Notion row within a
# minute or two; Telegram gets a copy. Then fill them with tools/apply-batch-<tool>.sh --max N.
#
# Usage: tools/prepare-top.sh 5          # default N = 3
#        tools/prepare-top.sh 5 --dry-run
set -euo pipefail
cd "$(dirname "$0")/.."

n="${1:-3}"
[[ "$n" =~ ^[1-9][0-9]*$ ]] || { echo "Usage: $0 [N] [--dry-run]" >&2; exit 2; }
if [ -z "${NOTION_TOKEN:-}" ]; then
  NOTION_TOKEN="$(security find-generic-password -a "$USER" -s jobadabra.notion.token -w 2>/dev/null || true)"
  export NOTION_TOKEN
fi

urls=()
while IFS= read -r line; do [ -n "$line" ] && urls+=("$line"); done \
  < <(python3 -m src.ai.apply_batch --top-unprepared "$n")
if [ "${#urls[@]}" -eq 0 ]; then
  echo "No open, scored job is missing a kit."
  python3 -m src doctor --next || true
  exit 0
fi

cents=$(( ${#urls[@]} * 4 ))
printf 'Preparing %d kit(s), ~USD %d.%02d:\n' "${#urls[@]}" $((cents / 100)) $((cents % 100))
for url in "${urls[@]}"; do
  echo "  $url"
  [ "${2:-}" = "--dry-run" ] && continue
  gh workflow run daily.yml -R GarryOne/jobadabra -f mode=prepare -f job="$url"
  sleep 2
done
[ "${2:-}" = "--dry-run" ] || echo "Started. Kits appear on the Notion rows in 1–2 min; then: tools/apply-batch-claude.sh --max ${#urls[@]}"
