#!/usr/bin/env bash
# Claude Code PreToolUse hook (.claude/settings.json): before any `git push` from this repo (or one of its
# worktrees), run every test suite CI runs on a clean checkout of what is pushed, and block the push if one fails, so only green builds reach
# GitHub. Reads the hook's JSON on stdin; reports all pure-check refusals together, then exits 2 to block the command.
#   python: unittest, normally and as CI sees it (no Notion/Telegram/Google/SerpApi credentials)
#   worker: npm test  desktop: npm test (npm ci first when node_modules is missing)
# Runs only the suites the push touches (AGENTS.md "Change tiers"; PUSH_FULL=1 for all). Also blocks a push on top of a red CI build on main
# (not one that was only cancelled), and a build.yml that installs without dev dependencies.
set -uo pipefail
source "$(dirname "$0")/gate-timing.sh" 2>/dev/null || { gate_timing_start() { :; }; timed() { shift; "$@"; }; gate_summary() { :; }; }
gate_timing_start
workflows_lint() { SHELLCHECK_OPTS='--severity=warning' actionlint .github/workflows/*.yml; }
# Every check from the commit subjects to the workflow lint runs, and each refusal is kept: one run tells them all, then blocks once (owner, 30 Oct 2026:
# "ship always from the first try"; the verdict PR took 4 pushes, one refusal shown per push). Guard: tests/test_pre_push_pr.py.
blocks=()
block() { blocks+=("$*"); }
report_blocks() {
  [ ${#blocks[@]} -eq 0 ] && return 0
  local n=0 b
  echo "Push blocked by ${#blocks[@]} check(s); every one is listed, so fix them all before the next push:" >&2
  for b in "${blocks[@]}"; do n=$((n + 1)); printf '%s) %s\n' "$n" "$b" >&2; done
  exit 2
}
GATE_DEFERRABLE=""; GATE_DEFERRED=""
source "$(dirname "$0")/gate-watchdog.sh" 2>/dev/null || { gate_budget() { echo 0; }; gate_wait_budget() { wait; }; gate_was_deferred() { return 1; }; }
source "$(dirname "$0")/gate-cache.sh" 2>/dev/null || gate_cache_run() { shift 3; "$@"; }   # a checkout without it (the hook's own test repo) runs everything
export GATE_CACHE_NOTES="$(mktemp)"
trap 'type slot_release >/dev/null 2>&1 && slot_release; [ -s "$GATE_CACHE_NOTES" ] && cat "$GATE_CACHE_NOTES" >&2; rm -f "$GATE_CACHE_NOTES"; gate_summary' EXIT   # one EXIT trap: the slot is freed and the timing printed on every way out

input="$(cat)"
command="$(jq -r '.tool_input.command // ""' <<<"$input")"
case "$command" in *PUSH_FULL=1*) PUSH_FULL_RUN=1 ;; esac   # a full run has no watchdog (tools/gate-watchdog.sh)
# Why (1 Nov 2026, owner, test stages 3-5: "Drop all 4 from push"; narrowed after Gitar's review on #2765): the lane registry and renderer class tests are left to the PR's Fast checks (pr-gate, CI_GATES=1)
# on the push that ship.sh makes (SHIP_PR=1) and only there. A direct push to main has no pr-gate, so it still runs them. Tests: tests-desktop.yml runs both on the PR too;
# tests/test_pre_push_pr.py plays all three kinds of push.
ship_push=0; case "$command" in *SHIP_PR=1*) ship_push=1 ;; esac
# An npm install through a node_modules that is a link into another checkout empties that shared folder for every worktree (28 Oct 2026): refused before npm runs
# (tools/linked-modules-guard.py; the way out is `tools/worktree.sh own-modules <dir>`; tests/test_linked_modules_guard.py).
case "$command" in *npm*)
  linked="$(python3 "$(dirname "$0")/linked-modules-guard.py" <<<"$input" 2>&1)" || { echo "$linked" >&2; exit 2; } ;;
esac
# A `git commit` whose subject is over 72 characters is stopped here, before it exists: fixing it after the commit needs an amend, which
# Claude Code's auto mode may deny, and then the push below stays blocked (5 Oct 2026). `COMMIT_LONG_OK=1` skips it.
case "$command" in *"git commit"*)
  case "$command" in *COMMIT_LONG_OK=1*) ;; *)
    subject="$(python3 "$(dirname "$0")/commit-subject.py" <<<"$command" 2>/dev/null)"
    if [ "${#subject}" -gt 72 ]; then
      echo "Commit blocked: subject is ${#subject} characters, at most 72 (details go in the body): $subject" >&2
      exit 2
    fi ;;
  esac ;;
esac
case "$command" in *"git push"*) ;; *) exit 0 ;; esac

# The directory the push runs in: the last `cd <dir>` before `git push` in the command, else the call's cwd.
dir="$(jq -r '.cwd // ""' <<<"$input")"
before_push="${command%%git push*}"
last_cd="$(grep -oE 'cd[[:space:]]+[^;&|]+' <<<"$before_push" | tail -1 | sed -E 's/^cd[[:space:]]+//; s/[[:space:]]+$//')"
if [ -n "$last_cd" ]; then
  last_cd="${last_cd/#\~/$HOME}"
  case "$last_cd" in /*) dir="$last_cd" ;; *) dir="$dir/$last_cd" ;; esac
fi
repo="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -f "$repo/src/daily.py" ] && [ -d "$repo/app-core" ] || exit 0   # only this project

# A red main never blocks a push (owner, 1 Nov 2026: "We should remove that rule. It was when we're not using PRs. Now, since we use PRs, main can be red"): the PR's own required checks guard main.

# Commit subjects: one line, at most 72 characters (AGENTS.md → Commit messages). Checks the commits this push adds on top of
# origin/main, merges aside; `COMMIT_LONG_OK=1 git push ...` skips it (a pushed commit is never rewritten to satisfy this).
case "$command" in *COMMIT_LONG_OK=1*) ;; *)
  long="$(git -C "$repo" log origin/main..HEAD --no-merges --format='%h %s' 2>/dev/null | awk '{ s=$0; sub(/^[^ ]+ /, "", s); if (length(s) > 72) print $0 }')"
  if [ -n "$long" ]; then
    block "commit subject over 72 characters (details go in the body, no versions or reasons in the subject):
$(echo "$long" | cut -c1-110)
Shorten your own unpushed commits: git commit --amend (last one). If the amend is denied, push it as it is: COMMIT_LONG_OK=1 git push ... (never rewrite a pushed commit for this)."
  fi ;;
esac

# Every fix leaves a permanent check (3 Oct 2026: the method with the best record is the scripted check, and a bug fixed without one can come back
# unnoticed). A commit whose message says "Fixes #N" (or Closes/Resolves) must also change a test: tests/, desktop/test/, desktop/e2e/test/ or an e2e
# suite step. A fix that truly cannot have one says why in a "No-test: <reason>" line of its message.
untested=""
for sha in $(git -C "$repo" log origin/main..HEAD --no-merges --format='%H' 2>/dev/null); do
  message="$(git -C "$repo" log -1 --format='%B' "$sha")"
  echo "$message" | grep -qiE '\b(fix(es|ed)?|close[sd]?|resolve[sd]?)\b:?[[:space:]]+#[0-9]+' || continue
  echo "$message" | grep -qiE '^No-test:[[:space:]]*[^[:space:]]' && continue
  git -C "$repo" show --name-only --format='' "$sha" | grep -qE '^(tests/|desktop/test/|desktop/e2e/test/|desktop/e2e/suites/)' && continue
  untested="$untested$(git -C "$repo" log -1 --format='%h %s' "$sha")"$'\n'
done
if [ -n "$untested" ]; then
  block "a commit fixes an issue but changes no test (every fix leaves a permanent check):
$(printf '%s' "$untested" | cut -c1-110)
Add the test that would have caught it, or a line 'No-test: <why>' in the commit message."
fi

# Words a push removes from the window that an end-to-end suite still expects (5 Oct 2026: #299 and #300 were suites reporting outdated copy as bugs): update the step in the same change.
# `STALE_EXPECT_OK=1 git push ...` skips it. No node, or no origin/main to compare: skipped.
case "$command" in *STALE_EXPECT_OK=1*) ;; *)
  if command -v node >/dev/null && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
    stale="$(cd "$repo" && timed "stale expectations" node tools/stale-expectations.mjs --base origin/main 2>&1)" || block "$stale"
  fi ;;
esac

# Every workflow starts on the files its tests read (18 Oct 2026: #1443 made a desktop test read src/notion/cron_report.py, its own PR touched only desktop/ so the
# Python suite never started, and main went red). Pure and a couple of seconds, so it runs on every PR; `WORKFLOW_PATHS_OK=1 git push ...` skips it.
# Why (prune audit 3/4, 1 Nov 2026, owner "First 3 rows"): this ONE step holds the whole workflow-paths family: the paths the tests read, the harness.yml reach and the per-workflow
# `tools/replay-files.mjs --check` (#1638, 20 Oct 2026: app-core/src/answer-declarations.js missing opened a PR red) now live in tests/test_workflow_paths.py (TheCheckedPaths), not in a loop of their own here.
case "$command" in *WORKFLOW_PATHS_OK=1*) ;; *)
  if [ -f "$repo/tests/test_workflow_paths.py" ]; then   # a repo without the test (the hook's own fixtures) has nothing to check
    PATH_TESTS="tests.test_workflow_paths tests.test_windows_paths"   # every test that keeps a workflow's paths: complete (#1447 missed the Windows one)
    # shellcheck disable=SC2086
    paths_out="$(cd "$repo" && timed "workflow paths" python3 -m unittest $PATH_TESTS 2>&1)" || block "a workflow's paths: miss a file its tests read (tests/test_workflow_paths.py):
$(echo "$paths_out" | tail -n 15)"
  fi ;;
esac

# The place sorter's real-AI check (tools/places_check.py, ~5 Haiku calls) is not a push check any more (1 Nov 2026, owner, test stages 3-5: 0 pushes blocked in 40 runs, 30 s each, paid AI
# calls): run it by hand when src/ai/place_triage.py or src/sources/feeds.py changes.
# No source file over 500 lines; files already over it may only shrink (tools/file-size.mjs; owner, 8 Oct 2026). Any push, any area.
if command -v node >/dev/null && [ -f "$repo/tools/file-size.mjs" ]; then
  sizes="$(cd "$repo" && timed "file size" node tools/file-size.mjs 2>&1)" || block "a file is too big:
$sizes"
fi
# The commit-message and comment checks run together and list every refusal at once (tools/commit-checks.mjs; prune audit 2/4, owner, 1 Nov 2026): recorded cases (owner, 10 Oct 2026: never fix
# the same website twice), the rung trailer (docs/flows/ladder.md), the Why-changed trailer (27 Oct), new code's comments (27 Oct), a ticked Progress box's proof file, the open e2e issues a suite
# change names (`E2E_ISSUE_OK=1` on the push skips that one) and the E2E-cause trailer (27 Oct). They run BEFORE the journey and ladder gates (owner, 11 Oct 2026: a missing "Rung:" line was
# found only after a 255 s journey gate, three times in one landing): seconds first, minutes last.
if command -v node >/dev/null && [ -f "$repo/tools/commit-checks.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  commit_skip=""
  case "$command" in *E2E_ISSUE_OK=1*) commit_skip="e2e issue links" ;; esac
  commitchecks="$(cd "$repo" && timed "commit checks" node tools/commit-checks.mjs --base origin/main --skip "$commit_skip" 2>&1)" || block "$commitchecks"
fi
# A suite leaves the e2e backbone only by naming the input its result depends on (ai, clock, outside) and why: an entry of desktop/e2e/lanes.json (tools/lanes-check.mjs; spec rule E).
if [ "$ship_push" = 0 ] && command -v node >/dev/null && [ -f "$repo/tools/lanes-check.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  lanes="$(cd "$repo" && timed "lane registry" node tools/lanes-check.mjs --base origin/main 2>&1)" || block "$lanes"
fi
# Rules E/F: expectation edits cite their reason; changed harness modules name their job (push and CI use this same fast gate).
if command -v node >/dev/null && [ -f "$repo/tools/e2e-reliability-check.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  reliability="$(cd "$repo" && timed "e2e reliability" node tools/e2e-reliability-check.mjs --base origin/main 2>&1)" || block "$reliability"
fi
# The renderer class tests (they read every renderer and lib file) run when a push touches those files: a CI red caught in 0.4 s here.
# Why (28 Oct 2026): 10 of the last 34 red desktop-test PR runs that named a file failed in one of these seven (desktop/test/renderer-class-push.test.js); the whole desktop suite on push is 108 s (rule H).
class_tests="test/card-system.test.js test/no-question-mark.test.js test/text-fields.test.js test/solid-buttons.test.js test/roomy-cards.test.js test/mac-words.test.js test/design.test.js"
if [ "$ship_push" = 0 ] && command -v node >/dev/null && [ -d "$repo/desktop/test" ] && git -C "$repo" diff --name-only origin/main...HEAD 2>/dev/null | grep -qE '^desktop/(renderer|lib)/|^desktop/test/text-(buttons|fields)-allowed\.json$'; then
  classes="$(cd "$repo/desktop" && timed "renderer class tests" node --test $class_tests 2>&1)" || block "a renderer class test fails (CI would be red):
$(echo "$classes" | grep -E '^not ok|✖|^# fail' | head -6)"
fi
# New Python code (src/, tools/) over McCabe complexity 15, with an unused import or local, a lambda over a loop variable or a raise in except without `from`
# is refused on the lines a push adds, and an old function the push makes more complex while over the limit (29 Oct 2026) (tools/clean-code-py.py, Ruff pinned; owner, 28 Oct 2026; CI's pr-gate runs this script too).
if command -v python3 >/dev/null && [ -f "$repo/tools/clean-code-py.py" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  cleanpy="$(cd "$repo" && timed "clean code (python)" python3 tools/clean-code-py.py --base origin/main 2>&1)" || block "$cleanpy"
fi
# JS cycles and measured browser/runtime boundaries ratchet against main (owner, 29 Oct 2026); old violations never block.
# Why (1 Nov 2026, owner "Yes, delete Group 1", prune audit pa): 12,394 s of 145,185 s of gate time in 30 days for 6 stops in 1,403 runs; the ship push (SHIP_PR=1) leaves it to the PR's Fast checks
# (CI_GATES=1 runs this script), like the lane registry; CI_GATES=1 and a direct push to main still run it. Guard: tests/test_pre_push_pr.py.
if [ "$ship_push" = 0 ] && command -v python3 >/dev/null && [ -f "$repo/tools/arch-check.py" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  if architecture="$(cd "$repo" && timed "JS architecture" python3 tools/arch-check.py --base origin/main 2>&1)"; then
    [ -z "$architecture" ] || printf '%s\n' "$architecture" >&2
  else
    block "$architecture"
  fi
fi
# A list CI checks against the files it must cover (LOCK_PATHS, red-main CLASSIFIED) fails here in about a second, not ~10 min later on the PR (18 Oct 2026: three PRs red on one missing LOCK_PATHS entry): tools/registry-check.py.
if command -v python3 >/dev/null && [ -f "$repo/tools/registry-check.py" ]; then
  registry="$(cd "$repo" && timed "registry lists" python3 tools/registry-check.py 2>&1)" || block "$registry"
fi
# The Applying scenario matrix is not a push gate any more (owner, 9 Oct 2026): its steps run with every other e2e on CI (apply, applyflows: schedule and beta gate);
# `cd desktop && npm run flows` stays an on-demand check. (8 Oct-9 Oct it blocked pushes that touched FLOW_CORE: one recorded catch in 186 commits, 28 skips.)
# A push to a pull request branch (tools/ship.sh, 12 Oct 2026: `SHIP_PR=1 git push`) stops here: everything above is seconds. The suites, the journey and ladder gates and the
# recorded-page replays run in CI on the PR (.github/workflows/pr-gate.yml, build.yml, page-cases.yml), in parallel, not on this Mac behind the heavy lock.
# CI runs this same script for the pure checks above: CI_GATES=1 (no red-main look, no AI place check). Only the workflow lint stays local.
case "$command" in *SHIP_PR=1*|*CI_GATES=1*)
  if git -C "$repo" diff --name-only origin/main..HEAD 2>/dev/null | grep -q '^\.github/workflows/' && command -v actionlint >/dev/null; then
    lint="$(cd "$repo" && timed "workflow files (actionlint)" workflows_lint 2>&1)" || block "$lint"
  fi
  report_blocks
  exit 0 ;;
esac
report_blocks   # a push to main: every pure check's refusal at once, before the suites
# The journey and ladder gates reuse a pass on exactly the same tree (tools/gate-cache.sh; owner, 11 Oct 2026: a retry that only changed a commit
# message re-ran the 255 s journey gate); a failure is never cached; GATE_CACHE=0 or PUSH_FULL=1 runs them anyway.
# The journey gate (owner, 10 Oct 2026): a push touching a flow file runs the applying scenarios as event sequences (tools/journey-gate.mjs, seconds,
# no browser). Unlike the matrix below it needs no browser, and it runs even when the change is in extension/ only, which the affected-tests pick missed.
# Both gates key their pass on the files they read, not the whole tree (owner, 11 Oct 2026: a push refused because main moved re-ran ~10 min of replay after a rebase
# over commits that touched neither): the extension, the app's lib/tests/e2e/scripts, the worker, the flow docs, the gate tools. Unsure = add the path.
# The extra text is the changed files inside those paths (they decide which parts run). A new reader of a file outside this list: add it (tests/test_gate_order.py).
gate_paths="extension desktop/lib desktop/test desktop/e2e desktop/scripts desktop/package.json desktop/package-lock.json app-core/src docs/flows tools/journey-gate.mjs tools/ladder-gate.mjs"
gate_touched() { git -C "$repo" diff --name-only origin/main..HEAD -- $gate_paths 2>/dev/null | shasum -a 256 | cut -c1-16; }
# The two gates run BESIDE the area suites (owner, 11 Oct 2026: a fresh flow-code push took the lock wait, then the journey gate, then the slowest suite, one after another):
# started with the suites below, collected with them; their whole output is shown when one fails. JP_GATE_SERIAL=1 runs them first, one after the other, as before (said below).
journey_gate() { gate_run journey-gate "journey gate" tools/journey-gate.mjs; }
ladder_gate() { gate_run ladder-gate "ladder gate" tools/ladder-gate.mjs; }
gate_run() {  # cache area, timing name, script: prints the gate's output on stdout, its verdict in the exit code
  (cd "$repo" && GATE_CACHE_PATHS="$gate_paths" timed "$2" gate_cache_run "$repo" "$1" "touched=$(gate_touched)" node "$3" --base origin/main 2>&1)
}
gates_wanted=()
for gate in journey ladder; do   # (the ladder gate runs only with JP_LADDER_GATE=1 or PUSH_FULL=1: 0 pushes blocked in 525 runs, 1 Nov 2026, owner, test stages 3-5; the journey gate's tests: seconds, no browser, plus the recorded-page replay when the extension changed; the ladder gate: docs/flows/ladder.md)
  [ "$gate" = ladder ] && [ -z "${PUSH_FULL_RUN:-}${JP_LADDER_GATE:-}" ] && continue
  if command -v node >/dev/null && [ -f "$repo/tools/$gate-gate.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then gates_wanted+=("$gate"); fi
done
if [ "${JP_GATE_SERIAL:-0}" = 1 ]; then
  [ ${#gates_wanted[@]} -gt 0 ] && echo "pre-push: JP_GATE_SERIAL=1: the journey and ladder gates run before the suites, one after the other" >&2
  for gate in ${gates_wanted[@]+"${gates_wanted[@]}"}; do
    out="$("${gate}_gate")" || { echo "Push blocked: $out" >&2; exit 2; }
    [ -n "$out" ] && echo "$out" >&2
  done
  gates_wanted=()
fi
# Which suites this push needs (AGENTS.md "Change tiers"). `PUSH_FULL=1 git push ...` runs everything (Tier 2). Docs alone run nothing; a path
# this list does not know runs everything. The engine (src/, tests/) also runs desktop: its callers. A clean pip install only when dependencies changed.
changed="$(git -C "$repo" diff --name-only origin/main..HEAD 2>/dev/null)"
want_python=0; want_worker=0; want_desktop=0; want_workflows=0; clean_install=""
if [ -z "$changed" ]; then want_python=1; want_worker=1; want_desktop=1; want_workflows=1; clean_install=--clean-install
else
  while IFS= read -r file; do
    case "$file" in
      *.md|docs/*|LICENSE*|.gitignore|*/.gitignore) ;;
      app-core/*|worker/*) want_worker=1 ;;
      site/*|web/*|admin/*|api/*|shared/*|workers/*|db/*|test/*|jobs/*|media/*|preview/*) ;;   # the site lives in the private repo jobadabra-web: no suite here (1 Nov 2026, test stages 3-5)
      desktop/*|extension/*) want_desktop=1 ;;
      requirements*|pyproject.toml) want_python=1; want_desktop=1; clean_install=--clean-install ;;
      src/*|tests/*) want_python=1; want_desktop=1 ;;
      .github/*) want_workflows=1; want_python=1 ;;   # tests/test_desktop_workflow.py and others read the workflow files (10 Oct 2026: 02021ae went red on one)
      *) want_python=1; want_worker=1; want_desktop=1; want_workflows=1 ;;
    esac
  done <<<"$changed"
fi
case "$command" in *PUSH_FULL=1*) want_python=1; want_worker=1; want_desktop=1; want_workflows=1; clean_install=--clean-install ;; esac
# The e2e harness's own unit tests (cd desktop/e2e && npm test, 72-143 s) are NOT run on a local push any more (owner, 11 Oct 2026: "I want the local e2e run dropped entirely"):
# CI's e2e.yml "plan" job runs all of them on every push. `JP_E2E_UNIT=1 git push ...` (or tools/ship.sh with it set) runs them here when a change to the harness needs the answer now
# (the 10 Oct 2026 move left 19 red); PUSH_FULL=1 does not bring them back.
want_e2e=0
if [ "${JP_E2E_UNIT:-0}" = 1 ] && command -v node >/dev/null && [ -f "$repo/tools/e2e-unit-wanted.mjs" ]; then   # a checkout without the tool (the hook's own test repo) runs none
  if [ -z "$changed" ] || printf '%s\n' "$changed" | node "$repo/tools/e2e-unit-wanted.mjs"; then want_e2e=1; fi
fi

# Why (29 Oct 2026, owner, #2462): a worktree made without the installed folders (a bare git worktree add) ran this gate 437 s, failed in "desktop (clean checkout)" and showed no cause; refused in a second,
# with the way out. Only a linked worktree whose main checkout HAS the folder (a plain repo or the main checkout itself is left to the suites). Guard: tests/test_pre_push_check.py.
common="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"; main="$(dirname "${common:-$repo/.git}")"
if [ -d "$main" ] && [ "$(cd "$main" && pwd -P)" != "$(cd "$repo" && pwd -P)" ]; then
  missing=""
  for dir in desktop app-core; do
    want="want_$dir"; [ "$dir" = app-core ] && want=want_worker   # Why (1 Nov 2026): the suite area is still called worker, its folder is app-core
    [ "${!want}" = 1 ] && [ -d "$main/$dir/node_modules" ] && [ ! -e "$repo/$dir/node_modules" ] && missing="$missing $dir/node_modules"
  done
  [ -z "$missing" ] || { echo "Push blocked: this worktree has no$missing, which the main checkout has: the suites cannot run here. Run tools/link-modules.sh in it (tools/worktree.sh and the post-checkout hook do this for a new worktree), or npm ci there if it is meant to have its own (tools/worktree.sh own-modules), then push again." >&2; exit 2; }
fi
failed=()
log="$(mktemp)"
# Local pushes run only the tests the change can break (tools/affected-tests.py: imports + mentions, "all" when in doubt); CI and
# PUSH_FULL=1 always run everything. Areas run side by side, and at most JOBADABRA_CHECK_SLOTS push checks run on this Mac at once.
affected_flag="--affected-from origin/main"
case "$command" in *PUSH_FULL=1*) affected_flag="" ;; esac
[ -z "$changed" ] && affected_flag=""
git -C "$repo" rev-parse --verify -q origin/main >/dev/null || affected_flag=""
pids=(); names=(); outs=()
# What the affected-tests pick says for every area: part of each cache key, so a rebase that changes which tests a push needs is a miss.
picks=""; [ -n "$affected_flag" ] && picks="$(cd "$repo" && python3 tools/affected-tests.py --base origin/main 2>/dev/null | shasum | cut -c1-16)"
case "$command" in *PUSH_FULL=1*) export GATE_CACHE_FRESH=1 ;; esac
# Tiers by what the change can break (landing-speed, 11 Oct 2026; AGENTS.md "Change tiers"): an area whose affected-tests pick is EMPTY is not started at all
# (a docs, skill or tools-only push no longer pays desktop's stage + lint and a fresh checkout per area). Desktop keeps its lint when a JS file changed.
# `JOBADABRA_TIERS=0` runs every area the path list wants, as before. The journey, ladder and recorded gates above run on their own file lists, not on this.
if [ -n "$affected_flag" ] && [ "${JOBADABRA_TIERS:-1}" != 0 ] && command -v jq >/dev/null; then
  pick_json="$(cd "$repo" && python3 tools/affected-tests.py --base origin/main 2>/dev/null)"
  skipped=""
  for area in python worker desktop; do
    want="want_$area"; [ "${!want}" = 1 ] || continue
    [ "$(jq -r --arg a "$area" '.[$a] | if type == "array" and length == 0 then "empty" else "run" end' <<<"$pick_json" 2>/dev/null)" = empty ] || continue
    [ "$area" = desktop ] && grep -qE '\.(js|mjs|cjs)$' <<<"$changed" && continue
    printf -v "$want" 0; skipped="$skipped $area"
  done
  [ -n "$skipped" ] && echo "pre-push: nothing in$skipped can break from this change (no affected tests): not run (JOBADABRA_TIERS=0 runs them)" >&2
fi
area_whole() {  # 1 when this area runs its WHOLE suite (no affected-test list, a clean install, or the picker says "all"): such a step may be deferred to CI at the budget; a picked list never is
  if [ -z "$affected_flag" ] || [ -n "$clean_install" ] || [ -z "${pick_json:-}" ]; then echo 1; return; fi
  jq -r --arg a "$1" '.[$a] | if . == "all" then 1 else 0 end' <<<"$pick_json" 2>/dev/null || echo 1
}
run() {  # name, then the command: started in the background, collected below
  local name="$1" out; shift; out="$(mktemp)"
  ( cd "$repo" && timed "$name" "$@"; echo $? >"$out.code" ) >"$out" 2>&1 &   # the exit code goes to a file: a finished step is read from it, never `wait`ed for (bash 3.2 forgets children reaped while polling)
  pids+=($!); names+=("$name"); outs+=("$out")
  [ "${DEFER:-0}" = 1 ] && GATE_DEFERRABLE="$GATE_DEFERRABLE $! "
}
# CI-only failure classes the tests can't see:
# - workflow files: actionlint (also shellchecks each run: script; info-level notes are allowed)
workflows() { SHELLCHECK_OPTS='--severity=warning' actionlint .github/workflows/*.yml; }
# - install drift: the pre-push tests run with dev dependencies installed, so CI must install them too, or a
#   test needing one (e.g. esbuild in desktop's pretest) passes here and fails on every CI run.
ci_installs_dev() {
  python3 tools/ci-installs-dev.py .github/workflows/build.yml   # the replays' own runtime-only install (id: replay-install) is exempt
}
e2e_npm_test() { (cd desktop/e2e && npm test); }
e2e_unit() {
  [ -d desktop/e2e/node_modules ] || { echo "pre-push: desktop/e2e/node_modules is missing: the e2e unit tests were not run (npm ci there, or tools/worktree.sh links them)"; return 0; }
  gate_cache_run "$repo" e2e-unit "" e2e_npm_test
}
# The suites run on exactly what is pushed, each area in its own fresh checkout of HEAD, as CI does: a forgotten file or a git-ignored
# file left by another area's run (5 Oct 2026: desktop/shared/ from a desktop run let the worker's tests pass here, fa1f838 went red in CI and
# blocked every session) fails here, not on main. Dependencies are linked from this checkout (same lockfiles; --clean-install verifies them).
# The checkouts are made and removed one at a time, outside the parallel runs: git's worktree add and remove race on .git/worktrees
# ("fatal: failed to read .git/worktrees/worker/commondir", 1 in ~40 pushes on 9 Oct 2026, which blocked a push with no reason shown).
trees=()
add_tree() {  # area: its fresh checkout, named in tree_<area> (empty when git could not make it)
  local tree; tree="$(mktemp -d)/$1"
  if git -C "$repo" worktree add -q --detach "$tree" HEAD; then trees+=("$tree"); printf -v "tree_$1" '%s' "$tree"; fi
}
verify_area() {  # area [extra check.sh flags]
  local area="$1"; shift
  local name="tree_$area"; local tree="${!name:-}"
  [ -n "$tree" ] || { echo "fatal: git could not make a clean checkout for $area"; return 1; }
  # Why (29 Oct 2026, fresh review of the link fix): the post-checkout hook has already linked the main checkout's folders (desktop, desktop/e2e, app-core) into this clean checkout; `ln -s` onto such a link would add a link INSIDE the shared folder.
  # The pushing checkout's own folders win (a worktree with its own install after `worktree.sh own-modules`), so a link the hook made is replaced, never added to. Guard: tests/test_pre_push_check.py.
  for dir in desktop desktop/e2e app-core; do
    [ -L "$tree/$dir/node_modules" ] && rm "$tree/$dir/node_modules"
    [ -e "$repo/$dir/node_modules" ] && ln -s "$repo/$dir/node_modules" "$tree/$dir/node_modules"
  done
  [ -L "$tree/.venv" ] && rm "$tree/.venv"
  [ -e "$repo/.venv" ] && ln -s "$repo/.venv" "$tree/.venv"
  (cd "$tree" && gate_cache_run "$repo" "$area" "flag=$affected_flag args=$* pick=$picks" bash tools/check.sh --area "$area" $affected_flag "$@")
}
source "$repo/tools/check-slot.sh" 2>/dev/null || { slot_acquire() { :; }; slot_release() { :; }; }
case "$command" in *CI_RED_OK=1*) export JOBADABRA_RED_FIX=1 ;; esac   # the fix of a red main does not wait for a slot (tools/check-slot.sh)
slot_acquire
if [ "$want_workflows" = 1 ]; then
  run "CI installs dev dependencies (build.yml)" ci_installs_dev
  if command -v actionlint >/dev/null; then run "workflow files (actionlint)" workflows
  else echo "pre-push: actionlint not installed (brew install actionlint); workflow files not checked" >&2; fi
fi
for area in python worker desktop; do
  want="want_$area"; [ "${!want}" = 1 ] && add_tree "$area"
done
gate_pids=()
for gate in ${gates_wanted[@]+"${gates_wanted[@]}"}; do   # first: they are the longest, and wait for the heavy lock on their own
  out="$(mktemp)"; ( "${gate}_gate"; echo $? >"$out.code" ) >"$out" 2>&1 & gate_pids+=($!); gate_outs+=("$out"); gate_names+=("$gate"); GATE_DEFERRABLE="$GATE_DEFERRABLE $! "
done
[ "$want_python" = 1 ] && DEFER="$(area_whole python)" run "python (clean checkout)" verify_area python $clean_install
[ "$want_worker" = 1 ] && DEFER="$(area_whole worker)" run "worker (clean checkout)" verify_area worker
[ "$want_desktop" = 1 ] && DEFER="$(area_whole desktop)" run "desktop (clean checkout)" verify_area desktop
[ "$want_e2e" = 1 ] && run "e2e unit tests (desktop/e2e npm test, as CI)" e2e_unit
watch=(); for i in "${!pids[@]}"; do watch+=("${pids[$i]}:${outs[$i]}.code"); done
for i in "${!gate_pids[@]}"; do watch+=("${gate_pids[$i]}:${gate_outs[$i]}.code"); done
gate_wait_budget ${watch[@]+"${watch[@]}"}   # the budget's watchdog: a deferrable step still running at ~55 s is stopped and reported
deferred_names=""
for i in "${!pids[@]}"; do
  if gate_was_deferred "${pids[$i]}"; then deferred_names="$deferred_names${deferred_names:+, }${names[$i]}"; rm -f "${outs[$i]}" "${outs[$i]}.code"; continue; fi
  [ "$(cat "${outs[$i]}.code" 2>/dev/null || echo 1)" = 0 ] || failed+=("${names[$i]}")
  cat "${outs[$i]}" >>"$log"; rm -f "${outs[$i]}" "${outs[$i]}.code"
done
for ((i = 0; i < ${#gate_pids[@]}; i++)); do
  if gate_was_deferred "${gate_pids[$i]}"; then
    deferred_names="$deferred_names${deferred_names:+, }the ${gate_names[$i]} gate$(grep -q 'passed in' "${gate_outs[$i]}" 2>/dev/null && echo ' (its tests passed; the replay was cut)')"; rm -f "${gate_outs[$i]}" "${gate_outs[$i]}.code"; continue
  fi
  if [ "$(cat "${gate_outs[$i]}.code" 2>/dev/null || echo 1)" = 0 ]; then [ -s "${gate_outs[$i]}" ] && cat "${gate_outs[$i]}" >&2
  else { echo "Push blocked: the ${gate_names[$i]} gate failed:"; cat "${gate_outs[$i]}"; } >&2; gate_failed=1; fi
  rm -f "${gate_outs[$i]}" "${gate_outs[$i]}.code"
done
[ -n "$deferred_names" ] && echo "pre-push: DEFERRED TO CI (still running at the $(gate_budget) s budget, not failed, not dropped): $deferred_names. CI runs them on main (build.yml suites, page-cases.yml replays); JP_GATE_FULL=1 runs them here." >&2
slot_release
for tree in ${trees[@]+"${trees[@]}"}; do
  git -C "$repo" worktree remove --force "$tree" >/dev/null 2>&1 || rm -rf "$tree"
done
git -C "$repo" worktree prune 2>/dev/null

if [ -n "${gate_failed:-}" ] && [ ${#failed[@]} -eq 0 ]; then rm -f "$log"; exit 2; fi
if [ ${#failed[@]} -gt 0 ]; then
  {
    echo "Push blocked: tests failed in ${failed[*]} ($repo)."
    echo "Fix them, then push again. Last lines of the test output:"
    grep -E "^FAIL:|^ERROR:|AssertionError|^not ok|npm ERR|npm error|\.yml:[0-9]+:[0-9]+:|^fatal:|Cannot find module|ERR_MODULE_NOT_FOUND" "$log" | sort -u | tail -15   # the last two: a suite that dies on a missing package (29 Oct 2026, #2462)
  } >&2
  rm -f "$log"
  exit 2
fi
rm -f "$log"
exit 0
