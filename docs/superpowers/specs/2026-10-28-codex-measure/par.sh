#!/bin/sh
# 60 judge-shaped calls, 4 at a time; the weekly percent before, after each 20 and at the end; per-call seconds for the concurrency read.
cd "$(dirname "$0")" || exit 1
pct() { node limits.mjs | grep -o '"usedPercent":[0-9.]*' | head -1 | cut -d: -f2; }
one() { S=$(date +%s); codex exec --skip-git-repo-check --ignore-user-config -s read-only --disable shell_tool --json --ephemeral --output-schema schema.json -i red.png -o "p$1.txt" "Look at the image and the notes. verdict=pass if the image is mostly red, else fail. Notes: $(head -c 6000 notes.txt)" </dev/null > "pe$1.jsonl" 2>/dev/null; echo "call $1 secs=$(( $(date +%s) - S )) ok=$(grep -c '"verdict"' p$1.txt)"; }
echo "start pct=$(pct)"
for round in 0 1 2; do
  for k in 1 2 3 4 5; do for j in 1 2 3 4; do one $((round*20 + (k-1)*4 + j)) & done; wait; done
  echo "after $(( (round+1)*20 )) pct=$(pct)"
done
echo "par: done pct=$(pct)"
