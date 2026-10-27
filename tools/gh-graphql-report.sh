#!/usr/bin/env bash
# Counts the GraphQL calls tools/bin/gh logged in the last N hours (default 1), by session and by caller + command: who still spends the owner's 5,000 an hour.
# Usage: tools/gh-graphql-report.sh [hours]   Log: GH_GRAPHQL_LOG (default ~/.cache/jobadabra/gh-graphql.log). Guard: tests/test_gh_graphql_log.py.
log="${GH_GRAPHQL_LOG:-$HOME/.cache/jobadabra/gh-graphql.log}"; hours="${1:-1}"
since="$(date -u -d "-$hours hours" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-"$hours"H +%Y-%m-%dT%H:%M:%SZ)"
[ -f "$log" ] || { echo "no GraphQL call logged ($log missing)"; exit 0; }
awk -F'\t' -v since="$since" '$1 >= since {n++; s[$2]++; split($5, w, " "); c[$3 " | " w[1] " " w[2]]++}
  END {printf "%d GraphQL calls since %s\n", n, since; for (k in s) printf "  session %-28s %d\n", k, s[k]; for (k in c) printf "  caller  %-40s %d\n", k, c[k]}' "$log"
