#!/bin/sh
# 20 judge-shaped calls; the weekly percent is read through the app-server before, every 5 calls, and after.
cd "$(dirname "$0")" || exit 1
pct() { node limits.mjs | grep -o '"usedPercent":[0-9.]*' | head -1 | cut -d: -f2; }
echo "start pct=$(pct)"
for i in $(seq 1 20); do
  S=$(date +%s)
  codex exec --skip-git-repo-check --ignore-user-config -s read-only --disable shell_tool --json --ephemeral \
    --output-schema schema.json -i red.png -o "o$i.txt" \
    "Look at the image and the notes. verdict=pass if the image is mostly red, else fail. Notes: $(head -c 6000 notes.txt)" </dev/null > "e$i.jsonl" 2>/dev/null
  echo "call $i secs=$(( $(date +%s) - S )) $(grep -o '"input_tokens":[0-9]*,"cached_input_tokens":[0-9]*' e$i.jsonl | tail -1)"
  [ $((i % 5)) -eq 0 ] && echo "after $i pct=$(pct)"
done
echo "batch: done pct=$(pct)"
