#!/usr/bin/env bash
# `bash tools/heavy-lock.sh status`: who holds the heavy lock, who waits (with class and how long), the machine's load and memory, and about how long a new run of each class would wait. Read-only; kills nothing.
# Expected wait = the soonest a holder is likely to finish (its kind's median run, from the `run=` lines of gate-timing.log, default 70 s, minus its running time) plus the median runs of the waiters that would go
# before a new run of that class, spread over the holders. It is a guess to plan with, said as "about". Guarded by tests/test_heavy_lock_status.py.
here="$(cd "$(dirname "$0")" && pwd)"; source "$here/heavy-lock-classes.sh"; source "$here/heavy-lock-reap.sh"
root="${JOB_PILOTTO_HEAVY_DIR:-${TMPDIR:-/tmp}/jobadabra-heavy}"; now=$(date +%s)
timing="${JOB_PILOTTO_HEAVY_TIMING_LOG:-$(git -C "$here" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/gate-timing.log}"
median() { expected_secs "$1"; }   # what -> median run seconds from the log (default 70), shared with the idle watchdog (tools/heavy-lock-reap.sh)
age_of() { local ns="${1%%-*}"; echo $(( now - ns / 1000000000 )); }
holders=0; soonest=""; sum_h=0
echo "heavy lock (${root}):"
for dir in "$root/lock" "$root/lock.2" "$root/lock.3" "$root/lock.4"; do
  [ -d "$dir" ] || continue
  pid="$(cat "$dir/pid" 2>/dev/null)"; [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || continue
  what="$(cat "$dir/what" 2>/dev/null)"; since="$(cat "$dir/since" 2>/dev/null || echo "$now")"; ran=$((now - since)); rem=$(( $(median "$what") - ran )); [ "$rem" -lt 0 ] && rem=0
  note=""; if slot_orphan "$dir"; then note="  ** session gone: the next run frees it **"; else idle="$(idle_secs "$dir")"; [ "$idle" -ge 60 ] && note="  ** holder idle ${idle}s (freed at $(idle_limit "$what")s) **"; fi
  echo "  holds  pid $pid  $what  class $(cat "$dir/class" 2>/dev/null || echo ?)  session $(cat "$dir/session" 2>/dev/null || echo ?)  running ${ran}s  (about ${rem}s left)$note"
  holders=$((holders + 1)); sum_h=$((sum_h + rem)); { [ -z "$soonest" ] || [ "$rem" -lt "$soonest" ]; } && soonest="$rem"
done
[ "$holders" = 0 ] && echo "  free: nobody holds it"
waiters=""; n=0
for name in $(ls "$root/queue" 2>/dev/null | sort); do
  f="$root/queue/$name"; pid="$(head -n 1 "$f" 2>/dev/null | cut -d' ' -f1)"; [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || continue
  what="$(head -n 1 "$f" | cut -d' ' -f2-)"; class="$(lock_class "$what" "$(sed -n 4p "$f")")"; n=$((n + 1)); p="$(prio_of "$what" "$class")"
  echo "  waits  #$n  pid $pid  $what  class $class  session $(sed -n 3p "$f" 2>/dev/null || echo ?)  waited $(age_of "$name")s$([ "$(sed -n 2p "$f")" = loadwait ] && echo '  (waiting for the machine, holds no place)')"
  waiters="$waiters$p $(median "$what")"$'\n'
done
[ "$n" = 0 ] && echo "  nobody waits"
load="$(uptime | sed -E 's/.*load averages?: *//' | awk -F'[ ,]+' '{printf "%.1f", $1}')"
free="$(vm_stat 2>/dev/null | awk '/page size of/ {for (i = 1; i < NF; i++) if ($i == "of") size = $(i + 1)} /^Pages (free|inactive):/ {v = $NF; sub(/\./, "", v); pages += v} END {if (size) printf "%.1f", pages * size / 1073741824}')"
mac="$(source "$(dirname "$0")/heavy-lock-memory.sh" 2>/dev/null && mac_memory)"   # macOS's own pressure level and available memory: what the memory gate admits on
[ -n "$mac" ] && mac=", macOS memory pressure $(echo "${mac%% *}" | awk '{print ($1 == 1 ? "normal" : $1 == 2 ? "warn" : "critical")}'), available ${mac#* } GB"
echo "machine: 1-minute load $load, free+inactive memory ${free:-?} GB$mac"
if [ "$holders" -gt 0 ]; then
  for class in proof pool explore; do
    new="$(prio_of x "$class")"; ahead="$(printf '%s' "$waiters" | awk -v p="$new" '$1 <= p {s += $2} END {print s + 0}')"
    echo "a new $class run would wait about $(( ${soonest:-0} + ahead / holders ))s"
  done
fi
