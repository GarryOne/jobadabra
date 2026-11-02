#!/usr/bin/env bash
# The repository settings and the ruleset on main that landing through pull requests needs (owner, 12 Oct 2026). Since 2 Nov 2026 they are ONE definition for every repo of the org,
# templates/org-repo/settings.json and ruleset.json, applied by tools/org-repo.sh (Gitar on #2945: this file kept a second, stale copy, rebase-only, while the repo is squash-only).
#   tools/pr-settings.sh            show the requests         tools/pr-settings.sh --apply   make them (outward-facing: the owner says yes first)
# Still true of the ruleset: ONE required check, "All checks passed", written in seconds by pr-verdict.yml (tools/pr-verdict.py); no "require up to date" (parallel PRs merge at once);
# a workflow that `on: paths:` skips never reports, so none of them can be required. The admin role and the org admins bypass only through a pull request.
set -euo pipefail
repo="${PR_REPO:-jobadabra/jobadabra}"
name="${repo#*/}"
here="$(dirname "$0")"
if [ "${1:-}" = --apply ]; then
  sh "$here/org-repo.sh" settings "$name" && sh "$here/org-repo.sh" ruleset "$name" && echo "applied."
else
  sh "$here/org-repo.sh" settings "$name" --dry-run && sh "$here/org-repo.sh" ruleset "$name" --dry-run && echo "(nothing changed: run with --apply after the owner's OK)"
fi
