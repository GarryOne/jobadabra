#!/usr/bin/env bash
# wait-and-mark-applied.sh <job URL> — wait until that job's application is submitted, then mark
# it Applied in Notion. Started in the background by every apply-batch launcher (ChatGPT, Codex,
# Claude) right after queueing a job.
#
# Polls Chrome's open tab URLs every 20 s for this job's confirmation page (Greenhouse
# ".../<id>/confirmation", Lever ".../<id>/thanks"); only this job's id is matched. Until then it also
# snapshots the questions and answers on this job's form tab (tools/browser-form-snapshot.js, read
# only) into a private file, so the application record holds what was actually submitted. That needs
# Chrome → View → Developer → Allow JavaScript from Apple Events; without it the record falls back to
# the kit's drafted answers. Gives up quietly after 3 hours.
set -uo pipefail

url="${1:?usage: $0 <job URL>}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
id="$(printf '%s' "${url%%\?*}" | sed -E 's#/+$##; s#.*/##')"

# Everything goes to one log: tail -f ~/Library/Logs/JobPilotto/wait-and-mark-applied.log
log_dir="$HOME/Library/Logs/JobPilotto"
mkdir -p "$log_dir"
exec >>"$log_dir/wait-and-mark-applied.log" 2>&1
say() { echo "$(date '+%F %T') [$id] $*"; }
# One watcher per job: a relaunch of the same job doesn't start a second one.
if pgrep -f "wait-and-mark-applied.sh $url\$" | grep -vqx "$$"; then
  say "already watched by another process; exiting"
  exit 0
fi
say "watching for submission of $url"
notify() { "$repo/tools/notify.sh" "$url" "$1"; }

# Latest form snapshot, named by the job code (first 8 hex of sha1(url)) like the apply-run records.
snap_dir="${JOBADABRA_FORM_SNAPSHOT_DIR:-$HOME/Library/Application Support/JobPilotto/form-snapshots}"
mkdir -p "$snap_dir" && chmod 700 "$snap_dir"
snap_file="$snap_dir/$(printf '%s' "$url" | shasum | cut -c1-8).json"
snap_warned=
snapshot() {
  local out
  if out="$(osascript -l JavaScript "$repo/tools/chrome-form-snapshot.js" "$id" \
              "$repo/tools/browser-form-snapshot.js" 2>&1)"; then
    case "$out" in
      *'"fields":[{'*) (umask 077; printf '%s\n' "$out" >"$snap_file.tmp") && mv "$snap_file.tmp" "$snap_file" ;;
    esac
  elif [ -z "$snap_warned" ]; then
    snap_warned=1
    say "form snapshot unavailable (enable Chrome → View → Developer → Allow JavaScript from Apple Events): ${out:0:160}"
  fi
}

# The repo the schedules and Gmail checks run in: the app's private workspace repo. This engine checkout has no
# NOTION_* variables, so dispatching mail.yml here starts a run that can only fail (1 Oct 2026: every submitted
# application queued one, and the app's doctor showed "last mail check failure").
workspace_repo() {
  if [ -n "${JOBADABRA_CLOUD_REPO:-}" ]; then printf '%s' "$JOBADABRA_CLOUD_REPO"; return; fi
  (cd "$repo" && python3 -c 'from src.paths import workspace_repo; print(workspace_repo())' 2>/dev/null) || true
}

for _ in $(seq 540); do
  if [ "$(osascript -e 'application "Google Chrome" is running' 2>/dev/null)" = "true" ] &&
     osascript -e 'tell application "Google Chrome" to get URL of tabs of windows' 2>/dev/null |
       grep -Eq "$id/(confirmation|thanks)"; then
    token="${NOTION_TOKEN:-$(security find-generic-password -a "$USER" -s job-pilotto.notion.token -w 2>/dev/null)}"
    say "confirmation page seen"
    if (cd "$repo" && NOTION_TOKEN="$token" python3 -m src.ai.apply_batch --mark-applied "$url" --source Watcher); then
      notify "Submitted — marked Applied in Notion"
      say "marked applied"
      # Look for the confirmation email in 5 minutes (Gmail + Calendar workflow; no-op if Google isn't connected).
      target="$(workspace_repo)"
      if [ -n "$target" ]; then
        (cd "$repo" && gh workflow run mail.yml -R "$target" -f delay=5 >/dev/null 2>&1) \
          && say "mail check queued in $target" || say "could not queue a mail check in $target"
      else
        say "no workspace repo is set up: not queueing a mail check (the app's own check covers it)"
      fi
      exit 0
    fi
    say "FAILED to mark applied — run: python3 -m src.ai.apply_batch --mark-applied $url"
    notify "Could not mark applied — see ~/Library/Logs/JobPilotto"
    exit 1
  fi
  snapshot
  sleep 20
done
say "gave up after 3 hours without seeing a confirmation page"
exit 1
