#!/usr/bin/env bash
# Claude Code PreToolUse hook (.claude/settings.json): before any `git push` from this repo (or one of its
# worktrees), run every test suite CI runs on a clean checkout of what is pushed, and block the push if one fails, so only green builds reach
# GitHub. Reads the hook's JSON on stdin; exit 2 blocks the command and shows the reason to Claude.
#   python: unittest, normally and as CI sees it (no Notion/Telegram/Google/SerpApi credentials)
#   worker, site: npm test  desktop: npm test (npm ci first when node_modules is missing)
# Runs only the suites the push touches (AGENTS.md "Change tiers"; PUSH_FULL=1 for all). Also blocks a push on top of a red CI build on main
# (not one that was only cancelled), and a build.yml that installs without dev dependencies.
set -uo pipefail
source "$(dirname "$0")/gate-timing.sh" 2>/dev/null || { gate_timing_start() { :; }; timed() { shift; "$@"; }; gate_summary() { :; }; }
gate_timing_start
workflows_lint() { SHELLCHECK_OPTS='--severity=warning' actionlint .github/workflows/*.yml; }
GATE_DEFERRABLE=""; GATE_DEFERRED=""
source "$(dirname "$0")/gate-watchdog.sh" 2>/dev/null || { gate_budget() { echo 0; }; gate_wait_budget() { wait; }; gate_was_deferred() { return 1; }; }
source "$(dirname "$0")/gate-cache.sh" 2>/dev/null || gate_cache_run() { shift 3; "$@"; }   # a checkout without it (the hook's own test repo) runs everything
export GATE_CACHE_NOTES="$(mktemp)"
trap 'type slot_release >/dev/null 2>&1 && slot_release; [ -s "$GATE_CACHE_NOTES" ] && cat "$GATE_CACHE_NOTES" >&2; rm -f "$GATE_CACHE_NOTES"; gate_summary' EXIT   # one EXIT trap: the slot is freed and the timing printed on every way out

input="$(cat)"
command="$(jq -r '.tool_input.command // ""' <<<"$input")"
case "$command" in *PUSH_FULL=1*) PUSH_FULL_RUN=1 ;; esac   # a full run has no watchdog (tools/gate-watchdog.sh)
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
[ -f "$repo/src/daily.py" ] && [ -d "$repo/worker" ] || exit 0   # only this project

# Don't stack commits on a red main: when main's state (tools/red-main.sh: the newest commit with a finished verdict, a failed job in a running build counts) is red, block the push unless the
# command says it is the fix or a revert: `CI_RED_OK=1 git push ...`. A fix still building does NOT let others through (11 Oct 2026: four landings went in on top of a fix attempt that ended red):
# main is green again only when a later commit's run has completed green. No gh or no network: skip. The first session to meet a red main unblocks everyone (AGENTS.md "Red main").
# A push to a pull request branch (SHIP_PR=1) never waits: the PR's own required checks guard main (12 Oct 2026: red-main flakes stopped three PR landings).
case "$command" in *CI_RED_OK=1*|*CI_GATES=1*|*SHIP_PR=1*) ;; *)
  if [ "${SHIP_IGNORE_RED:-}" != 1 ] && [ -f "$repo/tools/red-main.sh" ]; then
    state="$(bash "$repo/tools/red-main.sh" 2>/dev/null)" || true
    case "$state" in red*)
      IFS="|" read -r _ bad workflow url finished run_id <<<"$state"
      # One clear line first: which run, which commit, who wrote it (no gh api, no daemon: the commit is in this clone after the gate's fetch).
      culprit="$(git -C "$repo" log -1 --format='"%s" by %an' "$bad" 2>/dev/null)"
      {
        echo "Push blocked: main is RED: run ${run_id:-?} failed at $bad, ${culprit:-commit not in this clone} ($url)."
        echo "CI '$workflow' on main is red (finished $finished)."
        echo "Unblock it now, you are not waiting for its author (AGENTS.md \"Red main\"):"
        echo "  1. See why: gh run view --log-failed ${run_id:-?}"
        echo "  2. A small, obvious fix (missing file, import, test expectation): fix it forward, push it with CI_RED_OK=1 git push ... (tools/ship.sh --fix)"
        echo "  3. Otherwise: git revert --no-edit $bad (a new commit, never a force-push), push it with CI_RED_OK=1, and tell the user what was reverted (tools/revert-red.sh)."
        echo "  Then push your own work normally. A fix still building does not unblock anyone: main is green when a later run has completed green. Never just add commits on top of a red build."
      } >&2
      exit 2 ;;
    esac
  fi ;;
esac

# Commit subjects: one line, at most 72 characters (AGENTS.md → Commit messages). Checks the commits this push adds on top of
# origin/main, merges aside; `COMMIT_LONG_OK=1 git push ...` skips it (a pushed commit is never rewritten to satisfy this).
case "$command" in *COMMIT_LONG_OK=1*) ;; *)
  long="$(git -C "$repo" log origin/main..HEAD --no-merges --format='%h %s' 2>/dev/null | awk '{ s=$0; sub(/^[^ ]+ /, "", s); if (length(s) > 72) print $0 }')"
  if [ -n "$long" ]; then
    echo "Push blocked: commit subject over 72 characters (details go in the body, no versions or reasons in the subject):" >&2
    echo "$long" | cut -c1-110 >&2
    echo "Shorten your own unpushed commits: git commit --amend (last one). If the amend is denied, push it as it is:" \
      "COMMIT_LONG_OK=1 git push ... (never rewrite a pushed commit for this)." >&2
    exit 2
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
  echo "Push blocked: a commit fixes an issue but changes no test (every fix leaves a permanent check):" >&2
  printf '%s' "$untested" | cut -c1-110 >&2
  echo "Add the test that would have caught it, or a line 'No-test: <why>' in the commit message." >&2
  exit 2
fi

# Words a push removes from the window that an end-to-end suite still expects (5 Oct 2026: #299 and #300 were suites reporting outdated copy as bugs): update the step in the same change.
# `STALE_EXPECT_OK=1 git push ...` skips it. No node, or no origin/main to compare: skipped.
case "$command" in *STALE_EXPECT_OK=1*) ;; *)
  if command -v node >/dev/null && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
    stale="$(cd "$repo" && timed "stale expectations" node tools/stale-expectations.mjs --base origin/main 2>&1)" || { echo "Push blocked: $stale" >&2; exit 2; }
  fi ;;
esac

# Every workflow starts on the files its tests read (18 Oct 2026: #1443 made a desktop test read src/notion/cron_report.py, its own PR touched only desktop/ so the
# Python suite never started, and main went red). Pure and under a second, so it runs on every PR; `WORKFLOW_PATHS_OK=1 git push ...` skips it.
case "$command" in *WORKFLOW_PATHS_OK=1*) ;; *)
  if [ -f "$repo/tests/test_workflow_paths.py" ]; then   # a repo without the test (the hook's own fixtures) has nothing to check
    PATH_TESTS="tests.test_workflow_paths tests.test_windows_paths"   # every test that keeps a workflow's paths: complete (#1447 missed the Windows one)
    # shellcheck disable=SC2086
    paths_out="$(cd "$repo" && timed "workflow paths" python3 -m unittest $PATH_TESTS 2>&1)" || {
      echo "Push blocked: a workflow's paths: miss a file its tests read (tests/test_workflow_paths.py):" >&2
      echo "$paths_out" | tail -n 15 >&2
      exit 2
    }
  fi ;;
esac

# The place sorter, checked with real AI answers when its code changes (7 Oct 2026: two of the day's place bugs were the real model's answers, which
# unit tests fake): tools/places_check.py, ~5 Haiku calls. `PLACES_CHECK_OK=1 git push ...` skips it (say why in the commit). No AI here: skipped, said.
case "$command" in *PLACES_CHECK_OK=1*|*CI_GATES=1*) ;; *)
  if git -C "$repo" rev-parse --verify -q origin/main >/dev/null && git -C "$repo" diff --name-only origin/main...HEAD | grep -qE '^src/(ai/place_triage|sources/feeds)\.py$'; then
    if command -v claude >/dev/null || [ -n "${ANTHROPIC_API_KEY:-}" ]; then
      engine="$([ -n "${ANTHROPIC_API_KEY:-}" ] && echo api || echo cli)"
      checked="$(cd "$repo" && JOB_PILOTTO_FOLLOW_APP=0 JOB_PILOTTO_AI_ENGINE="$engine" timed "places check (real AI)" python3 tools/places_check.py 2>&1)" \
        || { echo "Push blocked: the place sorter answered wrongly with real AI calls, or could not ask (tools/places_check.py):" >&2; echo "$checked" | grep -v '^⏳' | tail -25 >&2; exit 2; }
    else
      echo "Note: the place code changed but no AI is available here (no claude, no ANTHROPIC_API_KEY): tools/places_check.py skipped" >&2
    fi
  fi ;;
esac

# A new e2e step must have been seen passing (6 Oct 2026: one that never had failed the 0.5.8 beta gate on its own premise): a local run of it, or an
# "E2E-passed: <run url>" / "E2E-unverified: <why>" line in a commit message (tools/new-e2e-steps.mjs). No node, or no origin/main: skipped.
if ! [[ "$command" == *CI_GATES=1* ]] && command -v node >/dev/null && [ -f "$repo/tools/new-e2e-steps.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then   # CI has no local run to find: the commit message's E2E-passed line is read by the CI-less gate only
  unseen="$(cd "$repo" && timed "new e2e steps" node tools/new-e2e-steps.mjs --base origin/main 2>&1)" || { echo "Push blocked: $unseen" >&2; exit 2; }
fi

# No source file over 500 lines; files already over it may only shrink (tools/file-size.mjs; owner, 8 Oct 2026). Any push, any area.
if command -v node >/dev/null && [ -f "$repo/tools/file-size.mjs" ]; then
  sizes="$(cd "$repo" && timed "file size" node tools/file-size.mjs 2>&1)" || { echo "Push blocked: a file is too big:
$sizes" >&2; exit 2; }
fi
# A new harness test file must be in desktop/e2e/test-sets.json ("pr" or "daily"), or CI's harness tests fail on it (26 Oct 2026: #1976 went red on coverage.test.mjs).
# The same pure test CI runs, a fraction of a second. Any push that touches desktop/e2e/test.
if command -v node >/dev/null && [ -f "$repo/desktop/e2e/test/test-sets.test.mjs" ] && git -C "$repo" diff --name-only origin/main...HEAD 2>/dev/null | grep -q '^desktop/e2e/test'; then
  sets="$(cd "$repo/desktop/e2e" && timed "harness test sets" node --test test/test-sets.test.mjs 2>&1)" || { echo "Push blocked: a harness test file is in no set (or a set names a missing file): add it to desktop/e2e/test-sets.json
$(echo "$sets" | grep -E 'in no set|missing|actual' | head -5)" >&2; exit 2; }
fi
# A new file a replay workflow loads must be in that workflow's `pull_request` paths (20 Oct 2026: #1638 opened red on "control tests" and "page cases" because worker/src/answer-declarations.js was
# missing): the same check the workflows run (tools/replay-files.mjs --check), seconds, before the PR exists. Any push, any area.
if command -v node >/dev/null && [ -f "$repo/tools/replay-files.mjs" ]; then
  for wf in $(cd "$repo" && node tools/replay-files.mjs --workflows); do   # the one list (WORKFLOW_JOB): control-tests.yml left PRs on 26 Oct 2026 and this loop still checked it
    [ -f "$repo/.github/workflows/$wf" ] || continue
    drift="$(cd "$repo" && timed "workflow paths $wf" node tools/replay-files.mjs --check "$wf" 2>&1)" || { echo "Push blocked: $drift" >&2; exit 2; }
  done
fi
# The cheap checks on commit messages run BEFORE the journey and ladder gates (owner, 11 Oct 2026: a missing "Rung:" line was found only after a
# 255 s journey gate, three times in one landing): seconds first, minutes last.
# Never fix the same website twice (owner, 10 Oct 2026): a push changing how the extension acts on pages brings its recorded page (desktop/e2e/recorded) or
# journey scenario, or a commit says "Recorded-unneeded: <why>" (tools/recorded-cases.mjs).
if command -v node >/dev/null && [ -f "$repo/tools/recorded-cases.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  cases="$(cd "$repo" && timed "recorded cases" node tools/recorded-cases.mjs --base origin/main 2>&1)" || { echo "Push blocked: $cases" >&2; exit 2; }
fi
# A fix for a bug the owner saw is proven on his own page (owner, 16 Oct 2026): "Owner-report: <id>" and a captured case with that report id (tools/owner-report.mjs).
if command -v node >/dev/null && [ -f "$repo/tools/owner-report.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  ownerrep="$(cd "$repo" && timed "owner report" node tools/owner-report.mjs --base origin/main 2>&1)" || { echo "Push blocked: $ownerrep" >&2; exit 2; }
fi
# The rung trailer (docs/flows/ladder.md): a push touching the ladder's flow code carries "Rung: <0-6|router|judges>" and "Fixture: <id | none: why>" in a commit message (tools/rung-trailer.mjs).
if command -v node >/dev/null && [ -f "$repo/tools/rung-trailer.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  trailer="$(cd "$repo" && timed "rung trailer" node tools/rung-trailer.mjs --base origin/main 2>&1)" || { echo "Push blocked: $trailer" >&2; exit 2; }
fi
# A line guarded by a "Why (<PR or date>): <reason>" comment changes only on purpose: "Why-changed: <which> — <reason>" in a commit message (tools/why-changed.mjs; owner, 27 Oct 2026).
if command -v node >/dev/null && [ -f "$repo/tools/why-changed.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  whychanged="$(cd "$repo" && timed "why comments" node tools/why-changed.mjs --base origin/main 2>&1)" || { echo "Push blocked: $whychanged" >&2; exit 2; }
fi
# New code's comments: a new exported function has a doc comment; a debt note reads "TODO(AI): <what> (<date or #PR>)" or "FIXME: <what>" (tools/new-code-comments.mjs; owner, 27 Oct 2026).
if command -v node >/dev/null && [ -f "$repo/tools/new-code-comments.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  newcomments="$(cd "$repo" && timed "new code comments" node tools/new-code-comments.mjs --base origin/main 2>&1)" || { echo "Push blocked: $newcomments" >&2; exit 2; }
fi
# A suite leaves the e2e backbone only by naming the input its result depends on (ai, clock, outside) and why: an entry of desktop/e2e/lanes.json (tools/lanes-check.mjs; spec rule E).
if command -v node >/dev/null && [ -f "$repo/tools/lanes-check.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  lanes="$(cd "$repo" && timed "lane registry" node tools/lanes-check.mjs --base origin/main 2>&1)" || { echo "Push blocked: $lanes" >&2; exit 2; }
fi
# The renderer class tests (they read every renderer and lib file) run when a push touches those files: a CI red caught in 0.4 s here.
# Why (28 Oct 2026): 10 of the last 34 red desktop-test PR runs that named a file failed in one of these seven (desktop/test/renderer-class-push.test.js); the whole desktop suite on push is 108 s (rule H).
class_tests="test/card-system.test.js test/no-question-mark.test.js test/text-fields.test.js test/solid-buttons.test.js test/roomy-cards.test.js test/mac-words.test.js test/design.test.js"
if command -v node >/dev/null && [ -d "$repo/desktop/test" ] && git -C "$repo" diff --name-only origin/main...HEAD 2>/dev/null | grep -qE '^desktop/(renderer|lib)/|^desktop/test/text-(buttons|fields)-allowed\.json$'; then
  classes="$(cd "$repo/desktop" && timed "renderer class tests" node --test $class_tests 2>&1)" || { echo "Push blocked: a renderer class test fails (CI would be red):
$(echo "$classes" | grep -E '^not ok|✖|^# fail' | head -6)" >&2; exit 2; }
fi
# A changed AI prompt brings the case it fixed into its fixed case set (tools/prompt-cases.json), or a commit says "Prompt-case: none <why>" (tools/prompt-cases.mjs; owner, 27 Oct 2026).
if command -v node >/dev/null && [ -f "$repo/tools/prompt-cases.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  promptcases="$(cd "$repo" && timed "prompt cases" node tools/prompt-cases.mjs --base origin/main 2>&1)" || { echo "Push blocked: $promptcases" >&2; exit 2; }
fi
# A Progress box a pull request ticks names its proof file, and the pull request contains it (or names the commit on main that changed it): tools/spec-proof.mjs.
if command -v node >/dev/null && [ -f "$repo/tools/spec-proof.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  proof="$(cd "$repo" && timed "spec proof" node tools/spec-proof.mjs --base origin/main 2>&1)" || { echo "Push blocked: $proof" >&2; exit 2; }
fi
# A list CI checks against the files it must cover (LOCK_PATHS, red-main CLASSIFIED) fails here in about a second, not ~10 min later on the PR (18 Oct 2026: three PRs red on one missing LOCK_PATHS entry): tools/registry-check.py.
if command -v python3 >/dev/null && [ -f "$repo/tools/registry-check.py" ]; then
  registry="$(cd "$repo" && timed "registry lists" python3 tools/registry-check.py 2>&1)" || { echo "Push blocked: $registry" >&2; exit 2; }
fi
# The Applying scenario matrix is not a push gate any more (owner, 9 Oct 2026): its steps run with every other e2e on CI (apply, applyflows: schedule and beta gate);
# `cd desktop && npm run flows` stays an on-demand check. (8 Oct-9 Oct it blocked pushes that touched FLOW_CORE: one recorded catch in 186 commits, 28 skips.)
# A push that changes an e2e suite names the open failed-step issues of that suite (6 Oct 2026: #310 and #315 were fixed in the test by commits that never named them,
# and were diagnosed again from scratch): "Fixes #N", "Refs #N" or "E2E-issue: none <why>" (tools/e2e-issue-links.mjs). `E2E_ISSUE_OK=1` on the push skips it.
case "$command" in *E2E_ISSUE_OK=1*) ;; *)
  if command -v node >/dev/null && [ -f "$repo/tools/e2e-issue-links.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
    links="$(cd "$repo" && timed "e2e issue links" node tools/e2e-issue-links.mjs --base origin/main 2>&1)" || { echo "Push blocked: $links" >&2; exit 2; }
  fi ;;
esac
# A push that changes an e2e suite or its lib says why the suite was red, in /admin/operations/e2e's words (owner, 27 Oct 2026: "let's improve the process"; the page
# could only guess drift, test bug or product bug from a fix): "E2E-cause: <cause> [suites]" or "E2E-cause: none <why>" (tools/e2e-cause-trailer.mjs).
if command -v node >/dev/null && [ -f "$repo/tools/e2e-cause-trailer.mjs" ] && git -C "$repo" rev-parse --verify -q origin/main >/dev/null; then
  ecause="$(cd "$repo" && timed "e2e cause trailer" node tools/e2e-cause-trailer.mjs --base origin/main 2>&1)" || { echo "Push blocked: $ecause" >&2; exit 2; }
fi
# A push to a pull request branch (tools/ship.sh, 12 Oct 2026: `SHIP_PR=1 git push`) stops here: everything above is seconds. The suites, the journey and ladder gates and the
# recorded-page replays run in CI on the PR (.github/workflows/pr-gate.yml, build.yml, page-cases.yml), in parallel, not on this Mac behind the heavy lock.
# CI runs this same script for the pure checks above: CI_GATES=1 (no red-main look, no AI place check, no local-run proof of new e2e steps). Only the workflow lint stays local.
case "$command" in *SHIP_PR=1*|*CI_GATES=1*)
  if git -C "$repo" diff --name-only origin/main..HEAD 2>/dev/null | grep -q '^\.github/workflows/' && command -v actionlint >/dev/null; then
    lint="$(cd "$repo" && timed "workflow files (actionlint)" workflows_lint 2>&1)" || { echo "Push blocked: $lint" >&2; exit 2; }
  fi
  exit 0 ;;
esac
# The journey and ladder gates reuse a pass on exactly the same tree (tools/gate-cache.sh; owner, 11 Oct 2026: a retry that only changed a commit
# message re-ran the 255 s journey gate); a failure is never cached; GATE_CACHE=0 or PUSH_FULL=1 runs them anyway.
# The journey gate (owner, 10 Oct 2026): a push touching a flow file runs the applying scenarios as event sequences (tools/journey-gate.mjs, seconds,
# no browser). Unlike the matrix below it needs no browser, and it runs even when the change is in extension/ only, which the affected-tests pick missed.
# Both gates key their pass on the files they read, not the whole tree (owner, 11 Oct 2026: a push refused because main moved re-ran ~10 min of replay after a rebase
# over commits that touched neither): the extension, the app's lib/tests/e2e/scripts, the worker, the flow docs, the gate tools. Unsure = add the path.
# The extra text is the changed files inside those paths (they decide which parts run). A new reader of a file outside this list: add it (tests/test_gate_order.py).
gate_paths="extension desktop/lib desktop/test desktop/e2e desktop/scripts desktop/package.json desktop/package-lock.json worker/src docs/flows tools/journey-gate.mjs tools/ladder-gate.mjs"
gate_touched() { git -C "$repo" diff --name-only origin/main..HEAD -- $gate_paths 2>/dev/null | shasum -a 256 | cut -c1-16; }
# The two gates run BESIDE the area suites (owner, 11 Oct 2026: a fresh flow-code push took the lock wait, then the journey gate, then the slowest suite, one after another):
# started with the suites below, collected with them; their whole output is shown when one fails. JP_GATE_SERIAL=1 runs them first, one after the other, as before (said below).
journey_gate() { gate_run journey-gate "journey gate" tools/journey-gate.mjs; }
ladder_gate() { gate_run ladder-gate "ladder gate" tools/ladder-gate.mjs; }
gate_run() {  # cache area, timing name, script: prints the gate's output on stdout, its verdict in the exit code
  (cd "$repo" && GATE_CACHE_PATHS="$gate_paths" timed "$2" gate_cache_run "$repo" "$1" "touched=$(gate_touched)" node "$3" --base origin/main 2>&1)
}
gates_wanted=()
for gate in journey ladder; do   # (the journey gate's tests: seconds, no browser, plus the recorded-page replay when the extension changed; the ladder gate: docs/flows/ladder.md)
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
want_python=0; want_worker=0; want_site=0; want_desktop=0; want_workflows=0; clean_install=""
if [ -z "$changed" ]; then want_python=1; want_worker=1; want_site=1; want_desktop=1; want_workflows=1; clean_install=--clean-install
else
  while IFS= read -r file; do
    case "$file" in
      *.md|docs/*|LICENSE*|.gitignore|*/.gitignore) ;;
      worker/*) want_worker=1 ;;
      site/*|web/*|admin/*|api/*|shared/*|workers/*|db/*|test/*|jobs/*|media/*|preview/*) want_site=1 ;;
      desktop/*|extension/*) want_desktop=1 ;;
      requirements*|pyproject.toml) want_python=1; want_desktop=1; clean_install=--clean-install ;;
      src/*|tests/*) want_python=1; want_desktop=1 ;;
      .github/*) want_workflows=1; want_python=1 ;;   # tests/test_desktop_workflow.py and others read the workflow files (10 Oct 2026: 02021ae went red on one)
      *) want_python=1; want_worker=1; want_site=1; want_desktop=1; want_workflows=1 ;;
    esac
  done <<<"$changed"
fi
case "$command" in *PUSH_FULL=1*) want_python=1; want_worker=1; want_site=1; want_desktop=1; want_workflows=1; clean_install=--clean-install ;; esac
# The e2e harness's own unit tests (cd desktop/e2e && npm test, 72-143 s) are NOT run on a local push any more (owner, 11 Oct 2026: "I want the local e2e run dropped entirely"):
# CI's e2e.yml "plan" job runs all of them on every push. `JP_E2E_UNIT=1 git push ...` (or tools/ship.sh with it set) runs them here when a change to the harness needs the answer now
# (the 10 Oct 2026 move left 19 red); PUSH_FULL=1 does not bring them back.
want_e2e=0
if [ "${JP_E2E_UNIT:-0}" = 1 ] && command -v node >/dev/null && [ -f "$repo/tools/e2e-unit-wanted.mjs" ]; then   # a checkout without the tool (the hook's own test repo) runs none
  if [ -z "$changed" ] || printf '%s\n' "$changed" | node "$repo/tools/e2e-unit-wanted.mjs"; then want_e2e=1; fi
fi

failed=()
log="$(mktemp)"
# Local pushes run only the tests the change can break (tools/affected-tests.py: imports + mentions, "all" when in doubt); CI and
# PUSH_FULL=1 always run everything. Areas run side by side, and at most JOB_PILOTTO_CHECK_SLOTS push checks run on this Mac at once.
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
# `JOB_PILOTTO_TIERS=0` runs every area the path list wants, as before. The journey, ladder and recorded gates above run on their own file lists, not on this.
if [ -n "$affected_flag" ] && [ "${JOB_PILOTTO_TIERS:-1}" != 0 ] && command -v jq >/dev/null; then
  pick_json="$(cd "$repo" && python3 tools/affected-tests.py --base origin/main 2>/dev/null)"
  skipped=""
  for area in python worker site desktop; do
    want="want_$area"; [ "${!want}" = 1 ] || continue
    [ "$(jq -r --arg a "$area" '.[$a] | if type == "array" and length == 0 then "empty" else "run" end' <<<"$pick_json" 2>/dev/null)" = empty ] || continue
    [ "$area" = desktop ] && grep -qE '\.(js|mjs|cjs)$' <<<"$changed" && continue
    printf -v "$want" 0; skipped="$skipped $area"
  done
  [ -n "$skipped" ] && echo "pre-push: nothing in$skipped can break from this change (no affected tests): not run (JOB_PILOTTO_TIERS=0 runs them)" >&2
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
  if [ "$area" = site ] && [ ! -d "$repo/admin" ]; then echo "site: lives in the private repo jobadabra-web (docs/rules/private-site.md): skipped here"; return 0; fi
  [ -n "$tree" ] || { echo "fatal: git could not make a clean checkout for $area"; return 1; }
  for dir in desktop desktop/e2e worker; do
    [ -e "$repo/$dir/node_modules" ] && ln -s "$repo/$dir/node_modules" "$tree/$dir/node_modules"
  done
  [ -e "$repo/.venv" ] && ln -s "$repo/.venv" "$tree/.venv"
  (cd "$tree" && gate_cache_run "$repo" "$area" "flag=$affected_flag args=$* pick=$picks" bash tools/check.sh --area "$area" $affected_flag "$@")
}
source "$repo/tools/check-slot.sh" 2>/dev/null || { slot_acquire() { :; }; slot_release() { :; }; }
case "$command" in *CI_RED_OK=1*) export JOB_PILOTTO_RED_FIX=1 ;; esac   # the fix of a red main does not wait for a slot (tools/check-slot.sh)
slot_acquire
if [ "$want_workflows" = 1 ]; then
  run "CI installs dev dependencies (build.yml)" ci_installs_dev
  if command -v actionlint >/dev/null; then run "workflow files (actionlint)" workflows
  else echo "pre-push: actionlint not installed (brew install actionlint); workflow files not checked" >&2; fi
fi
for area in python worker site desktop; do
  want="want_$area"; [ "${!want}" = 1 ] && add_tree "$area"
done
gate_pids=()
for gate in ${gates_wanted[@]+"${gates_wanted[@]}"}; do   # first: they are the longest, and wait for the heavy lock on their own
  out="$(mktemp)"; ( "${gate}_gate"; echo $? >"$out.code" ) >"$out" 2>&1 & gate_pids+=($!); gate_outs+=("$out"); gate_names+=("$gate"); GATE_DEFERRABLE="$GATE_DEFERRABLE $! "
done
[ "$want_python" = 1 ] && DEFER="$(area_whole python)" run "python (clean checkout)" verify_area python $clean_install
[ "$want_worker" = 1 ] && DEFER="$(area_whole worker)" run "worker (clean checkout)" verify_area worker
[ "$want_site" = 1 ] && DEFER="$(area_whole site)" run "site (clean checkout)" verify_area site
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
    grep -E "^FAIL:|^ERROR:|AssertionError|^not ok|npm ERR|npm error|\.yml:[0-9]+:[0-9]+:|^fatal:" "$log" | sort -u | tail -15
  } >&2
  rm -f "$log"
  exit 2
fi
rm -f "$log"
exit 0
