#!/usr/bin/env bash
# Machine-wide queue for the push checks: at most JOB_PILOTTO_CHECK_SLOTS (default 2; owner, 11 Oct 2026: 3 at once drove the load to 124-152 on 8 cores, back to 2 until the gates run in parallel tabs) run at once on this Mac (8 cores; browser suites: at most two with spare memory, tools/heavy-lock.sh), so a fourth session
# pushing at the same time waits its turn instead of running a third full set on one CPU. Guarded by tests/test_check_slot.py.
#   tools/check-slot.sh <command...>           waits for a free slot (says so), runs the command, frees the slot, keeps its exit code
#   source tools/check-slot.sh; slot_acquire   ...  slot_release     (used by tools/pre-push-check.sh around its suites)
# A slot is a directory holding the owner's pid; one whose process is gone (killed run, reboot) is taken over at once.
# Every wait is logged to <git common dir>/gate-timing.log (JOB_PILOTTO_CHECK_TIMING_LOG elsewhere, GATE_TIMING=0 off).
# JOB_PILOTTO_CHECK_SLOTS=0 skips the queue; a wait longer than JOB_PILOTTO_CHECK_WAIT seconds (default 600) runs anyway.
SLOT_MINE=""

slot_claim() {  # try every slot; sets SLOT_MINE
  local slots="${JOB_PILOTTO_CHECK_SLOTS:-2}" root="${JOB_PILOTTO_CHECK_SLOT_DIR:-${TMPDIR:-/tmp}/jobadabra-check-slots}" i dir pid
  mkdir -p "$root"
  for i in $(seq 1 "$slots"); do
    dir="$root/slot$i"
    if mkdir "$dir" 2>/dev/null; then echo $$ >"$dir/pid"; SLOT_MINE="$dir"; return 0; fi
    pid="$(cat "$dir/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then   # its owner is gone: take the slot over
      echo $$ >"$dir/pid.new" && mv -f "$dir/pid.new" "$dir/pid" && { SLOT_MINE="$dir"; return 0; }
    fi
  done
  return 1
}

slot_acquire() {
  # The landing of a red-main fix does not wait for a slot (JOB_PILOTTO_RED_FIX=1, set by tools/ship.sh --fix and by a push with CI_RED_OK=1): it runs beside the others, said in one line.
  if [ "${JOB_PILOTTO_RED_FIX:-}" = 1 ]; then echo "check-slot: this is the fix of a red main: it does not wait for a slot" >&2; return 0; fi
  local slots="${JOB_PILOTTO_CHECK_SLOTS:-2}" wait_max="${JOB_PILOTTO_CHECK_WAIT:-600}" started told=0
  [ "$slots" -gt 0 ] 2>/dev/null || return 0
  started="$(date +%s)"
  until slot_claim; do
    if [ $(( $(date +%s) - started )) -ge "$wait_max" ]; then echo "check-slot: waited ${wait_max}s, running anyway" >&2; return 0; fi
    [ "$told" = 0 ] && echo "check-slot: $slots other check run(s) are using this Mac; waiting for a free slot (up to ${wait_max}s)" >&2
    told=1; sleep 2
  done
  if [ "$told" = 1 ]; then
    echo "check-slot: got a slot after $(( $(date +%s) - started ))s" >&2
    if [ "${GATE_TIMING:-1}" != 0 ]; then   # every wait, for the next measurement (11 Oct 2026: none was logged, so the slot count could not be sized)
      local timing="${JOB_PILOTTO_CHECK_TIMING_LOG:-$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/gate-timing.log}"
      [ "$timing" = /gate-timing.log ] || echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) check slot wait=$(( $(date +%s) - started ))s slots=$slots" >>"$timing" 2>/dev/null || true
    fi
  fi
  return 0
}

slot_release() { [ -n "$SLOT_MINE" ] && rm -rf "$SLOT_MINE"; SLOT_MINE=""; return 0; }

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  slot_acquire
  trap slot_release EXIT
  trap 'slot_release; exit 143' TERM INT HUP
  "$@"
fi
