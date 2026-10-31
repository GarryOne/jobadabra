#!/usr/bin/env bash
# Count the gh calls a job makes, by endpoint, and print them with the REST budget left: the ledger that names the next spender.
# Why (31 Oct 2026, a8; beta 41226261602): the installation budget (5,000 REST calls an hour, shared by every workflow) ran out at 18:01 UTC after ~2,600 calls in 8 minutes,
# and no job counted its own calls, so nothing said who spent them (the 3rd fix on this class: 29 Oct the label job, 30 Oct "one writer"). Only gh CLI calls are counted.
#   gh-ledger.sh start   first step: puts a counting `gh` in front of the real one for the later steps (GITHUB_PATH)
#   gh-ledger.sh end     last step (if: always()): "ledger: job <name>: N gh calls", the top endpoints, the REST calls left (the rate_limit read is free)
set -euo pipefail
dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/gh-ledger"
case "${1:-}" in
  start)
    real="$(command -v gh || true)"
    if [ -z "$real" ]; then echo "ledger: no gh on PATH, nothing counted"; exit 0; fi
    mkdir -p "$dir/bin"; : > "$dir/calls.log"; echo "$real" > "$dir/real"
    if [ "${RUNNER_OS:-}" = Windows ]; then   # gh.exe is not replaced by a script: the budget delta is all a Windows job reports
      "$real" api rate_limit --jq .resources.core.remaining > "$dir/start-left" 2>/dev/null || echo "" > "$dir/start-left"
      echo windows > "$dir/mode"; exit 0
    fi
    cat > "$dir/bin/gh" <<SHIM
#!/usr/bin/env bash
case "\${1:-} \${2:-}" in "api rate_limit") ;; *) printf '%s\n' "\$*" >> "$dir/calls.log" ;; esac
exec "$real" "\$@"
SHIM
    chmod +x "$dir/bin/gh"
    "$real" api rate_limit --jq .resources.core.remaining > "$dir/start-left" 2>/dev/null || echo "" > "$dir/start-left"   # free; for the whole-budget delta at the end
    if [ -n "${GITHUB_PATH:-}" ]; then echo "$dir/bin" >> "$GITHUB_PATH"; fi
    ;;
  end)
    job="${GITHUB_JOB:-job}"
    if [ ! -s "$dir/real" ]; then echo "ledger: job $job: no count (no gh was on PATH at the start)"; exit 0; fi
    if [ -s "$dir/mode" ]; then echo "ledger: job $job: gh calls not counted on Windows (the budget delta below is)"
    else
    total="$(wc -l < "$dir/calls.log" | tr -d ' ')"
    echo "ledger: job $job: $total gh calls"
    # key = "<command> <subcommand>", or "api <endpoint>" with long numbers and the query string removed
    awk '{ if ($1 == "api") { key = "api"; for (i = 2; i <= NF; i++) if ($i !~ /^-/) { key = "api " $i; break } } else key = $1 " " $2; print key }' "$dir/calls.log" \
      | sed -E 's/\?.*$//; s/[0-9]{2,}/N/g' | sort | uniq -c | sort -rn | head -8 | sed 's/^ *\([0-9]*\) /ledger:   \1 /'
    fi
    left="$("$(cat "$dir/real")" api rate_limit --jq .resources.core.remaining 2>/dev/null || true)"
    echo "ledger: REST left in the budget: ${left:-not readable}"
    began="$(cat "$dir/start-left" 2>/dev/null || true)"
    # Every API client counts here (gh, curl, octokit), and so does every other job running at the same time: a spender shows as a delta far above the calm ~25 calls a minute.
    if [ -n "$began" ] && [ -n "$left" ]; then
      if [ "$began" -ge "$left" ]; then echo "ledger: the budget fell by $((began - left)) while this job ran (all jobs of the repo together)"
      else echo "ledger: the budget was renewed while this job ran (it read $began at the start)"; fi
    fi
    ;;
  *) echo "usage: gh-ledger.sh start|end" >&2; exit 2 ;;
esac
