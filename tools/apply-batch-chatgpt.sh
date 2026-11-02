#!/usr/bin/env bash
# apply-batch-chatgpt.sh — queue every ready application kit into the ChatGPT/Codex desktop app.
# Thin wrapper around `python -m src.ai.apply_batch`; see that module's docstring for the flow.
#
# Usage (same shape as apply-batch-claude.sh and apply-batch-codex-terminal.sh):
#   tools/apply-batch-chatgpt.sh                    # auto-pick up to 5 chats, pasted AND sent
#   tools/apply-batch-chatgpt.sh --max 3            # fewer chats  (or -n 3)
#   tools/apply-batch-chatgpt.sh <job_url> [url...] # explicit job(s), each must already have a kit
#   tools/apply-batch-chatgpt.sh -f jobs.txt        # one job URL per line
#   tools/apply-batch-chatgpt.sh --paste-only       # paste but don't send, review first
#   tools/apply-batch-chatgpt.sh --dry-run          # print the prompts, touch nothing
#
# Requires NOTION_TOKEN (Keychain entry jobadabra.notion.token, or export it) and iTerm's
# Accessibility permission (System Settings -> Privacy & Security -> Accessibility) for
# tools/send-to-chatgpt.sh, which this calls once per ready job.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${NOTION_TOKEN:-}" ]; then
  export NOTION_TOKEN="$(security find-generic-password -a "$USER" -s jobadabra.notion.token -w 2>/dev/null || true)"
fi
python3 -m src.ai.apply_batch "$@"
