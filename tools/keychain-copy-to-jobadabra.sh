#!/usr/bin/env bash
# One-time copy of this Mac's Keychain items from the old job-pilotto.* names to jobadabra.* (rename to Jobadabra, 1 Nov 2026). The app and the engine already
# read the old name when the new one is empty; the tools and e2e scripts that call `security` themselves (tools/, desktop/e2e/) read only the new name.
#   tools/keychain-copy-to-jobadabra.sh          dry run: prints the item NAMES that would be copied, copies nothing
#   tools/keychain-copy-to-jobadabra.sh --go     copies; an item that already exists under the new name is left as it is
# Never deletes, never changes the old item, never prints a secret (names and counts only). The account job-pilotto becomes jobadabra; any other account is kept.
set -eu
go=0; [ "${1:-}" = "--go" ] && go=1
dump=$(security dump-keychain 2>/dev/null) || { echo "keychain-copy: the Keychain could not be read" >&2; exit 1; }

items=$(printf '%s\n' "$dump" | awk '
  function flush() { if (svce ~ /^job-pilotto\./ && cls == "genp") printf "%s\t%s\t%s\n", acct, svce, icmt; acct = svce = icmt = ""; cls = "" }
  /^keychain: / { flush() }
  /^class: / { cls = ($0 ~ /"genp"/) ? "genp" : "other" }
  /"acct"<blob>=/ { v = $0; sub(/.*"acct"<blob>="/, "", v); sub(/"$/, "", v); acct = v }
  /"svce"<blob>=/ { v = $0; sub(/.*"svce"<blob>="/, "", v); sub(/"$/, "", v); svce = v }
  /"icmt"<blob>="/ { v = $0; sub(/.*"icmt"<blob>="/, "", v); sub(/"$/, "", v); icmt = v }
  END { flush() }')

copied=0; kept=0; failed=0
while IFS=$'\t' read -r acct svce icmt; do
  [ -n "$svce" ] || continue
  new="jobadabra.${svce#job-pilotto.}"; newacct="$acct"; [ "$acct" = "job-pilotto" ] && newacct="jobadabra"
  if security find-generic-password -a "$newacct" -s "$new" >/dev/null 2>&1; then echo "exists   $new"; kept=$((kept + 1)); continue; fi
  if [ "$go" = 0 ]; then echo "would copy  $svce -> $new"; copied=$((copied + 1)); continue; fi
  value=$(security find-generic-password -a "$acct" -s "$svce" -w 2>/dev/null) || { echo "unreadable  $svce" >&2; failed=$((failed + 1)); continue; }
  if security add-generic-password -U -a "$newacct" -s "$new" ${icmt:+-j "$icmt"} -w "$value" >/dev/null 2>&1; then echo "copied   $svce -> $new"; copied=$((copied + 1)); else echo "failed   $new" >&2; failed=$((failed + 1)); fi
done <<EOF
$items
EOF
echo "keychain-copy: $copied $([ "$go" = 1 ] && echo copied || echo to copy), $kept already there, $failed failed"
[ "$failed" = 0 ]
