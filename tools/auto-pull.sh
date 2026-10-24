#!/usr/bin/env bash
# Keeps the owner's checkout (~/jobadabra) on origin/main by itself (owner, 14 Oct 2026: a hand `git pull` found the checkout a day behind).
# A macOS launch agent runs it every 2 minutes. It only fast-forwards a clean `main`: a modified tracked file, another branch, a detached HEAD or a
# diverged history is skipped (never a stash, reset or overwrite) and said after 10 minutes, hourly. A detached HEAD already on origin/main with no edited tracked file heals itself. After an update it says whether the app needs a
# restart (main process, lib, preload, engine, extension) or only ⌘R (window). When the update touches what desktop/scripts/stage.mjs copies into
# desktop/shared/ (worker/src, the recipe/alias schemas, the ladder files), it re-copies them (--files-only: overwrite, never delete or swap) so a
# running app that lazily imports a new lib file never hits a missing shared file (17 Oct 2026: ERR_MODULE_NOT_FOUND writing-rules.js). Guard: tests/test_auto_pull.py.
#   tools/auto-pull.sh               one check (what the launch agent runs)
#   tools/auto-pull.sh --install     write and load the launch agent (~/Library/LaunchAgents/com.jobpilotto.autopull.plist)
#   tools/auto-pull.sh --uninstall   unload and remove it
set -u
# The checkout moved to ~/jobadabra (rebrand, 24 Oct 2026); ~/job-pilotto stays as a symlink for a while.
REPO="${JP_AUTOPULL_REPO:-$([ -d "$HOME/jobadabra/.git" ] && echo "$HOME/jobadabra" || echo "$HOME/job-pilotto")}"
LOG="${JP_AUTOPULL_LOG:-$HOME/Library/Logs/job-pilotto-autopull.log}"
STATE="${JP_AUTOPULL_STATE:-$HOME/Library/Logs/job-pilotto-autopull.state}"
LABEL=com.jobpilotto.autopull
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

log() { mkdir -p "$(dirname "$LOG")"; echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
notify() {   # JP_AUTOPULL_NOTIFY_FILE: tests read the notices from a file instead of macOS notifications
  if [ -n "${JP_AUTOPULL_NOTIFY_FILE:-}" ]; then echo "$1" >> "$JP_AUTOPULL_NOTIFY_FILE"; return; fi
  msg="$(printf '%s' "$1" | tr -d '"\\')"
  command -v osascript >/dev/null 2>&1 && osascript -e "display notification \"$msg\" with title \"Jobadabra checkout\"" >/dev/null 2>&1 || true
}
# A skip is never silent (17 Oct 2026: a detached HEAD sat 80 minutes with only a log line and the owner's app missed 39 commits). The first skip
# of a streak is timed in "$STATE.since"; once it lasts 10 minutes ONE notice goes out ("isn't updating: <reason>, N commits behind. Fix: <command>"),
# then at most one per hour while it lasts. A successful check (or being up to date) ends the streak.
now_s() { echo "${JP_AUTOPULL_NOW:-$(date +%s)}"; }
clear_state() { rm -f "$STATE" "$STATE.since" "$STATE.notified"; }
skip() {   # skip <reason> [fix command]
  now="$(now_s)"
  log "skip: $1"
  mkdir -p "$(dirname "$STATE")"; echo "$1" > "$STATE"
  [ -f "$STATE.since" ] || echo "$now" > "$STATE.since"
  since="$(cat "$STATE.since" 2>/dev/null)"; last="$(cat "$STATE.notified" 2>/dev/null)"
  if [ $((now - ${since:-$now})) -ge 600 ] && [ $((now - ${last:-0})) -ge 3600 ]; then
    behind="$(git -C "$REPO" rev-list --count HEAD..origin/main 2>/dev/null || echo '?')"
    notify "Jobadabra isn't updating: $1, $behind commits behind. Fix: ${2:-see $LOG}"
    echo "$now" > "$STATE.notified"
  fi
  exit 0
}

case "${1:-}" in
  --install)
    script="$(cd "$(dirname "$0")" && pwd)/auto-pull.sh"
    mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$script</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "auto-pull: installed ($PLIST, every 2 min, log $LOG)"
    exit $? ;;
  --uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    rm -f "$PLIST" && echo "auto-pull: removed"
    exit 0 ;;
esac

cd "$REPO" 2>/dev/null || skip "no checkout at $REPO" "clone GarryOne/jobadabra to $REPO"
gd="$(git rev-parse --git-dir 2>/dev/null)"
for m in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD; do   # work in flight: never touch, always say
  [ -e "$gd/$m" ] && skip "a $m is in progress" "finish or abort it in $REPO (git rebase --abort / git merge --abort)"
done
if branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)"; then
  [ "$branch" = main ] || skip "on branch $branch, not main" "git -C $REPO switch main (commit or move your work first)"
  git fetch --quiet origin main 2>>"$LOG" || skip "fetch failed (offline?)" "check the network, then wait 2 minutes"
else
  # Detached HEAD: heals itself only when nothing would be lost (the commit is already on origin/main, no tracked file is edited).
  git fetch --quiet origin main 2>>"$LOG" || skip "detached HEAD, fetch failed (offline?)" "git -C $REPO switch main"
  at="$(git rev-parse --short HEAD)"
  git merge-base --is-ancestor HEAD origin/main || skip "detached HEAD at $at has commits origin/main lacks" "git -C $REPO branch rescue-$at && git -C $REPO switch main"
  dirty="$(git status --porcelain --untracked-files=no | head -3 | cut -c4- | tr '\n' ' ')"
  [ -z "$dirty" ] || skip "detached HEAD at $at with modified tracked files: ${dirty% }" "git -C $REPO status, then commit or discard, then git switch main"
  git show-ref --verify --quiet refs/heads/main || skip "detached HEAD at $at and no local main branch" "git -C $REPO switch -c main origin/main"
  git switch --quiet main 2>>"$LOG" || skip "detached HEAD at $at, switch to main refused (see $LOG)" "git -C $REPO switch main"
  log "healed: detached HEAD at $at, back on main"
  notify "Back on main (was detached at $at)"
fi
old="$(git rev-parse HEAD)" new="$(git rev-parse origin/main)"
[ "$old" = "$new" ] && { clear_state; exit 0; }
git merge-base --is-ancestor HEAD origin/main || skip "local main has commits origin/main lacks (not a fast-forward)" "git -C $REPO log origin/main..main, then rebase or move them to a branch"
dirty="$(git status --porcelain --untracked-files=no | head -3 | cut -c4- | tr '\n' ' ')"
[ -z "$dirty" ] || skip "modified tracked files: ${dirty% }" "git -C $REPO status, then commit them in a worktree branch or discard"
git merge --ff-only --quiet origin/main 2>>"$LOG" || skip "fast-forward refused (see $LOG)" "read $LOG"
clear_state
changed="$(git diff --name-only "$old" "$new")"
if echo "$changed" | grep -q -E '^(worker/src/|extension/(recipe-schema\.js|alias-schema\.js|ladder/)|desktop/scripts/stage\.mjs)'; then
  command -v node >/dev/null 2>&1 && node desktop/scripts/stage.mjs --files-only >>"$LOG" 2>&1 \
    && log "restaged desktop/shared" || { log "restage of desktop/shared failed"; notify "Updated, but desktop/shared could not be re-copied: run npm start once"; }
fi
if echo "$changed" | grep -q -E '^(desktop/main\.js|desktop/lib/|desktop/preload\.cjs|desktop/shared/|src/|worker/src/|extension/)'; then
  what='restart the app'
elif echo "$changed" | grep -q '^desktop/renderer/'; then
  what='press ⌘R in the window'
else
  what='nothing to restart'
fi
log "updated ${old:0:7} -> ${new:0:7} ($(echo "$changed" | wc -l | tr -d ' ') files): $what"
notify "Updated to ${new:0:7}: $what"
