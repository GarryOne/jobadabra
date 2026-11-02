#!/usr/bin/env bash
# Claude Code Stop hook (.claude/settings.json): before Claude says it's done, run the test suites that match the
# files changed vs origin/main in each worktree this session touched, the way CI runs them, and send failures back.
#   src/ tests/ tools/ config/ templates/ -> Python, as CI sees it (JOBADABRA_DISABLE=..., no Keychain credentials)
#   desktop/ -> desktop npm test    app-core/ extension/ -> app-core npm test    site/ -> site npm test
#   a file added, removed or renamed anywhere -> desktop's code-map test (its header comment says what it does)
# Uses Python >= 3.11 and Node 22 (nvm) whatever is first on PATH. Each suite is time-boxed; a tree state that
# already passed is not tested again. Exit 2 + stderr keeps Claude working on the failure (once per stop chain).
# Manual run: echo '{"cwd":"<worktree>"}' | tools/stop-test-check.sh
set -uo pipefail

input="$(cat)"
# An "Apply with Claude" session of the desktop app runs in this checkout on the owner's Mac and has JOBADABRA_SESSION set:
# it fills a job form and changes no code, so its end must not start the test suites (1 Oct 2026: the app showed "Claude
# needs your answer" while the hook ran them for minutes, and Claude wrote a report about unrelated failing tests).
[ -n "${JOBADABRA_SESSION:-}" ] && exit 0
jqr() { jq -r "$1" <<<"$input" 2>/dev/null; }
cwd="$(jqr '.cwd // ""')"; transcript="$(jqr '.transcript_path // ""')"; again="$(jqr '.stop_hook_active // false')"
limit="${JOBADABRA_STOP_TIMEBOX:-240}"   # seconds per suite
cache="${TMPDIR:-/tmp}/jobadabra-stop-hook"; mkdir -p "$cache"

# Worktrees to check: the one the session runs in, and every worktree it CHANGED: an Edit/Write/NotebookEdit path in it, or a Bash call naming it that
# writes (git commit/add/apply/checkout/restore, sed -i, tools/ship.sh). One it only read or ran tests in is another session's work, not tested here (11 Oct 2026).
# Only a worktree this session CHANGED is tested; the folder it runs in counts only if the transcript shows a change there (owner, 11 Oct 2026: "this shouldn't happen by default, on local":
# sessions started in the primary checkout ran its whole desktop suite at every stop though they changed nothing there). STOP_CHECK_CWD=1 brings the old "cwd always" back.
# Fast by default (owner, 13 Oct 2026, agreed): every PR runs these suites in CI as required checks before the owner merges, so re-running them at each
# stop only loaded the Mac (load ~200 with five sessions) and failed sessions on flakes that only load causes. The pure checks (subject, trailers, file size,
# recorded cases) still run at every commit and push (tools/pre-push-check.sh). STOP_CHECK_SUITES=1: run the matching suites as before (this hook's tests set it).
[ "${STOP_CHECK_SUITES:-0}" = 1 ] || exit 0
dirs=(); [ "${STOP_CHECK_CWD:-0}" = 1 ] && dirs=("$cwd")
if [ -f "$transcript" ]; then
  while IFS= read -r p; do dirs+=("$p"); done < <(
    tail -n 4000 "$transcript" | jq -r 'select(.type=="assistant") | .message.content[]?
      | select(.type=="tool_use") | . as $call | .input
      | if ($call.name | test("^(Edit|Write|NotebookEdit|MultiEdit)$")) then (.file_path // .notebook_path // empty)
        elif ($call.name == "Bash") and ((.command // "") | test("git +(-C +[^ ]+ +)?(commit|add|apply|checkout|restore|mv|rm|stash)|sed +-i|tools/ship\\.sh")) then .command
        else empty end' 2>/dev/null |
      grep -oE '(/[^[:space:]"'"'"'`;|&()]+)' | grep -E '\.claude/worktrees/|/jobadabra' |
      sed -E 's#(\.claude/worktrees/[^/]+).*#\1#' | sort -u | head -50)
fi
repos=()
for d in ${dirs[@]+"${dirs[@]}"}; do
  [ -n "$d" ] || continue
  while [ ! -d "$d" ] && [ "$d" != "/" ] && [ -n "$d" ]; do d="$(dirname "$d")"; done
  top="$(git -C "$d" rev-parse --show-toplevel 2>/dev/null)" || continue
  [ -f "$top/src/daily.py" ] && [ -d "$top/app-core" ] || continue   # only this project
  case " ${repos[*]-} " in *" $top "*) ;; *) repos+=("$top") ;; esac
done
[ ${#repos[@]} -gt 0 ] || exit 0

# Toolchain like CI (Python 3.12, Node 20/22): a stale Node 16 / Python 3.9 on PATH fails suites for no reason.
py=python3
for c in python3.12 python3.13 python3.11 python3; do
  if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then py="$c"; break; fi
done
node22="$(ls -d "$HOME"/.nvm/versions/node/v22.* 2>/dev/null | sort -V | tail -1)"
[ -n "$node22" ] && export PATH="$node22/bin:$PATH"
tbin="$(command -v gtimeout || command -v timeout || true)"
source "$(dirname "$0")/gate-cache.sh" 2>/dev/null || gate_cache_run() { shift 3; "$@"; }
source "$(dirname "$0")/test-log-failures.sh"   # failing_files / failing_names: either reporter's shape
export GATE_CACHE_DIRTY=1 GATE_CACHE_NOTES; GATE_CACHE_NOTES="$(mktemp)"   # the working tree counts, uncommitted files too; the same pass store as the push gate
boxed() { if [ -n "$tbin" ]; then "$tbin" -k 10 "$limit" "$@"; else "$@"; fi; }
# The suites wait for a check slot like a push gate does (tools/check-slot.sh, JOBADABRA_CHECK_SLOTS at a time on this Mac): several sessions' Stop hooks plus pushes plus a hand-run `npm test` ran
# whole lint and test suites at once (11 Oct 2026: 1-minute load 160-205, live proofs held for minutes). One line says it waits; JOBADABRA_STOP_SLOT_WAIT seconds at most (default 120, then it runs
# anyway: a Stop hook must not hang a session); STOP_CHECK_NO_SLOT=1 skips the slot. Guarded by tests/test_stop_hook_slot.py.
slot_taken=""
take_slot() {
  [ -z "$slot_taken" ] || return 0; slot_taken=1
  [ -z "${STOP_CHECK_NO_SLOT:-}" ] || return 0
  source "$(dirname "$0")/check-slot.sh" 2>/dev/null || return 0
  JOBADABRA_CHECK_WAIT="${JOBADABRA_STOP_SLOT_WAIT:-120}" slot_acquire
  trap 'slot_release' EXIT
}

report=""; timeouts=""; notes=""
for repo in "${repos[@]}"; do
  git -C "$repo" rev-parse -q --verify origin/main >/dev/null || continue
  base="$(git -C "$repo" merge-base HEAD origin/main 2>/dev/null)" || continue
  status="$(git -C "$repo" diff --name-status "$base" 2>/dev/null)"
  untracked="$(git -C "$repo" ls-files --others --exclude-standard 2>/dev/null)"
  files="$( { cut -f2- <<<"$status" | tr '\t' '\n'; printf '%s\n' "$untracked"; } | sed '/^$/d' | sort -u)"
  # What counts is what THIS tree still differs from origin/main in (11 Oct 2026: a worktree behind main whose own commit had landed was tested again; origin/main is fetched now): a file that
  # equals main's copy is landed work, not a change. Text-only paths (docs, *.md, .claude/, LICENSE, .gitignore) run nothing, as the push gate says "docs alone run nothing".
  git -C "$repo" fetch -q origin main 2>/dev/null || true
  if [ -n "$files" ] && [ "${STOP_CHECK_LANDED:-0}" != 1 ]; then
    differs="$(cd "$repo" && git diff --name-only origin/main -- $(printf '%s\n' "$files" | tr '\n' ' ') 2>/dev/null; printf '%s\n' "$untracked")"
    files="$(comm -12 <(printf '%s\n' "$files" | sort -u) <(printf '%s\n' "$differs" | sed '/^$/d' | sort -u))"
  fi
  files="$(printf '%s\n' "$files" | grep -vE '\.md$|^docs/|^\.claude/|^LICENSE|(^|/)\.gitignore$' || true)"
  [ -n "$files" ] || continue

  suites=()
  grep -qE '^(src|tests|tools|config|templates)/|^requirements[^/]*\.txt$' <<<"$files" && suites+=(python)
  grep -q '^desktop/' <<<"$files" && suites+=(desktop)
  grep -qE '^(app-core|worker|extension)/' <<<"$files" && suites+=(worker)
  grep -q '^site/' <<<"$files" && suites+=(site)
  if [ -n "$untracked" ] || grep -qE '^[ADR]' <<<"$status"; then
    case " ${suites[*]-} " in *" desktop "*) ;; *) suites+=(codemap) ;; esac
  fi
  [ ${#suites[@]} -gt 0 ] || continue

  # What the push gate would run: only the tests this change can break (tools/affected-tests.py, via check.sh --affected-from; "all" for dependency, config and unknown paths
  # stays the whole suite). STOP_CHECK_FULL=1 = the old whole-suite run. The pick is part of the cache key, so a different pick is a different run.
  affected_flag=""; pick=""; picked_files=()
  if [ "${STOP_CHECK_FULL:-0}" != 1 ] && [ -f "$repo/tools/affected-tests.py" ]; then
    while IFS= read -r f; do picked_files+=("$f"); done <<<"$files"
    pick="$(cd "$repo" && $py tools/affected-tests.py --files "${picked_files[@]}" 2>/dev/null | shasum | cut -c1-16)"
    [ -n "$pick" ] && affected_flag="--affected-from $base"
  fi

  # Same tree as a run that already passed (or already failed and was reported): don't run again.
  key="$( { echo "$repo ${suites[*]} $affected_flag $pick"; git -C "$repo" rev-parse HEAD; git -C "$repo" diff "$base";
    [ -n "$untracked" ] && (cd "$repo" && tr '\n' '\0' <<<"$untracked" | xargs -0 shasum 2>/dev/null); } | shasum | cut -c1-16)"
  [ -f "$cache/$key.pass" ] && continue
  if [ -f "$cache/$key.fail" ]; then report+="$(cat "$cache/$key.fail")"$'\n'; continue; fi

  logs="$(mktemp -d)"; pids=()
  for s in "${suites[@]}"; do
    case "$s" in
      python) cmd=(bash tools/check.sh --area python $affected_flag); dir="$repo" ;;
      codemap) cmd=(node --test test/codemap.test.js); dir="$repo/desktop" ;;
      *) cmd=(bash tools/check.sh --area "$s" $affected_flag); dir="$repo" ;;
    esac
    if [ "$s" != python ] && [ ! -e "$dir/node_modules" ] && [ ! -e "$repo/$s/node_modules" ]; then   # an area keeps its own node_modules (desktop/, worker/, site/): the repo root has none (11 Oct 2026: every worktree said "not tested")
      notes+="$s not tested in $repo: no node_modules (run npm ci there in the owner's terminal, or tools/worktree.sh links them)."$'\n'
      continue
    fi
    out="$logs/$s.log"; [ "$s" = python ] && out=/dev/null   # unittest reports on stderr; the tests' prints are noise
    if [ "$s" = codemap ]; then run=(boxed "${cmd[@]}"); else run=(gate_cache_run "$repo" "$s" "flag=$affected_flag args= pick=$pick" boxed "${cmd[@]}"); fi
    take_slot
    ( cd "$dir" && JOBADABRA_AFFECTED_FILES="$files" "${run[@]}" >"$out" 2>>"$logs/$s.log"; echo $? >"$logs/$s.code" ) &
    pids+=($!)
  done
  [ ${#pids[@]} -gt 0 ] && wait "${pids[@]}"
  # tools/ship.sh removes the worktree it landed, possibly while these tests ran in it (10 Oct 2026: 40 "No such file" errors for a push that had
  # passed the same suites): a repo whose .git is gone has no result worth reporting.
  if [ ! -e "$repo/.git" ]; then notes+="$repo was removed while its tests ran (landed by tools/ship.sh): its results are dropped, not failures."$'\n'; rm -rf "$logs"; continue; fi

  failed=""
  for s in "${suites[@]}"; do
    [ -f "$logs/$s.code" ] || continue
    code="$(cat "$logs/$s.code")"
    if [ "$code" = 124 ] || [ "$code" = 137 ]; then timeouts+="$s in $repo took over ${limit}s (not counted as a failure). "; continue; fi
    [ "$code" = 0 ] && continue
    case "$s" in
      python) how="JOBADABRA_DISABLE=mail,notion,telegram,google_jobs $py -m unittest discover -s tests" ;;
      codemap) how="cd desktop && node --test test/codemap.test.js (a new file needs a one-line header saying what it does)" ;;
      *) how="cd $s && npm test" ;;
    esac
    failed+="--- $s failed (exit $code). Reproduce in $repo: $how"$'\n'
    names="$(failing_names "$logs/$s.log")"   # the failing test files and tests, named (not only counted)
    [ -n "$names" ] && failed+="Failing tests:"$'\n'"$names"$'\n'
    keep="$cache/fail-logs/$key-$s"; mkdir -p "$keep" && cp -R "$logs"/. "$keep"/ 2>/dev/null && failed+="Full logs kept in $keep"$'\n'   # deleted after 2 days with the rest of the cache
    failed+="$(grep -E '^(FAIL|ERROR):|^# fail|npm (ERR|error)' "$logs/$s.log" | sort -u | head -20)"$'\n'
    if [ "$s" = python ]; then   # the unittest failure blocks (====== FAIL: ... traceback), not the tests' prints
      failed+="$(awk '/^={40,}$/{p=1} p' "$logs/$s.log" | head -60)"$'\n'
    else failed+="$(grep -A14 -E '^not ok' "$logs/$s.log" | head -45)"$'\n'; [ -n "$(grep -m1 '^not ok' "$logs/$s.log")" ] || failed+="$(tail -n 25 "$logs/$s.log")"$'\n'; fi
  done
  rm -rf "$logs"
  if [ -z "$failed" ]; then
    [ -z "$timeouts" ] && touch "$cache/$key.pass"
  else
    printf '%s' "$failed" >"$cache/$key.fail"; report+="$failed"
  fi
done
find "$cache" -type f -mtime +2 -delete 2>/dev/null; find "$cache/fail-logs" -mindepth 1 -maxdepth 1 -type d -mtime +2 -exec rm -rf {} + 2>/dev/null
[ -s "$GATE_CACHE_NOTES" ] && notes+="$(sort -u "$GATE_CACHE_NOTES" | tr '\n' ' ')"$'\n'
rm -f "$GATE_CACHE_NOTES"

msg=""
[ -n "$timeouts" ] && msg+="Stop hook: $timeouts"
[ -n "$notes" ] && msg+="Stop hook: $notes"
if [ -n "$report" ] && [ "$again" != true ]; then
  {
    echo "Tests that match your changes fail the way CI runs them (Python without credentials, Node 22). Fix them"
    echo "(or say clearly why they are unrelated) before saying you're done."
    printf '%s' "$report" | head -c 6000
    [ -n "$msg" ] && echo "$msg"
  } >&2
  exit 2
fi
[ -n "$report" ] && msg+="Stop hook: tests still fail (reported once already): $(printf '%s' "$report" | grep -E '^--- ' | tr '\n' ' ')"
[ -n "$msg" ] && jq -n --arg m "$msg" '{systemMessage: $m}'
exit 0
