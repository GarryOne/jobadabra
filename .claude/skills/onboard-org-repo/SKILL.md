---
name: onboard-org-repo
description: Put a repo of the jobadabra GitHub org on the shared setup (PR-description check, "All checks passed", Gitar and conflict labels, squash-only settings, the ruleset with the merge-with-override bypass). Use when a repo is added to the org, when the weekly "Org repos drift from the shared setup" issue opens, or when the owner says "onboard <repo>".
---

# Onboard an org repo (owner, 2 Nov 2026: "the same PR Body, the same GH labels... the same workflow")

One source: `templates/org-repo/` (workflow files, `settings.json`, `ruleset.json`, `profiles.json` = which files a repo gets). One script: `tools/org-repo.sh`.

1. Clone the repo, then `tools/org-repo.sh onboard <repo> <clone>`: writes the workflow files into the clone, applies the settings, and creates the ruleset only if `pr-checks.yml` (the "All checks passed" job) is already on the default branch. Add `--dry-run` first to see the requests.
2. Ship the clone's files as a PR with `tools/ship.sh --background` (its body is laid out by `pr-body.sh`; a hand-made body fails the new check). Gitar approves, the owner merges.
3. After the merge: `tools/org-repo.sh ruleset <repo>`. Never before: the first PR could not merge without that check.
4. `tools/org-repo.sh check <repo>` must print "every checked repo is on the shared setup". The weekly run (`org-repo-check.yml`) keeps one issue open while any repo drifts.

A repo's own jobs (tests) go into `pr-checks.yml` and into `needs` of its last job; the ruleset never changes. A change to the setup is a change to `templates/org-repo/`, then `check` shows which repos to update.
