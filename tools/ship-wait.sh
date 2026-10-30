#!/bin/sh
# Waits for the next event line of a tools/ship.sh run (MERGED, RED, COMMENT, ...) and prints it, for a session's background wait.
# Why (30 Oct 2026, owner: "we don't have anymore the watches/monitors for when a PR merges"): a session's Monitor ends after 30 minutes at most, so a merge
# made hours later reached no session (#2486); a background command outlives that (measured 30 Oct 2026: 31 minutes and still running). It reads only the
# local log, never GitHub: the PR's own watcher (tools/ship-watch.sh) already writes every event there.
# usage: tools/ship-wait.sh <log>   run it with run_in_background; it exits 0 printing the new event lines, then run it again until MERGED, CLOSED, DONE
#        or FAILED. It starts after the cursor <log>.seen (tools/ship.sh --background sets it, so a reused log's older runs are skipped) and moves it on.
#        Exit 3 after SHIP_WAIT_CAP seconds with nothing new (default 48 h, the watcher's own cap). Guard: tests/test_ship_wait.py, tests/test_ship_background.py.
set -eu
log=${1:?usage: tools/ship-wait.sh <ship log>}
cursor="$log.seen"; poll=${SHIP_WAIT_POLL:-5}; cap=${SHIP_WAIT_CAP:-172800}; waited=0
events='^ship: (DONE|FAILED|REVIEW|MERGED|CLOSED|RED|GREEN|READY|CONFLICT|COMMENT)'
seen=$(cat "$cursor" 2>/dev/null || echo 0)
case "$seen" in ''|*[!0-9]*) seen=0 ;; esac
while :; do
  total=$(wc -l < "$log" 2>/dev/null || echo 0); total=$((total + 0))   # whole lines only: a line still being written waits for its newline
  [ "$total" -ge "$seen" ] || seen=0   # the log was replaced: read it from the top
  if [ "$total" -gt "$seen" ]; then
    new=$(sed -n "$((seen + 1)),${total}p" "$log" | grep -E "$events" || true)
    # Why (#2618, 30 Oct 2026): a wait may be re-armed after a push; old-head REDs in its unread log must not wake the session.
    if [ -s "$log.head" ]; then
      read -r number head < "$log.head" || true
      new=$(printf '%s\n' "$new" | awk -v n="#$number" -v head="$head" '$2 != "RED" || $3 != n || $NF == head')
    fi
    seen=$total; echo "$seen" > "$cursor"
    if [ -n "$new" ]; then printf '%s\n' "$new"; exit 0; fi
  fi
  if [ "$waited" -ge "$cap" ]; then echo "ship-wait: nothing new in $log after ${cap}s"; exit 3; fi
  sleep "$poll"; waited=$((waited + poll))
done
