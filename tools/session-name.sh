# Source it, then `session_name` prints the name of the Claude session this process runs under. Owner: ship-speed (11 Oct 2026). Guarded by tests/test_session_name.py.
# Order: JOB_PILOTTO_SESSION (a caller that detached from its parents, like ship.sh --background, sets it first), JP_SESSION, then the same lookup the workspace hooks use
# (walk the parent processes to ~/.claude/sessions/<pid>.json and read its "name"; JP_SESSIONS_DIR points elsewhere for tests), else "?".
session_name() {
  local name="${JOB_PILOTTO_SESSION:-${JP_SESSION:-}}"
  [ -n "$name" ] || name="$(session_key name)"
  echo "${name:-?}"
}

# `session_key <key>` prints one key of the Claude session file found by walking the parent processes (~/.claude/sessions/<pid>.json), or nothing.
# One walk for session_name and session_short (Gitar on #2629: two copies could drift on the hop limit, the stop at pid 1 or ps portability).
session_key() {
  local pid="$$" dir="${JP_SESSIONS_DIR:-$HOME/.claude/sessions}" hops=0
  while [ -n "$pid" ] && [ "$pid" != 1 ] && [ "$hops" -lt 12 ]; do
    if [ -f "$dir/$pid.json" ]; then python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], ""))' "$dir/$pid.json" "$1" 2>/dev/null; return; fi
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"; hops=$((hops + 1))
  done
}

# `session_short` prints the short name the owner sees in cmux (27, d3, bb) for a PR title's "[xx] " tag: JOB_PILOTTO_SESSION_SHORT (ship.sh --background
# exports it before it detaches), else the name the cmux title hook keeps for this Claude session (~/.claude/workspace-assignments/<sessionId>.short;
# JP_ASSIGNMENTS_DIR for tests), else the session name's last part, else "?".
# Why (owner, 30 Oct 2026, "Tag from cmux title"): the tag was the Claude name's last part, so d3's PRs read [8f] and the coordinator 27's read [07].
session_short() {
  local short="${JOB_PILOTTO_SESSION_SHORT:-}" kept="${JP_ASSIGNMENTS_DIR:-$HOME/.claude/workspace-assignments}" sid name
  if [ -z "$short" ] && [ -z "${JOB_PILOTTO_SESSION:-}${JP_SESSION:-}" ]; then   # a caller that named the session itself has no Claude parent to walk
    sid="$(session_key sessionId)"
    [ -n "$sid" ] && [ -s "$kept/$sid.short" ] && short="$(head -1 "$kept/$sid.short")"
  fi
  if [ -z "$short" ]; then name="$(session_name)"; short="${name##*-}"; fi
  echo "$short"
}
