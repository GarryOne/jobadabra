#!/usr/bin/env bash
# Applies one verdict to one GitHub issue, the same way wherever it was judged: the CI verdict pass (ui-verdict.yml) and the triage-github-open-issues skill (a person's session).
#   desktop/e2e/apply-verdict.sh <issue number> <verdict file> [repo]      (needs gh; prints one line per action, for the job log)
#   JUDGE="triage session (Claude Code, with the owner)" names who judged in the comment's footer; the default is the CI verdict pass. Runs from the repo root (evidence is checked there).
# The verdict file: first line the word (real | false-positive | harness | needs-human | fixed), then "Why: …", "Cause: …" (a false positive's), "Severity: high|medium|low",
# evidence as file:line (desktop/e2e/lib/verdict-comment.mjs parses it). What it does: the comment (banner, why, evidence, next step); the judge's severity on a real or parked
# finding (severity.mjs); the labels the stats read (confirmed, wontfix-auto, harness, needs-human, resolution:<why>, lib/resolution.mjs); closing a false positive, a harness
# finding or a fixed one. Guarded by desktop/e2e/test/apply-verdict.test.mjs.
set -euo pipefail
NUMBER="$1"; FILE="$2"; REPO="${3:-${REPO:-GarryOne/jobadabra}}"
HERE="$(cd "$(dirname "$0")" && pwd)"
case "$FILE" in /*) ;; *) FILE="$PWD/$FILE" ;; esac
cd "$HERE/../.."
OUT="$(mktemp)"
# The comment. After the evidence check, a `real` that cites code which does not exist has become `needs-human` in the file.
node "$HERE/verdict-comment.mjs" --file "$FILE" --number "$NUMBER" --out "$OUT" ${JUDGE:+--by "$JUDGE"}
verdict=$(head -1 "$FILE" 2>/dev/null | tr -d '[:space:]' || true)
# The judge's level replaces the detector's: a real, fixed or parked finding keeps the level a person would meet.
case "$verdict" in real|fixed|needs-human) node "$HERE/severity.mjs" --file "$FILE" --number "$NUMBER" --repo "$REPO" || true ;; esac
label() { gh label create "$1" --repo "$REPO" --force --color "$2" --description "$3" >/dev/null; gh issue edit "$NUMBER" --repo "$REPO" --add-label "$1" >/dev/null; }
resolution() {
  local name; name=$(node "$HERE/resolution.mjs" --file "$FILE" || true)
  if [ -n "$name" ]; then label "$name" F9D0C4 'Why this issue was closed (desktop/e2e/lib/resolution.mjs)'; fi
}
case "$verdict" in
  real)
    label confirmed 0E8A16 'A person or the verdict pass says this is real: ready to fix'
    gh issue comment "$NUMBER" --repo "$REPO" --body-file "$OUT" >/dev/null ;;
  false-positive)
    label wontfix-auto CCCCCC 'A false positive of the UI loop: never retried'
    resolution
    gh issue close "$NUMBER" --repo "$REPO" --reason "not planned" --comment "$(cat "$OUT")" >/dev/null ;;
  harness)
    label harness BFD4F2 'The test was wrong, not the product: the Finder self-review fixes the test'
    label wontfix-auto CCCCCC 'A false positive of the UI loop: never retried'
    resolution
    gh issue close "$NUMBER" --repo "$REPO" --reason "not planned" --comment "$(cat "$OUT")" >/dev/null ;;
  fixed)
    label confirmed 0E8A16 'A person or the verdict pass says this is real: ready to fix'
    label resolution:fixed 0E8A16 'A fix landed (a commit or a merged pull request)'
    gh issue close "$NUMBER" --repo "$REPO" --reason completed --comment "$(cat "$OUT")" >/dev/null ;;
  *)
    label needs-human D93F0B 'The UI loop could not fix this by itself'
    gh issue comment "$NUMBER" --repo "$REPO" --body-file "$OUT" >/dev/null ;;
esac
rm -f "$OUT"
echo "#$NUMBER: ${verdict:-none}"
