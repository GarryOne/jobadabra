#!/usr/bin/env bash
# Open one Codex CLI session per application in Terminal, using Playwright MCP's
# Chrome extension to work in the owner's existing browser profile.
#
# The ChatGPT browser extension is available to desktop-app chats, not Codex CLI.
# Install the separate Playwright Extension in Chrome before using this launcher:
# https://playwright.dev/mcp/configuration/browser-extension
# Approve each extension connection and choose the intended job tab when prompted.
#
# Usage (same shape as apply-batch-claude.sh and apply_batch.py/apply-batch-chatgpt.sh):
#   tools/apply-batch-codex-terminal.sh [--max 5 | -n 5] [--dry-run]
#   tools/apply-batch-codex-terminal.sh https://example.com/job/123 [more URLs]
#   tools/apply-batch-codex-terminal.sh -f jobs.txt

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CODEX_BIN="$(command -v codex || true)"
NPX_BIN="$(command -v npx || true)"
GAP=3
DRY_RUN=false
source_chosen=false
urls=()

usage() {
  echo "Usage: $0 [--max N | -n N | -f jobs.txt | job_url ...] [--dry-run]" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --max|-n)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      [[ "$2" =~ ^[1-9][0-9]*$ ]] || { echo "--max needs a positive integer" >&2; exit 2; }
      max_jobs="$2"
      shift 2
      ;;
    -f)
      [ "$#" -ge 2 ] || { usage; exit 2; }
      source_chosen=true
      while IFS= read -r line || [ -n "$line" ]; do
        [ -n "$line" ] && urls+=("$line")
      done < "$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      usage
      exit 2
      ;;
    *)
      source_chosen=true
      urls+=("$1")
      shift
      ;;
  esac
done

if [ -n "${max_jobs:-}" ] && [ "$source_chosen" = true ]; then
  echo "Use --max or explicit URLs, not both" >&2
  exit 2
fi

if [ "$source_chosen" = false ]; then
  if [ -z "${NOTION_TOKEN:-}" ]; then
    export NOTION_TOKEN="$(security find-generic-password -a "$USER" -s jobadabra.notion.token -w 2>/dev/null || true)"
  fi
  [ -n "${NOTION_TOKEN:-}" ] || { echo "NOTION_TOKEN is required to select jobs" >&2; exit 1; }
  next_urls="$(cd "$REPO_DIR" && python3 -m src.ai.apply_batch --next "${max_jobs:-5}")"
  while IFS= read -r line; do
    [ -n "$line" ] && urls+=("$line")
  done <<< "$next_urls"
fi

if [ "${#urls[@]}" -eq 0 ]; then
  echo "No job with a drafted kit is ready."
  (cd "$REPO_DIR" && python3 -m src doctor --next) >&2 || true
  exit 0
fi

for url in "${urls[@]}"; do
  [[ "$url" == https://* ]] || { echo "Expected an HTTPS job URL: $url" >&2; exit 2; }
done

if [ "$DRY_RUN" = false ]; then
  [ -n "$CODEX_BIN" ] || { echo "codex CLI is not installed" >&2; exit 1; }
  [ -n "$NPX_BIN" ] || { echo "npx is not installed" >&2; exit 1; }
  [ -n "${NOTION_TOKEN:-}" ] || export NOTION_TOKEN="$(security find-generic-password -a "$USER" -s jobadabra.notion.token -w 2>/dev/null || true)"
  [ -n "${NOTION_TOKEN:-}" ] || { echo "NOTION_TOKEN is required to mark queued jobs Applying" >&2; exit 1; }
fi

for url in "${urls[@]}"; do
  if [ "$DRY_RUN" = true ]; then
    printf 'Would open observable Codex run for %s\n' "$url"
    continue
  fi

  # Pass values as osascript arguments, then shell-quote them in AppleScript.
  # This keeps job URLs out of executable AppleScript and shell syntax.
  osascript - "$REPO_DIR" "$CODEX_BIN" "$NPX_BIN" "$url" <<'APPLESCRIPT'
on run argv
  set repoDir to item 1 of argv
  set codexBin to item 2 of argv
  set npxBin to item 3 of argv
  set jobUrl to item 4 of argv
  set shellCommand to "cd " & quoted form of repoDir & " && JOBADABRA_CODEX_BIN=" & quoted form of codexBin & " JOBADABRA_NPX_BIN=" & quoted form of npxBin & " python3 -m src.ai.apply_run " & quoted form of jobUrl
  set wasRunning to application "Terminal" is running
  tell application "Terminal"
    -- A fresh launch opens its own empty window; run in it instead of opening a second one.
    if wasRunning then
      do script shellCommand
    else
      delay 0.5
      do script shellCommand in window 1
    end if
    activate
  end tell
end run
APPLESCRIPT

  # Marks the job Applied in Notion once its confirmation page shows up in Chrome (3 h cap).
  nohup "$REPO_DIR/tools/wait-and-mark-applied.sh" "$url" >/dev/null 2>&1 &
  echo "Queued observable Codex session: $url"
  sleep "$GAP"
done

echo "Review each Terminal session and browser tab, then click Submit yourself. Run python3 -m src.ai.apply_run --status to inspect outcomes."
