# The memory gate of tools/heavy-lock.sh (sourced, not run): may one more heavy run start beside the ones that hold the lock? Uses $what, $SLOT_DIRS and is_replay from the caller.
# Guarded by tests/test_heavy_lock_pressure.py (the pressure rule), tests/test_heavy_lock_memory.py and tests/test_heavy_lock_budget.py (the floor rule).
#
# Pressure rule (default since 11 Oct 2026; measured: macOS said green and 51-55% free while free+inactive was 4.0 GB, so the 7 GB floor never let a 2nd live run start): a run starts
# beside others while
#   - macOS's memory pressure is normal (kern.memorystatus_vm_pressure_level 1; 2 warn and 4 critical hold),
#   - macOS's available memory (kern.memorystatus_level percent of hw.memsize), less what the runs started in the last JOBADABRA_HEAVY_RAMP seconds (90) declared and not yet
#     took, is over this run's own cost (live 2.9 GB, replay 1.2 GB) plus a margin (JOBADABRA_HEAVY_MEM_MARGIN_GB, 1.5),
#   - and the Mac is not swapping out: swap-outs under JOBADABRA_HEAVY_SWAPOUT_MBS MB/s (default 4) over the last few seconds. Swap already used is not counted: macOS grows the swap
#     file as needed, so "82% of 3 GB" said nothing (it held every 2nd run on 11 Oct 2026 while nothing was swapping).
# Floor rule (JOBADABRA_HEAVY_MEM_RULE=floor, and wherever the macOS readings are missing, e.g. Linux): free+inactive pages from vm_stat, less the same reservation, over 7 GB for a
# live run (JOBADABRA_HEAVY_MEM_GB) or 3 GB for a replay (JOBADABRA_HEAVY_MEM_REPLAY_GB), and swap used at most 50% (JOBADABRA_HEAVY_SWAP_PCT) or 70% for a replay.
my_cost() { is_replay "$what" && echo "${JOBADABRA_HEAVY_COST_REPLAY_GB:-1.2}" || echo "${JOBADABRA_HEAVY_COST_GB:-2.9}"; }
reserved_gb() { local dir since total=0 ramp="${JOBADABRA_HEAVY_RAMP:-90}"
  for dir in $SLOT_DIRS; do [ -f "$dir/cost" ] || continue; since="$(cat "$dir/since" 2>/dev/null || echo 0)"
    [ $(( $(date +%s) - since )) -lt "$ramp" ] && total="$(awk -v t="$total" -v c="$(cat "$dir/cost")" 'BEGIN {printf "%.1f", t + c}')"; done
  echo "$total"; }
# macOS's own reading: "<pressure level> <available GB>", or nothing when it cannot be read (not macOS, or a value out of range).
mac_memory() { local level pct total
  level="$(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null)"; pct="$(sysctl -n kern.memorystatus_level 2>/dev/null)"; total="$(sysctl -n hw.memsize 2>/dev/null)"
  case "$level" in 1|2|4) ;; *) return 0 ;; esac
  [ "${pct:-x}" -ge 0 ] 2>/dev/null && [ "$pct" -le 100 ] && [ "${total:-0}" -gt 1073741824 ] 2>/dev/null || return 0
  awk -v l="$level" -v p="$pct" -v t="$total" 'BEGIN {printf "%d %.1f", l, p * t / 100 / 1073741824}'; }
swapouts_mb() { vm_stat 2>/dev/null | awk '/page size of/ {for (i = 1; i < NF; i++) if ($i == "of") size = $(i + 1)} /^Swapouts:/ {v = $NF; sub(/\./, "", v); n = v} END {if (size && n != "") printf "%.1f", n * size / 1048576}'; }
# Sets $swap_mbs (swap-outs in MB/s) from a baseline kept between the waiter's polls; the first look (or one after 30 s) waits JOBADABRA_HEAVY_SWAP_SAMPLE seconds (2) for a second reading.
swap_base_t=""; swap_base_mb=""
swapout_rate() { local now mb
  now="$(date +%s)"; mb="$(swapouts_mb)"; swap_mbs=0
  [ -n "$mb" ] || return 0
  if [ -z "$swap_base_t" ] || [ $(( now - swap_base_t )) -gt 30 ]; then swap_base_t="$now"; swap_base_mb="$mb"; sleep "${JOBADABRA_HEAVY_SWAP_SAMPLE:-2}"; now="$(date +%s)"; mb="$(swapouts_mb)"; fi
  swap_mbs="$(awk -v a="$swap_base_mb" -v b="${mb:-$swap_base_mb}" -v s=$(( now - swap_base_t )) 'BEGIN {printf "%.1f", (b - a) / (s > 0 ? s : 1)}')"
  [ $(( now - swap_base_t )) -ge 10 ] && { swap_base_t="$now"; swap_base_mb="$mb"; }   # a rolling window of 2-10 s
  return 0; }
memory_ok() {  # one more run fits; sets $why when not, $mem_said to what was read (for the log)
  local mac level avail need reserved
  reserved="$(reserved_gb)"; why=""; mem_said=""
  mac="$([ "${JOBADABRA_HEAVY_MEM_RULE:-pressure}" = floor ] || mac_memory)"
  if [ -n "$mac" ]; then
    level="${mac%% *}"; avail="$(awk -v a="${mac#* }" -v r="$reserved" 'BEGIN {printf "%.1f", a - r}')"
    need="$(awk -v c="$(my_cost)" -v m="${JOBADABRA_HEAVY_MEM_MARGIN_GB:-1.5}" 'BEGIN {printf "%.1f", c + m}')"
    [ "$level" = 1 ] || why="macOS memory pressure is $([ "$level" = 2 ] && echo warn || echo critical), a run beside others needs it normal"
    awk -v a="$avail" -v n="$need" 'BEGIN {exit !(a > n)}' || why="${why:+$why; }available memory $avail GB (macOS ${mac#* } less $reserved reserved for runs just started), this run needs over $need"
    if [ -z "$why" ]; then swapout_rate
      awk -v r="$swap_mbs" -v m="${JOBADABRA_HEAVY_SWAPOUT_MBS:-4}" 'BEGIN {exit !(r < m)}' || why="the Mac swaps out ${swap_mbs} MB/s, a run beside others needs under ${JOBADABRA_HEAVY_SWAPOUT_MBS:-4}"; fi
    mem_said="rule=pressure level=$level avail=$avail swapout=${swap_mbs:-?}"
    [ -z "$why" ]; return
  fi
  local free swap floor="${JOBADABRA_HEAVY_MEM_GB:-7}" most="${JOBADABRA_HEAVY_SWAP_PCT:-50}"
  # A recorded-page replay is counted by its real cost (owner's brief, 11 Oct 2026): ~1.5 GB of Chrome at 4 tabs (2.1 GB at 6), not a pool run's 3.3 GB; a row replay (npm run row: one offline browser, ~1 GB) the same.
  is_replay "$what" && { floor="${JOBADABRA_HEAVY_MEM_REPLAY_GB:-3}"; most="${JOBADABRA_HEAVY_SWAP_REPLAY_PCT:-70}"; }
  free="$(vm_stat 2>/dev/null | awk '/page size of/ {for (i = 1; i < NF; i++) if ($i == "of") size = $(i + 1)} /^Pages (free|inactive):/ {v = $NF; sub(/\./, "", v); pages += v} END {printf "%.1f", pages * size / 1073741824}')"
  swap="$(sysctl -n vm.swapusage 2>/dev/null | awk '{for (i = 1; i < NF; i++) {if ($i == "total") t = $(i + 2) + 0; if ($i == "used") u = $(i + 2) + 0}} END {printf "%d", (t > 0 ? u * 100 / t : 0)}')"
  free="$(awk -v f="${free:-0}" -v r="$reserved" 'BEGIN {printf "%.1f", f - r}')"   # what the runs that started in the last JOBADABRA_HEAVY_RAMP seconds are still going to take
  awk -v f="${free:-0}" -v m="$floor" 'BEGIN {exit !(f > m)}' || why="free+inactive memory ${free:-0} GB, a 2nd run needs over $floor"
  [ "${swap:-0}" -le "$most" ] || why="${why:+$why; }swap ${swap}% used, a 2nd run needs $most% or less"
  mem_said="rule=floor free=${free:-0} swap=${swap:-0}%"
  [ -z "$why" ]
}
