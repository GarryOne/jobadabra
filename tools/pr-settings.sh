#!/usr/bin/env bash
# The repository settings that landing through pull requests needs (owner, 12 Oct 2026): auto-merge OFF since 12 Oct evening (the owner reviews and merges every PR by hand; tools/ship.sh stops at `ship: REVIEW`), branches deleted on merge, one ruleset on main that requires the PR checks and
# forbids direct pushes. It prints the gh api calls and changes nothing unless run with --apply (outward-facing: the owner says yes first).
#   tools/pr-settings.sh            show the calls         tools/pr-settings.sh --apply   make them
# No "require up to date": parallel PRs merge at once; CI on main (build.yml, page-cases.yml) still catches a rare clash and the red-main rule applies as before.
# The repository admin role bypasses the ruleset only through a pull request (bypass_mode "pull_request", 12 Oct 2026, once every worktree had the PR ship): nobody pushes to main.
# ONE required check since 15 Oct 2026 (owner): "All checks passed". Since 26 Oct 2026 a commit status that pr-verdict.yml writes in seconds each time a PR workflow ends
# (tools/pr-verdict.py: every run of the PR's head green; a CI change over its 10-min budget red). Before, a job of pr-gate.yml waited for the others on a runner, up to 60 min.
# No integration is pinned on the context, so the status satisfies it. Before 15 Oct, four required jobs took four runner slots per PR.
# (owner, 14 Oct 2026: "drop your shared pick logic, rely fully on gh workflow paths"). Every other PR workflow starts only when GitHub's `on: paths:` says the PR changed its area, and a workflow
# that paths skip never reports, so none of them can be required; their red shows on the PR. Main runs them all on every push (tests/test_workflow_paths.py).
set -euo pipefail
repo="${PR_REPO:-GarryOne/jobadabra}"
checks='All\ checks\ passed'
ruleset="$(python3 - "$checks" <<'PY'
import json, shlex, sys
names = shlex.split(sys.argv[1])
print(json.dumps({
  "name": "main: pull requests with required checks", "target": "branch", "enforcement": "active",
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "bypass_actors": [{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request"}],
  "rules": [
    {"type": "pull_request", "parameters": {"required_approving_review_count": 0, "dismiss_stale_reviews_on_push": False, "require_code_owner_review": False,
                                              "require_last_push_approval": False, "required_review_thread_resolution": False, "allowed_merge_methods": ["rebase"]}},
    {"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": False, "required_status_checks": [{"context": n} for n in names]}},
    {"type": "non_fast_forward"}, {"type": "deletion"}]}, indent=2))
PY
)"
echo "1) auto-merge and Update branch allowed for the owner's own buttons (ship never arms auto-merge), delete branch on merge, rebase merge only:"
echo "   gh api -X PATCH repos/$repo -F allow_auto_merge=true -F allow_update_branch=true -F delete_branch_on_merge=true -F allow_rebase_merge=true -F allow_squash_merge=false -F allow_merge_commit=false"
echo "2) the ruleset on main:"
echo "   gh api -X POST repos/$repo/rulesets --input - <<<'<json below>'"
echo "$ruleset"
[ "${1:-}" = --apply ] || { echo "(nothing changed: run with --apply after the owner's OK)"; exit 0; }
gh api -X PATCH "repos/$repo" -F allow_auto_merge=true -F allow_update_branch=true -F delete_branch_on_merge=true -F allow_rebase_merge=true -F allow_squash_merge=false -F allow_merge_commit=false >/dev/null
existing="$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "main: pull requests with required checks") | .id')"
if [ -n "$existing" ]; then gh api -X PUT "repos/$repo/rulesets/$existing" --input - <<<"$ruleset" >/dev/null; else gh api -X POST "repos/$repo/rulesets" --input - <<<"$ruleset" >/dev/null; fi
echo "applied."
