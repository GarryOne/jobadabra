#!/usr/bin/env bash
# notify.sh <job URL> <message> — macOS notification about one job, e.g.
#   Jobadabra / grafanalabs job 6103687004 / Form filled — review and Submit
# Clicking it brings the Terminal window of the session that sent it to the front (needs
# `brew install terminal-notifier`; without it, a plain notification). Used by the launchers'
# agents, the Codex runner and wait-and-mark-applied.sh. Off macOS it goes through the app.
url="${1:?usage: $0 <job URL> <message>}"
message="${2:?usage: $0 <job URL> <message>}"
here="$(cd "$(dirname "$0")" && pwd)"
id="$(printf '%s' "${url%%\?*}" | sed -E 's#/+$##; s#.*/##')"
board="$(printf '%s' "$url" | sed -E 's#https?://[^/]+/([^/?]+).*#\1#')"
case "$url" in *amazon.jobs*) board=amazon; id="$(printf '%s' "$url" | sed -E 's#.*/jobs/([0-9]+).*#\1#')" ;; esac
# A session running inside the Jobadabra app (JOB_PILOTTO_SESSION): the app shows it on the session's card and
# notifies you itself when it needs you.
if [ -n "${JOB_PILOTTO_SESSION:-}" ]; then
  curl -s -m 3 -X POST -H 'X-Job-Pilotto: launcher' --data-urlencode "message=$message" \
    "http://127.0.0.1:47111/claude/session?id=$JOB_PILOTTO_SESSION&event=note" >/dev/null 2>&1
  exit 0
fi
# Off macOS (Windows, in Git Bash): the Jobadabra app shows the notification, when it's running.
if ! command -v osascript >/dev/null; then
  curl -s -m 3 -X POST -H 'X-Job-Pilotto: launcher' --data-urlencode "job=$board job $id" \
    --data-urlencode "message=$message" http://127.0.0.1:47111/claude/notify >/dev/null 2>&1
  exit 0
fi

# The Terminal tab this came from: the nearest ancestor process attached to a tty (agents run
# tools in subprocesses without one). Empty for detached processes such as the submit watcher.
tty='' pid=$$
for _ in $(seq 20); do
  t="$(ps -o tty= -p "$pid" 2>/dev/null | tr -d ' ')"
  if [ -n "$t" ] && [ "$t" != "??" ]; then tty="/dev/$t"; break; fi
  pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
  { [ -z "$pid" ] || [ "$pid" -le 1 ]; } && break
done

# Moments that need the owner get a native dialog whose "Show window" button raises the session's
# Terminal tab (terminal-notifier's click action isn't permitted on recent macOS). It runs in the
# background, so the caller never waits, and gives up after 15 minutes.
case "$message" in
  "Form filled"*|"Needs your input"*)
    if [ -n "$tty" ]; then
      nohup osascript - "$message" "$board job $id" "$here/focus-terminal.sh" "$tty" >/dev/null 2>&1 <<'OSA' &
on run argv
  set answer to display dialog ((item 2 of argv) & return & (item 1 of argv)) with title "Jobadabra" buttons {"Later", "Show window"} default button "Show window" with icon note giving up after 900
  if button returned of answer is "Show window" then do shell script quoted form of (item 3 of argv) & " " & quoted form of (item 4 of argv)
end run
OSA
      afplay /System/Library/Sounds/Glass.aiff >/dev/null 2>&1 &
      exit 0
    fi
    ;;
esac

notifier="$(command -v terminal-notifier || true)"
if [ -n "$notifier" ]; then
  args=(-title "Jobadabra" -subtitle "$board job $id" -message "$message" -sound Glass -group "jobpilotto-$id")
  [ -n "$tty" ] && args+=(-execute "'$here/focus-terminal.sh' '$tty'")
  # Fails (exit 3) when macOS hasn't allowed terminal-notifier's notifications: fall back below.
  "$notifier" "${args[@]}" >/dev/null 2>&1 && exit 0
fi
osascript - "$message" "$board job $id" <<'OSA' 2>/dev/null
on run argv
  display notification (item 1 of argv) with title "Jobadabra" subtitle (item 2 of argv) sound name "Glass"
end run
OSA
exit 0
