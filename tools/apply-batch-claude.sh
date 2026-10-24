#!/usr/bin/env bash
# apply-batch-claude.sh — open one new Terminal window per job, each running its own
# interactive Claude Code session in the job-pilotto repo, pre-seeded with an apply-to-job prompt.
#
# Unlike send-to-chatgpt.sh (which has to paste into a single shared desktop-app window because
# there's no CLI/API access to it), Claude Code has a real CLI — so this spawns genuinely separate
# `claude` processes, one per job, each in its own window, running in parallel. Each session still
# stops before Submit and needs the owner to review + approve tool calls as usual; this only saves
# the "open a session, cd, type the prompt" busywork of doing that by hand for several jobs.
#
# Usage (same shape as apply-batch-chatgpt.sh and apply-batch-codex-terminal.sh):
#   tools/apply-batch-claude.sh <job_url> [job_url ...]
#   tools/apply-batch-claude.sh -f jobs.txt          # one job URL per line
#   tools/apply-batch-claude.sh --max 3   (or -n 3)  # auto-pick the N highest-scored jobs that
#                                                     # have a kit (Kit ready, or Saved with a kit) but aren't started —
#                                                     # via `python -m src.ai.apply_batch --next N`
# No --dry-run here (a spawned Claude Code session has no such mode) — use it on
# apply-batch-chatgpt.sh or apply-batch-codex-terminal.sh instead to preview a job list.
#
# Requires: the `jobpilot` alias's target repo checked out at ~/jobadabra, Terminal.app, and
#           Accessibility permission for whichever app runs this script (System Settings ->
#           Privacy & Security -> Accessibility) so System Events can open Terminal windows.
#
# The Desktop App's "Apply with Claude" button runs this with one URL, and its "Apply to jobs…" dialog
# with --max N. Sessions start with --chrome, so Claude in Chrome is on even when it isn't the
# default: the job board's page often only links to the employer's own site, which has its own
# Apply button, a sign-in or sign-up page and several form pages ("Reaching the form" in the skill).
#
# Each session runs with `--permission-mode bypassPermissions` — no tool-approval prompts at all,
# not just for Read/browser calls, so it can actually run unattended in a spawned window instead
# of stalling on the first CV read or click. That's a real widening of blast radius (any tool call
# in that session executes without review), acceptable here only because: the task is narrow
# (get to one form and fill it from an already-drafted kit; an employer account it creates gets a
# generated password that goes straight to the Keychain), the skill's own hard rule keeps it from ever
# clicking Submit regardless of tool permissions, and you're still watching the window it opens.
# Don't reuse this pattern for a less scoped prompt.

set -euo pipefail

REPO_DIR="$([ -d "$HOME/jobadabra/.git" ] && echo "$HOME/jobadabra" || echo "$HOME/job-pilotto")"   # moved to ~/jobadabra on 24 Oct 2026
TERMINAL_APP="Terminal"   # switch to "iTerm" if that's what's installed/preferred
GAP=3                     # seconds between spawning windows, so they don't all hit Chrome/Notion at once simultaneously

# Same Keychain fallback as apply-batch-chatgpt.sh: --next and --mark-applying below both need
# NOTION_TOKEN, and this script is usually launched fresh (not already carrying it in the shell).
if [ -z "${NOTION_TOKEN:-}" ]; then
  export NOTION_TOKEN="$(security find-generic-password -a "$USER" -s job-pilotto.notion.token -w 2>/dev/null || true)"
fi

urls=()
case "${1:-}" in
  -f)
    while IFS= read -r line; do
      [ -n "$line" ] && urls+=("$line")
    done < "$2"
    ;;
  --max|-n)
    n="$2"
    while IFS= read -r line; do
      [ -n "$line" ] && urls+=("$line")
    done < <(cd "$REPO_DIR" && python3 -m src.ai.apply_batch --next "$n")
    if [ "${#urls[@]}" -eq 0 ]; then
      echo "No job has an application kit yet. Draft kits for your best matches first:" >&2
      echo "  tools/prepare-top.sh $n      (or tap 📝 Prepare on a job in Telegram)" >&2
      # If something earlier in the chain is missing (no crawl, no scored jobs), say that instead.
      (cd "$REPO_DIR" && python3 -m src doctor --next) >&2 || true
      exit 0
    fi
    ;;
  *)
    for a in "$@"; do urls+=("$a"); done
    ;;
esac

# A session needs the job's kit (its answers and cover letter): jobs without one are skipped here,
# before any Terminal opens or any Stage changes. --max already picks only jobs with a kit.
kept=()
for url in ${urls[@]+"${urls[@]}"}; do
  if (cd "$REPO_DIR" && python3 -m src.ai.apply_batch --has-kit "$url"); then kept+=("$url"); fi
done
urls=(${kept[@]+"${kept[@]}"})
if [ "${#urls[@]}" -eq 0 ] && [ "$#" -gt 0 ]; then
  echo "Nothing to apply to: prepare a kit first (📝 Prepare in the app or Telegram)." >&2
  exit 1
fi

if [ "${#urls[@]}" -eq 0 ]; then
  echo "Usage: $0 <job_url> [job_url ...]   or   $0 -f jobs.txt   or   $0 --max N" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
# Clean up the prompt files a bit later, well after every spawned Terminal has had time to read
# its own file — not immediately, since `do script` returns before the new shell actually runs.
( sleep 60 && rm -rf "$TMP_DIR" ) >/dev/null 2>&1 &
disown

# Started by the Mac app (it passes its settings in the environment): the Terminal session must use the app's
# Notion workspace and folder, not ~/jobadabra/.env. They go to each window through a private file (umask 077)
# that the new shell reads and deletes at once; the folder is removed after a minute anyway.
write_session_env() {
  [ -n "${JOB_PILOTTO_CONFIG_DIR:-}" ] || return 0
  (umask 077; python3 - "$1" <<'PY'
import os, re, shlex, sys
keep = re.compile(r'^(NOTION_[A-Z0-9_]+|JOB_PILOTTO_[A-Z0-9_]+|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)$')
with open(sys.argv[1], 'w') as out:
    for key, value in sorted(os.environ.items()):
        if keep.match(key):
            out.write(f'export {key}={shlex.quote(value)}\n')
PY
  )
}

i=0
for url in "${urls[@]}"; do
  i=$((i + 1))
  prompt_file="$TMP_DIR/prompt_$i.txt"
  env_file="$TMP_DIR/session_$i.env"
  write_session_env "$env_file"
  load_env=""
  [ -f "$env_file" ] && load_env=". '$env_file' && rm -f '$env_file' && "
  # A ticket from the Jobadabra app (when it's running) lets this session hand the form to the Chrome
  # extension for its fast fill first (extension/hook.js); without one the session fills everything itself.
  ticket="$(curl -s -m 3 -X POST -H 'X-Job-Pilotto: launcher' -H 'Content-Type: application/json' \
    --data "$(python3 -c 'import json,sys; print(json.dumps({"job": sys.argv[1]}))' "$url")" \
    http://127.0.0.1:47111/claude/ticket 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("ticket",""))' 2>/dev/null || true)"
  handoff=""
  if [ -n "$ticket" ]; then
    handoff="Extension first: on each form page, if <html> has data-jobpilotto-hook, hand the form to the Jobadabra extension before filling anything yourself: evaluate document.dispatchEvent(new CustomEvent('jobpilotto:fill',{detail:JSON.stringify({job:'$url',ticket:'$ticket'})})), then read document.documentElement.dataset.jobpilottoFill every 3 s (in one JS call that waits, up to 90 s) until its state is done or error; if it's still missing after 5 s, or there's no data-jobpilotto-hook, carry on without it. When it's done, run the audit and fill ONLY what it left (its todo list), then verify as usual. Never send the event twice on the same page. "
  fi
  cat > "$prompt_file" <<PROMPT
Use the apply-to-job skill to apply to this job: $url. Don't ask me questions or discuss the skill file — just follow it: pull the drafted kit from Notion Applications for this job URL, open the posting in Chrome (claude-in-chrome) and get to the actual form as the skill's "Reaching the form" section says: when the page is a job board's or only links out, follow its Apply / Apply now buttons to the employer's site, and create an account or sign in there if it asks (password generated into the Keychain and pasted from the clipboard, never typed or shown). A confirmation email's code or link you read yourself with python3 -m src.sources.google verify --from <employer domain> (Gmail, read-only). Whenever a CAPTCHA or a terms checkbox blocks you, run tools/notify.sh $url "Needs your input — see Terminal", tell me in one line what to do in Chrome, wait for my reply, then carry on. ${handoff}Fill it per the skill's rules (fast-path dropdowns via JS, leave genuine guesses/legal checkboxes empty), verify, and hand it over for me to review and Submit. If the --context call below finds no kit for this job, stop right there: open nothing, run tools/notify.sh $url "No kit yet — press Prepare first", say so in one line and finish. Get everything in ONE call first — the kit, Profile, Application Answers and earlier runs' learnings for this job board: NOTION_TOKEN="\${NOTION_TOKEN:-\$(security find-generic-password -a "\$USER" -s job-pilotto.notion.token -w)}" python3 -m src.ai.apply_run --context $url (don't fetch those pages separately). For every dropdown, open it and pick with window.__jobPilottoClickOption('<exact option text>') — never type + Return, which picks partial matches ("Male" -> "Female"). While filling, stamp phases inside JS calls you already make with window.__jobPilottoStep('<name>') (e.g. 'dropdowns', 'resume'). Right before you fill the first field, run: tools/notify.sh $url "Filling started" and note the time from date -u +%FT%TZ. At hand-over, record the run instead of notifying yourself: in the form tab evaluate JSON.stringify({page_url: location.href, guard_active: !!window.__jobPilottoGuardActive, fields: window.__jobPilottoAuditVisibleFields(), steps: window.__jobPilottoSteps || []}), write that JSON to /tmp/jobpilotto-audit.json, then run: NOTION_TOKEN="\${NOTION_TOKEN:-\$(security find-generic-password -a "\$USER" -s job-pilotto.notion.token -w)}" python3 -m src.ai.apply_run --record $url --audit /tmp/jobpilotto-audit.json --started <that time> --learning "<one line on what you learned about this form, or empty if nothing new>" — it saves the run record, updates the Notion row and sends my "Form filled" or "Needs your input" notification. If the posting is gone ("Job not found", 404, or not on the company's board), don't stop to ask: run NOTION_TOKEN="\${NOTION_TOKEN:-\$(security find-generic-password -a "\$USER" -s job-pilotto.notion.token -w)}" python3 -m src.ai.apply_batch --mark-closed $url (marks it Closed and notifies me), close the tab, and finish. If you stop on any other blocker before filling, just run tools/notify.sh $url "Needs your input — see Terminal". A background watcher (tools/wait-and-mark-applied.sh) already marks the job applied in Notion when I submit, so you don't need to watch the tab. Start now.
PROMPT

  # Flip Stage to Applying right away, same dedup the ChatGPT/Codex path already does for its own
  # queued chats — so a second run (or --max picking by score again) never queues this job twice.
  (cd "$REPO_DIR" && python3 -m src.ai.apply_batch --mark-applying "$url") || \
    echo "Warning: could not mark $url as Applying (queuing it anyway)" >&2

  osascript <<OSA
set wasRunning to application "$TERMINAL_APP" is running
tell application "$TERMINAL_APP"
  set cmd to "cd '$REPO_DIR' && ${load_env}claude --chrome --permission-mode bypassPermissions \"\$(cat '$prompt_file')\""
  -- A fresh launch opens its own empty window; run in it instead of opening a second one.
  if wasRunning then
    do script cmd
  else
    delay 0.5
    do script cmd in window 1
  end if
  activate
end tell
OSA

  # Marks the job Applied in Notion once its confirmation page shows up in Chrome (3 h cap).
  nohup "$REPO_DIR/tools/wait-and-mark-applied.sh" "$url" >/dev/null 2>&1 &
  echo "Queued session $i/${#urls[@]}: $url"
  sleep "$GAP"
done

echo
echo "Queued ${#urls[@]} Claude Code session(s), one per Terminal window, running in parallel."
echo "Each stops before Submit — review and approve tool calls per window as usual, then Submit yourself."
