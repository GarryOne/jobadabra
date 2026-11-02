# Source it: the priority classes of tools/heavy-lock.sh and the order rules built on them. Owner: ship-speed (11 Oct 2026). Guarded by tests/test_heavy_lock_classes.py.
# A run's class comes from JOBADABRA_HEAVY_CLASS (fix | proof | pool | explore | other) or, without it, from its `what` name (and `fix` when JOBADABRA_RED_FIX=1, which `tools/ship.sh --fix` sets):
#   fix      what the landing of a red-main fix needs (owner, 11 Oct 2026): before everything, never waits behind ordinary work, no starvation cap
#   proof    a run that blocks a landing: row replays (row, row-*), recorded replays, real-extension, a held row proof (`npm run live` sets it)
#   pool     the pool's whole-list smoke (e2e-smoke without --only)         explore  discovery runs          other  anything else
# Priority number = 2 x class rank (fix 0, proof 1, other 2, pool 3, explore 4) + 0 for a short row replay (~15 s) or 1 for the rest: lower goes first.
# A waiter goes ahead of an OLDER waiter with a bigger number only while that older one has waited under a cap, so nobody starves: JOBADABRA_HEAVY_STARVE seconds (default 600)
# when the class differs, JOBADABRA_HEAVY_SHORT_AGE (default 120) when only shortness does. JOBADABRA_HEAVY_CLASSES=0 = arrival order between classes, JOBADABRA_HEAVY_SHORT_FIRST=0 = no row-first.
is_short() { case "$1" in row|row-*) return 0 ;; *) return 1 ;; esac; }   # a row replay: one offline browser, ~15 s
is_replay() { case "$1" in row|row-*|recorded-replay) return 0 ;; *) return 1 ;; esac; }
lock_class() {  # what [explicit class]
  case "${2:-}" in fix|proof|pool|explore|other) echo "$2"; return ;; esac
  [ "${JOBADABRA_RED_FIX:-}" = 1 ] && { echo fix; return; }
  case "$1" in row|row-*|recorded-replay|recorded-both|recorded-map|real-extension|proof|proof-*) echo proof ;; e2e-smoke|pool|pool-*) echo pool ;; discover|discover-*|explore|explore-*) echo explore ;; *) echo other ;; esac
}
prio_of() {  # what class -> priority number
  local rank=2
  case "$2" in fix) rank=0 ;; proof) rank=1 ;; other) rank=2 ;; pool) rank=3 ;; explore) rank=4 ;; esac
  is_short "$1" && echo $((rank * 2)) || echo $((rank * 2 + 1))
}
ticket_prio() {  # a queue ticket file -> its priority number (lines: "<pid> <what>", state, session, class)
  local what class; what="$(head -n 1 "$1" 2>/dev/null | cut -d' ' -f2-)"; class="$(sed -n 4p "$1" 2>/dev/null)"
  prio_of "$what" "$(lock_class "$what" "$class")"
}
can_overtake() {  # my_prio their_prio their_age_seconds: may I go ahead of that waiter?
  local mine="$1" theirs="$2" age="$3" cap
  [ "$mine" -lt "$theirs" ] || return 1
  [ "$mine" -lt 2 ] && return 0   # a red-main fix goes before everyone, whatever they have waited
  if [ $((mine / 2)) != $((theirs / 2)) ]; then [ "${JOBADABRA_HEAVY_CLASSES:-1}" = 0 ] && return 1; cap="${JOBADABRA_HEAVY_STARVE:-600}"
  else [ "${JOBADABRA_HEAVY_SHORT_FIRST:-1}" = 0 ] && return 1; cap="${JOBADABRA_HEAVY_SHORT_AGE:-120}"; fi
  [ "$age" -lt "$cap" ]
}
