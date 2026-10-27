# Source it from tools/ship.sh: land the branch through a pull request with auto-merge instead of pushing to main (owner, 12 Oct 2026).
# Guarded by tests/test_ship_pr.py (a fake gh: tests/fake_gh.py). The checks that must pass run in CI on the PR (.github/workflows/pr-gate.yml, build.yml, page-cases.yml);
# the local push hook runs only its fast pure checks (SHIP_PR=1 in tools/pre-push-check.sh).
#   ship_mode                 prints pr (origin is on GitHub and gh answers: main takes pull requests only) or direct (any other origin: the old push to main); SHIP_MODE=pr|direct forces one
#   ship_review               true while the owner reviews every PR by hand (owner, 12 Oct 2026): always, whatever the repository setting (that is the owner's own Enable auto-merge button); SHIP_REVIEW=0 = auto-merge
#   ship_pr_land              push the branch, open (or reuse) the PR; with auto-merge: turn it on and wait until merged (sets `sha`, `files`); in review: wait until the required
#                             checks are green, then stop with the PR open for the owner (sets `review_n`, `review_url`: ship.sh prints `ship: REVIEW #n <url>`)
# A required check that failed: `fail_reason` names it with its log link and the run exits 1, the PR stays open (fix, commit, run ship again: it finds the PR).
# The step "Core flow files up to date with main" of the one required job failing, or a conflict with main, is no failure: the branch is rebased on the new main (extension version taken again) and pushed again, up to 5 times.
#   SHIP_PR_POLL=<s> seconds between looks (default 15)      SHIP_PR_TIMEOUT=<s> give up waiting after (default 2700; the PR stays open with auto-merge on)
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pr-rest-lib.sh"
ship_mode() {
  case "${SHIP_MODE:-auto}" in pr|direct) echo "$SHIP_MODE"; return ;; esac
  # main takes pull requests only (ruleset): a GitHub origin gh can read lands through a PR, with or without auto-merge (review mode, ship_review). No answer from gh = direct.
  case "$(git remote get-url origin 2>/dev/null)" in *github.com*) command -v gh >/dev/null && [ -n "$(gh api "repos/$(ship_repo)" --jq .full_name 2>/dev/null)" ] && { echo pr; return; } ;; esac
  echo direct
}
ship_repo() { git remote get-url origin | sed -E 's#^.*github.com[:/]##; s#\.git$##'; }
ship_review() {
  [ "${SHIP_REVIEW:-1}" != 0 ]   # the owner merges every PR by hand; only SHIP_REVIEW=0 arms auto-merge. Never the repository setting: the owner allowed auto-merge for his own button (17 Oct 2026) and ship armed #1139/#1140 by itself
}
# 15 Oct 2026: one required job, so the failing STEP names the cause: true when the failed job's red steps include the flow-files one (tools/flow-fresh.mjs; keep its name in pr-gate.yml).
ship_flow_step_red() {
  gh api "repos/{owner}/{repo}/actions/jobs/${1##*/}" --jq '[.steps[]? | select(.conclusion == "failure") | .name] | join("|")' 2>/dev/null | grep -q 'Core flow files up to date with main'
}
ship_pr_fail() { fail_reason="$1"; echo "ship: FAILED $1" >&2; exit 1; }
# The lease names what origin has NOW (empty: nothing): the branch is deleted on merge, so the local tracking ref of an earlier landing is stale and a bare --force-with-lease refuses (12 Oct 2026). Only this session writes the branch.
ship_pr_push() { local now; now="$(git ls-remote origin "refs/heads/$branch" 2>/dev/null | cut -f1)"; git push -q "--force-with-lease=refs/heads/$branch:$now" origin "HEAD:refs/heads/$branch" 2>&1 || ship_pr_fail "could not push the branch $branch to origin"; }
# No stacking (owner, 17 Oct 2026: a PR on another PR's branch gets stuck when the base merges or is retargeted): refuse to push a branch that carries a commit of another open PR.
ship_pr_no_stacking() {
  local mine others hit
  mine="$(git rev-list origin/main..HEAD)"
  others="$(gh pr list --state open --limit 100 --json number,headRefName,commits 2>/dev/null)" || return 0
  hit="$(printf '%s' "$others" | jq -r --arg b "$branch" --arg mine "$mine" '($mine | split("\n")) as $m | .[] | select(.headRefName != $b) | select(any(.commits[]?; .oid as $o | $m | index($o))) | "#\(.number) (\(.headRefName))"' 2>/dev/null | head -n 1)"
  [ -z "$hit" ] || ship_pr_fail "this branch carries commits of the open PR $hit; one PR per branch off main, no stacking: start from origin/main (tools/worktree.sh) and bring over only your own commits (git cherry-pick)"
}
ship_pr_land() {
  local n="" repo out view state mergeable checks failing name link who tries=0 waited=0 last_say=0 body title poll="${SHIP_PR_POLL:-15}" limit="${SHIP_PR_TIMEOUT:-2700}"
  files="$(git diff --name-only origin/main HEAD)"
  ship_pr_no_stacking
  n="$(gh pr list --head "$branch" --state open --json number 2>/dev/null | jq -r '.[0].number // empty')" || n=""
  # A PR's title names the whole PR (owner, 24 Oct 2026: #1743 was titled by its 6th commit, a spec tick): 2+ commits that are not "Move ..." splits need --title= when the PR is opened.
  if [ -z "$n" ] && [ -z "${SHIP_PR_TITLE:-}" ] && [ "$(git log --format=%s origin/main..HEAD | grep -vc '^Move ')" -ge 2 ]; then
    ship_pr_fail "this PR has several commits: pass --title=\"<what the whole PR does for the user>\" (a PR's title names the whole change, not its newest commit)"
  fi
  step "pushing $branch (not main) and opening a pull request"
  ship_pr_push
  if [ -z "$n" ]; then
    title="${SHIP_PR_TITLE:-$(bash "$tools/pr-title.sh" origin/main)}"   # the newest commit that is not a "Move ..." split, or --title= (18 Oct 2026)
    who="$(session_name)"; [ "$who" = "?" ] || title="[${who##*-}] ${title#"[${who##*-}] "}"   # (a --title already starting with the tag keeps one: 24 Oct 2026, #1750 read "[d8] [d8] ...") the session that opened it, short (owner, 15 Oct 2026; tools/session-name.sh)
    # A repo without this toolkit (jobadabra-web, jobadabra-lab) has the body check only in its CI, and the lab's Actions can be blocked (24 Oct 2026, lab #57 opened with a free-form body): no body, no PR.
    [ -z "${external:-}" ] || [ -n "${SHIP_PR_BODY:-}" ] || ship_pr_fail "no --body=<file>: a PR of this repo needs the laid-out description (verdict, Why, Unblocks, impact table, Before/After; ~/jobadabra/tools/pr-body-template.md)"
    [ -n "${SHIP_PR_BODY:-}" ] || step "no --body=<file>: the PR shows the subject, the facts and the commit folded; a 5-second summary goes in a file (CLAUDE.md \"PR descriptions\")"
    body="$(bash "$tools/pr-body.sh" origin/main ${SHIP_PR_BODY:+"--body=$SHIP_PR_BODY"})"   # the summary first, the facts, the commit folded (tools/pr-body.sh)
    rows="$(git log --format='%(trailers:key=Pool-row,valueonly)' origin/main..HEAD | grep -v '^$' | grep -iv '^none' | sort -u || true)"   # the pool rows this PR fixes (the Pool-row lines)
    out="$(gh pr create --base main --head "$branch" --title "$title" --body "$body" ${SHIP_PR_DRAFT:+--draft} 2>&1)" || ship_pr_fail "could not open the pull request: $(echo "$out" | tail -n 1)"
    if [ -n "$rows" ]; then gh label create pool-fix --color 1D76DB --description "fixes a row of the applying pool (from its Pool-row lines)" >/dev/null 2>&1 || true; gh pr edit "$(echo "$out" | tail -n 1)" --add-label pool-fix >/dev/null 2>&1 || true; fi   # a missing label never fails a landing
    n="${out##*/}"; step "opened the pull request: $(echo "$out" | tail -n 1)"
  else
    step "the branch already has pull request #$n: reusing it"
    if [ -n "${SHIP_PR_BODY:-}" ]; then   # a new --body=<file> on a PR that is already open: its description is refreshed through the same tools/pr-body.sh (16 Oct 2026: #1049 kept the first draft's numbers)
      body="$(bash "$tools/pr-body.sh" origin/main "--body=$SHIP_PR_BODY")" && gh pr edit "$n" --body "$body" >/dev/null 2>&1 && step "refreshed the description of #$n from --body" || step "could not refresh the description of #$n (the old one stays)"
    fi
    if [ -n "${SHIP_PR_TITLE:-}" ]; then   # --title= on a PR that is already open: its title is replaced (only then)
      who="$(session_name)"; title="$SHIP_PR_TITLE"; [ "$who" = "?" ] || title="[${who##*-}] ${title#"[${who##*-}] "}"
      gh pr edit "$n" --title "$title" >/dev/null 2>&1 && step "retitled #$n" || step "could not retitle #$n (the old title stays)"
    else   # no --title: still keep the "[xx]" tag (21 Oct 2026: site#18 and #19 were red for a missing tag, opened or retitled by hand): add it when the title lacks one
      who="$(session_name)"; title="$(gh pr view "$n" --json title --jq .title 2>/dev/null || true)"
      if [ "$who" != "?" ] && [ -n "$title" ] && ! printf '%s' "$title" | grep -qE '^\[[^]]+\] '; then
        gh pr edit "$n" --title "[${who##*-}] $title" >/dev/null 2>&1 && step "added the [${who##*-}] tag to the title of #$n" || step "could not add the session tag to #$n (the old title stays)"
      fi
    fi
    if [ -n "${SHIP_PR_DRAFT:-}" ]; then gh pr ready "$n" --undo >/dev/null 2>&1 && step "#$n is a draft again until its new checks are green" || true; fi   # --draft: a new push restarts the checks
  fi
  [ -z "${external:-}" ] || bash "$tools/lab-ci-dispatch.sh" "$n"   # a lab PR has no Actions of its own: the public repo runs its tests (tools/lab_ci.py)
  ship_watch_start "$n"   # from here on the log also hears RED / GREEN / MERGED / CLOSED, whatever way this run ends (18 Oct 2026: #1321 sat red unnoticed)
  local review=""; if ship_review; then review=1; step "review mode: the owner reviews and merges #$n by hand; waiting for every check it started"
  elif ! out="$(gh pr merge "$n" --auto --rebase 2>&1)"; then
    case "$out" in
      *"clean status"*) out="$(gh pr merge "$n" --rebase 2>&1)" || ship_pr_fail "could not merge pull request #$n: $(echo "$out" | tail -n 1)" ;;   # no check to wait for: merge now
      *) ship_pr_fail "could not turn on auto-merge for pull request #$n: $(echo "$out" | tail -n 1) (a repository setting? tools/pr-settings.sh)" ;;
    esac
  fi
  [ -n "$review" ] || step "auto-merge is on for #$n: waiting for the required checks and the merge"
  # Why (27 Oct 2026, the owner's GraphQL budget ran out and PRs could not be opened): this wait looked every 15 s with two GraphQL queries; REST with the last ETag
  #   (tools/pr-rest-lib.sh) costs about one call per look and nothing for an unchanged answer.
  repo="$(ship_repo)"
  while :; do
    view="$(pr_view "$repo" "$n")" || view=""
    state="$(jq -r '.state // empty' <<<"$view" 2>/dev/null)"; mergeable="$(jq -r '.mergeable // empty' <<<"$view" 2>/dev/null)"
    case "$state" in
      MERGED) sha="$(jq -r '.mergeCommit.oid // empty' <<<"$view" | cut -c1-7)"; ship_fetch || true; [ -n "$sha" ] || sha="$(git rev-parse --short origin/main)"   # the PR is merged: a fetch that still fails must not turn it into FAILED
              step "pull request #$n is merged: $sha"; return 0 ;;
      CLOSED) ship_pr_fail "pull request #$n was closed without merging: $(jq -r '.url' <<<"$view")" ;;
    esac
    # Every check the PR started, not only the required ones (14 Oct 2026: only the 3 checks that start on every PR are required; the suites start by `paths:`).
    checks="$(pr_checks "$repo" "$(jq -r '.headRefOid // empty' <<<"$view" 2>/dev/null)" || true)"
    failing="$(jq -r '[.[]? | select(.bucket == "fail" or .bucket == "cancel")] | first // empty | "\(.name)\t\(.link)"' <<<"${checks:-[]}" 2>/dev/null)" || failing=""
    # A run the next push superseded shows as cancelled (every PR workflow cancels its older run, 15 Oct 2026): not a failure while a newer run may be starting. Only a check that
    # stays cancelled over 3 more looks (about a minute) counts, as one that failed.
    if [ -n "$failing" ] && ! jq -e 'any(.[]?; .bucket == "fail")' <<<"${checks:-[]}" >/dev/null 2>&1 && [ "${cancel_looks:-0}" -lt 3 ]; then
      cancel_looks=$(( ${cancel_looks:-0} + 1 )); step "a check was cancelled (a newer push replaces its run): looking again ($cancel_looks/3)"; sleep "$poll"; waited=$((waited + poll + 1)); continue
    fi
    if [ -n "$failing" ] || [ "$mergeable" = CONFLICTING ]; then
      name="${failing%%$'\t'*}"; link="${failing#*$'\t'}"
      if { [ -n "$failing" ] && ship_flow_step_red "${link%%[?#]*}"; } || { [ -z "$failing" ] && [ "$mergeable" = CONFLICTING ]; }; then
        tries=$((tries + 1)); [ "$tries" -le 5 ] || ship_pr_fail "pull request #$n still clashes with main after 5 rebases: $(jq -r '.url' <<<"$view")"
        step "main moved under files this PR changes (${name:-conflict}): rebasing again ($tries/5) and pushing it again"
        rebase; ship_pr_push; files="$(git diff --name-only origin/main HEAD)"
      else
        ship_pr_fail "check '$name' failed: $link . Pull request #$n stays open: fix it, commit, run tools/ship.sh again"
      fi
    fi
    # Review mode ends when every check the PR started passed (none pending, none failing): the PR waits for the owner, nothing has landed on main.
    if [ -n "$review" ] && [ -z "$failing" ] && jq -e 'length > 0 and all(.[]; .bucket == "pass" or .bucket == "skipping")' <<<"${checks:-[]}" >/dev/null 2>&1; then
      if [ -n "${SHIP_PR_DRAFT:-}" ]; then gh pr ready "$n" >/dev/null 2>&1 && step "#$n: marked ready for review (it was a draft until green)" || step "#$n: could not mark it ready: do it by hand (gh pr ready $n)"; fi
      review_n="$n"; review_url="$(jq -r '.url // empty' <<<"$view")"; step "#$n: every check is green: open for the owner's review"; return 0
    fi
    if [ "$waited" -ge "$limit" ]; then ship_pr_fail "pull request #$n is not merged after ${limit}s (it merges by itself when the checks pass): $(jq -r '.url' <<<"$view")"; fi
    [ $((waited - last_say)) -lt 60 ] || { step "still waiting for #$n (${waited}s)"; last_say=$waited; }
    sleep "$poll"; waited=$((waited + poll + 1))
  done
}
