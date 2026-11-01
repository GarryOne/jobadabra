# Source it: how tools/heavy-lock.sh frees a slot whose holder is dead weight, and kills a run's process group. Owner: lock-orphans (12 Oct 2026). Guarded by tests/test_heavy_lock_reap.py.
# 12 Oct 2026: a cancelled replay's wrapper was orphaned (parent gone) and its children hung at 0% CPU; the lock stayed held 27 min while five sessions waited.
# A slot records its wrapper's `pid`, the run's process group `pgid` and the Claude session's `session_pid`. A waiter frees a live slot when
#   - its session is gone: session_pid is dead, or the wrapper's parent is pid 1 (orphaned)            -> "freed: session gone"
#   - its process group used no CPU for the idle limit: JOBADABRA_HEAVY_IDLE seconds, else 3 x the run's median (gate-timing.log, default 70 s), at least JOBADABRA_HEAVY_IDLE_MIN (120)  -> "freed: idle <n>s"
# and kills the old tree by the recorded pgid (never by a name pattern). A busy holder is never freed: any CPU used (0.2 s or more since the last look) restarts the idle clock.
# JOBADABRA_SESSION_PID names the session pid when the caller knows it (ship.sh --background has no Claude among its parents); else the nearest ancestor with ~/.claude/sessions/<pid>.json.
reap_timing_path() { echo "${JOBADABRA_HEAVY_TIMING_LOG:-$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/gate-timing.log}"; }
expected_secs() {  # what -> the median run seconds of that kind from gate-timing.log (default 70)
  local timing m; timing="$(reap_timing_path)"
  m="$([ -f "$timing" ] && sed -nE "s/^# [^ ]+ heavy lock run=([0-9]+)s .*what=$1( .*|$)/\1/p" "$timing" | sort -n | awk '{a[NR]=$1} END {if (NR) print a[int((NR + 1) / 2)]}')"
  echo "${m:-70}"
}
idle_limit() {  # what -> seconds without CPU after which a holder is idle
  [ -n "${JOBADABRA_HEAVY_IDLE:-}" ] && { echo "$JOBADABRA_HEAVY_IDLE"; return; }
  local l=$(( $(expected_secs "$1") * 3 )) min="${JOBADABRA_HEAVY_IDLE_MIN:-120}"; [ "$l" -lt "$min" ] && l="$min"; echo "$l"
}
find_session_pid() {  # the Claude session this process runs under (the nearest ancestor with a session file), or nothing
  [ -n "${JOBADABRA_SESSION_PID:-}" ] && { echo "$JOBADABRA_SESSION_PID"; return; }
  local pid="$$" hops=0 dir="${JP_SESSIONS_DIR:-$HOME/.claude/sessions}"
  while [ -n "$pid" ] && [ "$pid" != 1 ] && [ "$hops" -lt 12 ]; do
    [ -f "$dir/$pid.json" ] && { echo "$pid"; return; }
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"; hops=$((hops + 1))
  done
}
group_cpu() {  # pgid -> CPU seconds used by the processes of that group (ps time is [dd-][hh:]mm:ss on Linux, m:ss.cc on macOS)
  ps -Ao pgid=,time= 2>/dev/null | awk -v g="$1" '$1 == g {t = $2; d = 0; if (index(t, "-")) {split(t, a, "-"); d = a[1]; t = a[2]} n = split(t, p, ":"); s = 0; for (i = 1; i <= n; i++) s = s * 60 + p[i]; tot += s + d * 86400} END {printf "%.2f", tot + 0}'
}
group_alive() {  # pgid -> 0 while a process of the group other than a zombie is there
  ps -Ao pgid=,stat= 2>/dev/null | awk -v g="$1" '$1 == g && $2 !~ /^Z/ {f = 1} END {exit !f}'
}
kill_group() {  # pgid [leader pid]: TERM, a short grace, then KILL; only a recorded numeric group, never this script's own
  local pg="$1" lead="${2:-}" i own; own="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"
  case "$pg" in ''|*[!0-9]*|0|1) pg="" ;; esac; [ "$pg" = "$own" ] && pg=""
  if [ -n "$pg" ]; then kill -TERM -- "-$pg" 2>/dev/null; elif [ -n "$lead" ]; then kill -TERM "$lead" 2>/dev/null; else return 0; fi
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if [ -n "$pg" ]; then group_alive "$pg" || return 0; else kill -0 "$lead" 2>/dev/null || return 0; fi
    sleep 0.1
  done
  if [ -n "$pg" ]; then kill -KILL -- "-$pg" 2>/dev/null; else kill -KILL "$lead" 2>/dev/null; fi
  return 0
}
idle_secs() {  # slot dir, [1 = remember what was seen] -> seconds the slot's group has used no CPU (0 when it is not known)
  local dir="$1" write="${2:-0}" pg now tot prev changed
  pg="$(cat "$dir/pgid" 2>/dev/null)"; [ -n "$pg" ] || { echo 0; return; }
  now=$(date +%s); tot="$(group_cpu "$pg")"
  if ! read -r prev changed <"$dir/cpu" 2>/dev/null || [ -z "$changed" ]; then prev="$tot"; changed="$now"; [ "$write" = 1 ] && echo "$prev $changed" >"$dir/cpu" 2>/dev/null 2>/dev/null; fi
  if awk -v a="$tot" -v b="$prev" 'BEGIN {d = a - b; if (d < 0) d = -d; exit !(d >= 0.2)}'; then prev="$tot"; changed="$now"; [ "$write" = 1 ] && echo "$prev $changed" >"$dir/cpu" 2>/dev/null 2>/dev/null; fi
  echo $(( now - changed ))
}
slot_orphan() {  # slot dir -> 0 when the Claude session it serves is gone or its wrapper's parent is pid 1
  local dir="$1" pid sp; pid="$(cat "$dir/pid" 2>/dev/null)"; sp="$(cat "$dir/session_pid" 2>/dev/null)"
  [ -n "$sp" ] && ! kill -0 "$sp" 2>/dev/null && return 0
  [ -n "$pid" ] && [ "$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')" = 1 ]
}
forced_reason() {  # slot dir -> prints why a LIVE slot is to be freed ("session gone" / "idle 300s") and returns 0; returns 1 for a live, working holder
  local dir="$1" pid what idle; pid="$(cat "$dir/pid" 2>/dev/null)"; [ -n "$pid" ] && [ "$pid" != "$$" ] || return 1
  if slot_orphan "$dir"; then echo "session gone"; return 0; fi
  what="$(cat "$dir/what" 2>/dev/null)"; idle="$(idle_secs "$dir" 1)"
  [ "$idle" -ge "$(idle_limit "$what")" ] && { echo "idle ${idle}s"; return 0; }
  return 1
}
reap_slot() {  # a slot dir already moved aside, why: say it, log it, and kill the old wrapper and its process group
  local gone="$1" why="$2" pid pg what session
  pid="$(cat "$gone/pid" 2>/dev/null)"; pg="$(cat "$gone/pgid" 2>/dev/null)"; what="$(cat "$gone/what" 2>/dev/null)"; session="$(cat "$gone/session" 2>/dev/null || echo ?)"
  say "freed: $why: $what (pid $pid, session $session) held the lock; its process group ${pg:-?} is killed"
  timing_log "heavy lock forced-free reason=$(echo "$why" | tr ' ' _) what=$what session=$session pid=$pid pgid=${pg:-?}"
  [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null   # its trap kills the group too and ends the wrapper
  kill_group "$pg" "$pid"
  [ -n "$pid" ] && kill -KILL "$pid" 2>/dev/null
  return 0
}
reap_dead() {  # a slot dir moved aside whose wrapper pid is gone (SIGKILL): children it started may still live in the recorded group; kill them by that group
  local pg; pg="$(cat "$1/pgid" 2>/dev/null)"
  case "$pg" in ''|*[!0-9]*|0|1) return 0 ;; esac
  group_alive "$pg" || return 0
  say "freed: wrapper gone: its process group $pg still had live processes, killed"
  timing_log "heavy lock forced-free reason=wrapper_gone what=$(cat "$1/what" 2>/dev/null) session=$(cat "$1/session" 2>/dev/null || echo ?) pgid=$pg"
  kill_group "$pg"
}
