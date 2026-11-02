#!/usr/bin/env bash
# Heavy runs on this Mac: browser suites, recorded replays, real-extension and the e2e harness take this lock; unit tests never do.
#   bash tools/heavy-lock.sh <what> <command...>      waits for a slot (says who holds them), waits while the load is high, runs, frees it, keeps the exit code
# ONE copy for every session (owner, 11 Oct 2026): a worktree's copy hands off to the primary checkout's (<git common dir>/..), so all queue in one order.
# Slots = directories <TMPDIR>/jobadabra-heavy/lock and lock.2 holding pid, what, since, cwd; stale when the pid is gone (taken over by an atomic rename).
# The first heavy run always starts; more start beside it only while the memory gate has room (tools/heavy-lock-memory.sh: macOS pressure, available memory, swap-outs). Ports are free per run and the real Notion page has its own lock (desktop/e2e/lib/notion-page-lock.mjs).
# First come, first served (11 Oct 2026: the pool's per-site runs re-took a just-freed lock while a replay starved 6+ min): each waiter holds a ticket
# <root>/queue/<nanoseconds>-<pid> ("<pid> <what>") and takes a slot only when no live older ticket is ahead; a dead waiter's ticket is dropped.
# Shortest first (owner, 11 Oct 2026: a ~15 s row replay waited 1-3 min behind ~70 s live runs): a waiter whose `what` is `row` or `row-*` goes ahead of older
# longer waiters, and a longer waiter yields to a younger row waiter, each only while it has waited under JOBADABRA_HEAVY_SHORT_AGE seconds (default 120),
# so nobody starves. Replays (row*, recorded-replay) wait for the memory gate, never for the load. A ticket names its session (JOBADABRA_SESSION, else the
# branch of the working folder) and the log lines say it. JOBADABRA_HEAVY_SHORT_FIRST=0 = strict arrival order; JOBADABRA_HEAVY_REPLAY_LOAD=1 = replays wait for the load too.
#   bash tools/heavy-lock.sh status     who holds it, who waits (class, how long), load, memory, about how long a new run would wait (tools/heavy-lock-status.sh)
# Every wait is logged to <git common dir>/gate-timing.log (JOBADABRA_HEAVY_TIMING_LOG elsewhere, GATE_TIMING=0 off).
# A nested call (a suite started by `npm run all`) sees JP_HEAVY_HELD and runs at once. Escape hatches, all said in the log when used:
#   JOBADABRA_HEAVY=0                 no lock, no load wait
#   JOBADABRA_HEAVY_WAIT=<s>          longest wait for a slot before running anyway (default 1800)
#   JOBADABRA_HEAVY_SLOTS=<n>         1 = one heavy run at a time; default 4 (each beyond the 1st behind the memory gate)
#   JOBADABRA_HEAVY_MEM_RULE=floor    the old memory gate (free+inactive over 7 GB live / 3 GB replay, swap used under 50% / 70%); the other knobs are in tools/heavy-lock-memory.sh
#   JOBADABRA_HEAVY_SHARED=<path>     the shared copy to run (default the primary checkout's); this script never hands off to itself
#   JOBADABRA_HEAVY_LOAD=<n>          1-minute load average above which a run waits (default 1.5 x cores); 0 = never wait for load
#   JOBADABRA_HEAVY_POLL=<s>          seconds between looks at the queue and the load (default 1; the tests use 0.1)
#   JOBADABRA_HEAVY_LOAD_WAIT=<s>     longest wait for the load to drop before running anyway (default 300)
# Owner: landing-speed (11 Oct 2026, spec faster-fixes §6). Guarded by tests/test_heavy_lock.py.
[ "${1:-}" = status ] && exec bash "$(dirname "$0")/heavy-lock-status.sh"   # read-only readout of holders, waiters, load and expected waits
# `yield`, called by a run that holds the lock between two parts of its work (the pool, between sites): when a waiter of a higher class or a shorter run is queued, it gives its place up and
# waits for it back in the queue (class and age as a new waiter); otherwise it returns at once. No-op outside a hold or with JOBADABRA_HEAVY=0. desktop/e2e/lib/heavy.mjs yieldHeavy() calls it.
yield_mode=0
if [ "${1:-}" = yield ]; then yield_mode=1; { [ -n "${JP_HEAVY_HELD:-}" ] && [ "${JOBADABRA_HEAVY:-1}" != 0 ]; } || exit 0; set -- yield true; fi
what="${1:-heavy run}"; shift || true
[ "$#" -gt 0 ] || { echo "usage: heavy-lock.sh <what> <command...>" >&2; exit 2; }
if [ "$yield_mode" = 0 ] && { [ "${JOBADABRA_HEAVY:-1}" = 0 ] || [ -n "${JP_HEAVY_HELD:-}" ]; }; then exec "$@"; fi

shared="${JOBADABRA_HEAVY_SHARED:-}"
if [ -z "$shared" ]; then common="$(git -C "$(dirname "$0")" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; [ -n "$common" ] && shared="$(dirname "$common")/tools/heavy-lock.sh"; fi
real() { echo "$(cd "$(dirname "$1")" 2>/dev/null && pwd -P)/$(basename "$1")"; }
if [ -n "$shared" ] && [ -f "$shared" ] && [ "$(real "$shared")" != "$(real "$0")" ]; then JOBADABRA_HEAVY_SHARED="$shared" exec bash "$shared" "$what" "$@"; fi

root="${JOBADABRA_HEAVY_DIR:-${TMPDIR:-/tmp}/jobadabra-heavy}"; lock=""
mkdir -p "$root"
say() { echo "heavy-lock: $*" >&2; }
# Every hold is logged with the branch and session it belongs to and the load at queueing and at start, so a fix's proof waits can be summed (tools/landing-report.mjs).
timing_log() {  # <text after the time stamp>
  [ "${GATE_TIMING:-1}" != 0 ] || return 0
  local timing="${JOBADABRA_HEAVY_TIMING_LOG:-$(git -C "$(dirname "$0")" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/gate-timing.log}"
  [ "$timing" = /gate-timing.log ] || echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) $1" >>"$timing" 2>/dev/null || true
}
[ -f "$(dirname "$0")/heavy-lock-reap.sh" ] && source "$(dirname "$0")/heavy-lock-reap.sh" || { forced_reason() { return 1; }; reap_dead() { return 0; }; reap_slot() { return 0; }; kill_group() { return 0; }; find_session_pid() { :; }; }
max_slots="${JOBADABRA_HEAVY_SLOTS:-4}"; [ "$max_slots" -ge 1 ] 2>/dev/null || max_slots=1
SLOT_DIRS="$root/lock"; for _i in $(seq 2 "$max_slots"); do SLOT_DIRS="$SLOT_DIRS $root/lock.$_i"; done
holders() { local dir pid what since out=""
  for dir in $SLOT_DIRS; do [ -d "$dir" ] || continue; pid="$(cat "$dir/pid" 2>/dev/null)"; what="$(cat "$dir/what" 2>/dev/null)"; since="$(cat "$dir/since" 2>/dev/null)"
    out="${out:+$out and }pid ${pid:-?} (${what:-?}, session $(cat "$dir/session" 2>/dev/null || echo ?)) since $(date -r "${since:-0}" +%T 2>/dev/null || echo ?), $(( $(date +%s) - ${since:-$(date +%s)} ))s ago"; done
  echo "${out:-nobody}"; }
stale() {  # a slot's owner is gone (or never wrote its pid within 10 s)
  local pid; pid="$(cat "$1/pid" 2>/dev/null)"
  if [ -z "$pid" ]; then [ $(( $(date +%s) - $(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || date +%s) )) -gt 10 ]; return; fi
  ! kill -0 "$pid" 2>/dev/null
}
held() {  # live slots, after dropping stale ones
  local dir count=0 gone forced
  for dir in $SLOT_DIRS; do
    [ -d "$dir" ] || continue
    if stale "$dir"; then gone="$root/stale.$$"; mv "$dir" "$gone" 2>/dev/null && { say "taking over a stale lock: $(cat "$gone/what" 2>/dev/null) (pid $(cat "$gone/pid" 2>/dev/null) is gone)"; reap_dead "$gone"; rm -rf "$gone"; }; continue; fi
    if forced="$(forced_reason "$dir")"; then gone="$root/stale.$$"; mv "$dir" "$gone" 2>/dev/null && { reap_slot "$gone" "$forced"; rm -rf "$gone"; }; continue; fi   # a live wrapper whose session is gone or whose tree sits idle
    count=$((count + 1))
  done
  echo "$count"
}
# Admission by memory budget (owner, 11 Oct 2026; the old fixed 2 slots): up to JOBADABRA_HEAVY_SLOTS (default 4) runs at once, each admitted only while the memory gate says one more fits:
# macOS's pressure normal, its available memory less what runs just started declared over this run's cost plus a margin, and no swapping out (tools/heavy-lock-memory.sh;
# JOBADABRA_HEAVY_MEM_RULE=floor = the free+inactive 7 GB / 3 GB floors of before).
[ -f "$(dirname "$0")/heavy-lock-memory.sh" ] && source "$(dirname "$0")/heavy-lock-memory.sh" || { my_cost() { echo 2.9; }; memory_ok() { why="no memory gate (tools/heavy-lock-memory.sh missing)"; return 1; }; }
# A timing run (what has "latency" or "timing" in it, or JOBADABRA_HEAVY_EXCLUSIVE=1) is exclusive: it starts only on an empty lock and nobody starts beside it.
is_exclusive() { case "$what" in *latency*|*timing*) return 0 ;; esac; [ "${JOBADABRA_HEAVY_EXCLUSIVE:-0}" = 1 ]; }
exclusive_held() { local dir; for dir in $SLOT_DIRS; do [ -f "$dir/exclusive" ] && return 0; done; return 1; }
take() { local dir; for dir in $SLOT_DIRS; do mkdir "$dir" 2>/dev/null && { lock="$dir"; echo $$ >"$dir/pid"; my_cost >"$dir/cost"; date +%s >"$dir/since"; is_exclusive && echo 1 >"$dir/exclusive"; return 0; }; done; return 1; }
# After taking a slot: a timing run must be the only holder and nobody may have started beside it; if two took at the same moment, both give the slot back and try again in their turn.
alone_ok() { if is_exclusive; then [ "$(held)" -le 1 ]; else ! exclusive_held; fi || { rm -rf "$lock"; lock=""; return 1; }; }
release() { [ -n "$lock" ] && [ "$(cat "$lock/pid" 2>/dev/null)" = "$$" ] && rm -rf "$lock"; return 0; }
queue="$root/queue"; mkdir -p "$queue"
age_of() { local ns="${1%%-*}"; echo $(( $(date +%s) - ns / 1000000000 )); }   # seconds a ticket has waited (its name starts with the nanosecond clock)
ticket_label() { echo "$(head -n 1 "$queue/$1" | cut -d' ' -f2-) (pid $2, session $(sed -n 3p "$queue/$1" 2>/dev/null || echo ?))$([ "$(sed -n 5p "$queue/$1" 2>/dev/null)" = exclusive ] && echo ' [exclusive]')"; }
branch_now="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ?)"
[ -f "$(dirname "$0")/session-name.sh" ] && source "$(dirname "$0")/session-name.sh" && session="$(session_name)" || session="${JOBADABRA_SESSION:-?}"
[ "$session" = ? ] && session="$branch_now"   # no session name found: the branch still says whose run it is
[ -f "$(dirname "$0")/heavy-lock-classes.sh" ] && source "$(dirname "$0")/heavy-lock-classes.sh" || { is_short() { return 1; }; is_replay() { return 1; }; lock_class() { echo other; }; prio_of() { echo 3; }; ticket_prio() { echo 3; }; can_overtake() { return 1; }; }
klass="$(lock_class "$what" "${JOBADABRA_HEAVY_CLASS:-}")"; my_prio="$(prio_of "$what" "$klass")"
if [ "$yield_mode" = 1 ]; then
  slot=""; for dir in $SLOT_DIRS; do [ "$(cat "$dir/pid" 2>/dev/null)" = "$JP_HEAVY_HELD" ] && slot="$dir"; done
  [ -n "$slot" ] || exit 0
  what="$(cat "$slot/what" 2>/dev/null || echo heavy)"; klass="$(lock_class "$what" "$(cat "$slot/class" 2>/dev/null)")"; my_prio="$(prio_of "$what" "$klass")"
  yield_to=""
  for name in $(ls "$queue" 2>/dev/null | sort); do
    pid="$(head -n 1 "$queue/$name" 2>/dev/null | cut -d' ' -f1)"
    [ "$(sed -n 2p "$queue/$name" 2>/dev/null)" = loadwait ] && continue
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || continue
    [ "$(ticket_prio "$queue/$name")" -lt "$my_prio" ] && { yield_to="$(ticket_label "$name" "$pid")"; break; }
  done
  [ -n "$yield_to" ] || exit 0
  say "$what yields its place to $yield_to between two parts of its work, and waits for it back"
  timing_log "heavy lock yield what=$what class=$klass session=$session to=$(echo "$yield_to" | tr ' ' _)"
  rm -rf "$slot"
fi
ticket="$queue/$(python3 -c 'import time; print(time.time_ns())' 2>/dev/null || echo "$(date +%s)000000000")-$$"; printf '%s %s\n\n%s\n%s\n' "$$" "$what" "$session" "$klass" >"$root/.ticket.$$" && mv -f "$root/.ticket.$$" "$ticket"
child=""; run_group=""
trap 'rm -f "$ticket" "$root/.ticket.$$"; [ -n "$child" ] && kill_group "$run_group" "$child"; release' EXIT
trap 'exit 143' TERM; trap 'exit 130' INT; trap 'exit 129' HUP
ahead() {  # the waiter I must let go first, as "<what> (pid N, session S)"; dead waiters are dropped on the way
  local name pid mine=0 mname="${ticket##*/}" theirs
  for name in $(ls "$queue" 2>/dev/null | sort); do
    [ "$name" = "$mname" ] && { mine=1; continue; }
    pid="$(head -n 1 "$queue/$name" 2>/dev/null | cut -d' ' -f1)"
    [ "$(sed -n 2p "$queue/$name" 2>/dev/null)" = loadwait ] && continue   # it waits for the machine, holding no slot: it does not hold anyone up
    if [ -z "$pid" ]; then [ -f "$queue/$name" ] && [ $(( $(date +%s) - $(stat -c %Y "$queue/$name" 2>/dev/null || stat -f %m "$queue/$name" 2>/dev/null || date +%s) )) -gt 10 ] && rm -f "$queue/$name"; continue; fi   # empty: being written, not dead
    if ! kill -0 "$pid" 2>/dev/null; then rm -f "$queue/$name"; continue; fi
    theirs="$(ticket_prio "$queue/$name")"
    if [ "$mine" = 0 ]; then   # older: it goes first, unless I outrank it and it has not waited past the cap
      [ "$(sed -n 5p "$queue/$name" 2>/dev/null)" = exclusive ] || { can_overtake "$my_prio" "$theirs" "$(age_of "$name")" && continue; }   # a waiting timing run is overtaken by nobody
    else                       # younger: I yield to it when it outranks me while I have not waited past the cap
      is_exclusive && continue   # a timing run yields to no one: they would wait for it
      can_overtake "$theirs" "$my_prio" "$(age_of "$mname")" || continue
    fi
    echo "$(age_of "$name")|$(ticket_label "$name" "$pid")"; return 0
  done
}

wait_max="${JOBADABRA_HEAVY_WAIT:-1800}"; poll="${JOBADABRA_HEAVY_POLL:-1}"; began=$(date +%s); told=0
# A busy machine (seven sessions' suites at once: load 40-147 on 11 Oct 2026) makes browser runs time out; wait for it to calm down. The wait is IN THE QUEUE, holding no slot
# (11 Oct 2026: a run took the slot and then sat 12 min in the load wait while two landings queued behind it), and a waiter that waits only for the machine does not hold up
# the ones behind it (its ticket says "loadwait"): whoever is ready first goes, the older first.
cores="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 8)"
limit="${JOBADABRA_HEAVY_LOAD:-$(( cores * 3 / 2 ))}"; load_wait="${JOBADABRA_HEAVY_LOAD_WAIT:-300}"; load_began=""; load_gave_up=0
load1() { uptime | sed -E 's/.*load averages?: *//' | awk -F'[ ,]+' '{ printf "%d", $1 + 0.5 }'; }
load_queue="$(load1)"
# Who loads the Mac (owner, 11 Oct 2026: waits could not be attributed): the 3 programs using the most CPU right now, as "name 120%, ..." (JOBADABRA_HEAVY_TOP=0 leaves it out). Nothing is killed.
top_cpu() {  # $1 = separator between name and percent, $2 = separator between entries
  [ "${JOBADABRA_HEAVY_TOP:-1}" = 0 ] && return 0
  ps -Ao pcpu=,comm= 2>/dev/null | awk '{c = $1; $1 = ""; sub(/^ +/, ""); n = split($0, p, "/"); cpu[p[n]] += c} END {for (k in cpu) printf "%d\t%s\n", cpu[k], k}' | sort -rn | head -3 \
    | awk -F'\t' -v a="$1" -v b="$2" '$1 > 0 {printf "%s%s%s%s%%", sep, $2, a, $1; sep = b}'
}
mark() { printf '%s %s\n%s\n%s\n%s\n%s\n' "$$" "$what" "$1" "$session" "$klass" "$(is_exclusive && echo exclusive)" >"$root/.ticket.$$" && mv -f "$root/.ticket.$$" "$ticket"; }   # written aside and renamed: a reader never sees it half-written (11 Oct 2026, CI red 3x)   # the ticket keeps its name (its place in line); only its second line changes
# What "the machine is busy" is read from (JOBADABRA_HEAVY_SIGNAL, default auto since 11 Oct 2026: load 160-205 held three proofs for minutes at 36-51% CPU and 53% free memory, the
# average counts the runnable threads of many short-lived test processes). auto = cpu and memory together (busy when either is); load = the 1-minute load average; or one of: the CPU in use (sum of the processes' CPU over the cores; busy above
# JOBADABRA_HEAVY_CPU_BUSY percent, default 90) or the free memory percentage of `memory_pressure` (busy below JOBADABRA_HEAVY_MEM_FREE_PCT percent, default 15). All three are logged on every
# hold (cpu_busy=, mem_free=) so the signal that predicts slow or failed runs can be chosen from data (11 Oct 2026: no failure-versus-load data existed before the new log).
cpu_busy() { ps -Ao pcpu= 2>/dev/null | awk -v n="$cores" '{s += $1} END {printf "%d", s / (n > 0 ? n : 1)}'; }
mem_free_pct() { memory_pressure -Q 2>/dev/null | sed -nE 's/.*free percentage: *([0-9]+)%.*/\1/p' | head -n 1; }
machine_calm() {  # 0 when the chosen signal says the machine is not busy; sets $signal_text to what it read
  case "${JOBADABRA_HEAVY_SIGNAL:-auto}" in
    cpu) local c; c="$(cpu_busy)"; signal_text="CPU in use ${c}% of ${cores} cores (busy above ${JOBADABRA_HEAVY_CPU_BUSY:-90}%)"; [ "${c:-0}" -le "${JOBADABRA_HEAVY_CPU_BUSY:-90}" ] ;;
    memory) local m; m="$(mem_free_pct)"; signal_text="free memory ${m:-?}% (busy below ${JOBADABRA_HEAVY_MEM_FREE_PCT:-15}%)"; [ -z "$m" ] || [ "$m" -ge "${JOBADABRA_HEAVY_MEM_FREE_PCT:-15}" ] ;;
    load) signal_text="1-minute load $(load1) is above $limit"; [ "$(load1)" -le "$limit" ] ;;
    *) local c m; c="$(cpu_busy)"; m="$(mem_free_pct)"   # auto: busy only when the CPU is used up or memory is short
       signal_text="CPU in use ${c}% of ${cores} cores (busy above ${JOBADABRA_HEAVY_CPU_BUSY:-90}%), free memory ${m:-?}% (busy below ${JOBADABRA_HEAVY_MEM_FREE_PCT:-15}%)"
       [ "${c:-0}" -le "${JOBADABRA_HEAVY_CPU_BUSY:-90}" ] && { [ -z "$m" ] || [ "$m" -ge "${JOBADABRA_HEAVY_MEM_FREE_PCT:-15}" ]; } ;;
  esac
}
machine_ready() {  # sets $why when not
  [ "$limit" -gt 0 ] 2>/dev/null || return 0
  [ "$load_gave_up" = 1 ] && return 0
  is_replay "$what" && [ "${JOBADABRA_HEAVY_REPLAY_LOAD:-0}" != 1 ] && return 0   # replays wait for the memory gate, not the load
  if machine_calm; then load_began=""; return 0; fi
  # The first busy reading always waits once (and says why): giving up on it could skip the wait line when the clock's second ticks between the two reads (main red, 13 Oct 2026)
  if [ -z "$load_began" ]; then load_began=$(date +%s)
  elif [ $(( $(date +%s) - load_began )) -ge "$load_wait" ]; then say "the machine is still busy ($signal_text) after ${load_wait}s: running $what anyway"; load_gave_up=1; return 0; fi
  why="the machine is busy: $signal_text (up to ${load_wait}s); using the CPU: $(top_cpu ' ' ', ')"; return 1
}
while :; do
  first=""; why=""; busy="$(held)"
  if machine_ready; then
    mark ""
    first_raw="$(ahead)"; first="${first_raw#*|}"; skip=0
    busy="$(held)"   # read AFTER the queue: the lock may have been taken while the queue was being read (a timing run's neighbour started beside it in a loaded run, 11 Oct 2026)
    # A replay beside the runs that hold the lock, with room in the budget, does not queue behind a waiter that has waited under the cap (JOBADABRA_HEAVY_REPLAY_SKIP=0 off).
    case "$first" in *'[exclusive]') ;; *) [ -n "$first" ] && [ "$busy" != 0 ] && is_replay "$what" && [ "${JOBADABRA_HEAVY_REPLAY_SKIP:-1}" != 0 ] && [ "${first_raw%%|*}" -lt "${JOBADABRA_HEAVY_STARVE:-600}" ] && skip=1 ;; esac
    if [ -z "$first" ] || [ "$skip" = 1 ]; then
      if [ "$busy" = 0 ]; then take && alone_ok && break
      elif ! is_exclusive && ! exclusive_held && [ "$busy" -lt "$max_slots" ] && memory_ok; then take && alone_ok && break; fi
    fi
  else mark loadwait; fi
  waited=$(( $(date +%s) - began ))
  if [ "$waited" -ge "$wait_max" ]; then say "waited ${wait_max}s for the lock held by $(holders): running anyway"; break; fi
  if [ "$told" = 0 ] || [ $((waited % 30)) -lt 2 ]; then
    if [ -n "$why" ]; then say "$what waits for the machine, holding no slot: $why"
    elif [ "$busy" != 0 ]; then say "$what waits: the lock is held by $(holders)${first:+, then $first is ahead}; waited ${waited}s; load $(load1), using the CPU: $(top_cpu ' ' ', ') (JOBADABRA_HEAVY=0 skips this)"
    else say "$what waits: $first asked first; waited ${waited}s (JOBADABRA_HEAVY=0 skips this)"; fi
    told=1; sleep "$poll"
  fi
  sleep "$poll"
done
rm -f "$ticket"
if [ -n "$lock" ]; then echo "$([ "$yield_mode" = 1 ] && echo "$JP_HEAVY_HELD" || echo $$)" >"$lock/pid"; echo "$what" >"$lock/what"; echo "$session" >"$lock/session"; echo "$klass" >"$lock/class"; date +%s >"$lock/since"; pwd >"$lock/cwd"; fi
waited_s=$(( $(date +%s) - began )); load_start="$(load1)"
ident="what=$what class=$klass branch=$branch_now session=$session load_q=$load_queue load_start=$load_start cpu_busy=$(cpu_busy) mem_free=$(mem_free_pct) mac_mem=$(mac_memory | tr " " /)${mem_said:+ $mem_said} top=$(top_cpu : , | tr ' ' _)"
if [ "$told" = 1 ]; then
  say "got the lock after ${waited_s}s"
  timing_log "heavy lock wait=${waited_s}s $ident"   # every wait, for the next measurement
fi

if [ "$yield_mode" = 1 ]; then say "$what has its place back after ${waited_s}s"; timing_log "heavy lock yield-back wait=${waited_s}s what=$what class=$klass session=$session"; exit 0; fi   # the caller goes on holding it
say "$what runs (pid $$)"
run_began=$(date +%s); code=0
# The command runs in its own process group (not when a terminal is attached: Ctrl-C and reads need the shared group), recorded in the slot; a cancel (EXIT/TERM/INT/HUP) kills the whole group.
# Only where Python can make a group (os.setpgid): on Windows its os.execvp starts the command and ENDS, so `wait` returned 0 at once and a green job hid a suite still running (12 Oct 2026, Windows apply + applycv).
if [ ! -t 0 ] && command -v python3 >/dev/null && python3 -c 'import os, sys; sys.exit(0 if hasattr(os, "setpgid") else 1)' 2>/dev/null; then
  JP_HEAVY_HELD=$$ python3 -c 'import os, sys
if hasattr(os, "setpgid"): os.setpgid(0, 0)
try: os.execvp(sys.argv[1], sys.argv[1:])
except FileNotFoundError: sys.exit(127)
except OSError: sys.exit(126)' "$@" 0<&0 & child=$!
  for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [ "$(ps -o pgid= -p "$child" 2>/dev/null | tr -d ' ')" = "$child" ] && { run_group="$child"; break; }; sleep 0.05; done
else JP_HEAVY_HELD=$$ "$@" 0<&0 & child=$!; fi
if [ -n "$lock" ]; then
  [ -n "$run_group" ] && echo "$run_group" >"$lock/pgid"
  # the session lookup walks the parent processes (slow on a loaded Mac): off the run's critical path
  { s="$(find_session_pid)"; [ -n "$s" ] && echo "$s" >"$lock/session_pid"; [ -n "$run_group" ] && idle_secs "$lock" 1; } >/dev/null 2>&1 &
fi
wait "$child" || code=$?
child=""   # it ended by itself: only a cancel (the traps) has a group left to kill
timing_log "heavy lock run=$(( $(date +%s) - run_began ))s wait=${waited_s}s exit=$code $ident"
exit "$code"
