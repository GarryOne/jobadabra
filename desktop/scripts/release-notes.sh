#!/usr/bin/env bash
# Release notes for a desktop build: the changelog since the previous desktop-v* tag (commit subjects
# that touch what the app ships), plus install steps. Usage: release-notes.sh [commit] > notes.md
set -euo pipefail
sha=$(git rev-parse "${1:-HEAD}")
cd "$(git rev-parse --show-toplevel)"  # the paths below are from the repo root (CI runs this from desktop/)
repo=${GITHUB_REPOSITORY:-GarryOne/jobadabra}
max=40
prev=$(git describe --tags --match 'desktop-v*' --abbrev=0 "$sha^" 2>/dev/null || true)
# Keep in sync with the paths that trigger .github/workflows/desktop.yml.
paths=(desktop src config tools extension worker/src requirements.txt
       docs/notion-profile-template.md docs/job-pilotto-guide.md)

changes=$(git log --no-merges --format='- %s (%h)' "${prev:+$prev..}$sha" -- "${paths[@]}")
count=$(printf '%s' "$changes" | grep -c '^- ' || true)

echo "## What's changed"
echo
if [ "$count" -eq 0 ]; then
  echo "- Rebuild with no app changes."
else
  printf '%s\n' "$changes" | awk -v max="$max" 'NR <= max'
  [ "$count" -gt "$max" ] && echo "- …and $((count - max)) earlier changes"
fi
if [ -n "$prev" ]; then
  echo
  echo "Full diff: https://github.com/$repo/compare/$prev...${sha:0:7}"
fi
cat <<'NOTES'

## Install (Mac with Apple Silicon)

1. Download **Jobadabra-mac-arm64.dmg** below, open it and drag **Jobadabra** to Applications (the file in Applications is still called Job Pilotto.app: it is the same app).
2. The first time you open it, macOS says it can't verify the developer (the app isn't notarised by
   Apple yet). Go to **System Settings → Privacy & Security** and click **Open Anyway**. Only once.

The same files are also named Job-Pilotto-… for a few releases, so older links and apps keep working.
NOTES
cat <<'NOTES'

## Install (Windows 10 or 11, x64, beta)

1. Download **Jobadabra-windows-x64.exe** below and run it; it installs for your user and opens the app.
2. The installer isn't signed yet, so Windows SmartScreen warns you. Click **More info → Run anyway**. Only once.
3. Apply with Claude is Mac-only for now; Fill in Chrome works the same.
NOTES
