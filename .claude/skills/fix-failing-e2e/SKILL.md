---
name: fix-failing-e2e
description: How to fix a red e2e suite (a beta gate, a nightly, a PR's suite run) without burning 40-minute betas. Read the artifacts, name the cause (test drift, product bug, infra, flake), prove the fix on the one step, then the whole fixed suite plus its siblings on CI by hand, never through a beta. Use when an e2e suite or the beta gate is red, or before you edit a suite or its lib.
---

# Fix a failing e2e

Why this exists (24 Oct 2026): in beta runs 5-11 about 8 of ~10 e2e fixes were tests lagging the app; each was proved by a whole beta (30-50 min), and a suite stops at its first red step, so each beta showed one more layer.

## The loop
1. **Read before you run.** `suite-failures.json`, the suite's step table (`steps.json`), the run log, the screenshot (`gh run download <run> -n e2e-artifacts-<suite>`). A failure that says only `""` or "not found" is missing evidence: add the log line first. **A "⚠ one cause, N steps" line comes first** (the log's end and the run's Summary page, gate G3, 26 Oct 2026): those reds are one fix (e.g. a click on one locator that was not visible), and their own checks never ran, so expect a next layer after it: fix the cause, then read the run on your PR before calling the suite fixed.
2. **Name the cause in one line, from this list** (the /admin/operations/e2e page uses the same words):
   - **Test drift**: the app's words, roles or timing changed. Fix the test to read the app's own name (a shared constant), never a new copy.
   - **Product bug**: the app is wrong. Fix the app, add the test first.
   - **Infra**: the key's credit ("credit balance is too low"), a runner, a lock. Do not touch tests.
   - **Flake**: red on timing or the test's environment (a wait that ran out, a dropped connection), then green on the same code. Name the timing assumption and make it a ratio or a wait on a state, not a longer sleep.
   - **Intermittent** (gate G5, 26 Oct 2026): red on a wrong value, then green on the same code. Not a flake: a race in the product or the test, a bug that shows sometimes (#1897: row "Completed" vs panel "Completed with warnings"). CI keeps the job red and triage labels it `intermittent` (`lib/flaky-proof.mjs`); find the race, never "re-run until green".
3. **List the siblings.** `node desktop/e2e/pr-suites.mjs --base origin/main` names every suite that quotes the text you changed; fix them in the same change (a suite stops at its first red step, so the next layer is likely there).
4. **Prove the step alone, in seconds:** `cd desktop/e2e && E2E_STEPS="<step>,<its prerequisites>" node run-all.mjs --only <suite>`. Prove the repro first (your setup took effect).
5. **Then the whole fixed suite plus the siblings, on CI, from your PR:** the PR's own "E2E suites for a PR" run (`pr-suites.yml`) starts the Linux suites your changed files and removed UI text point at, plus every suite (macOS too) that runs the lines you changed (the coverage map, gate G1b), on your branch, and waits: a red suite blocks the merge (gate G1a, 26 Oct 2026). Open the PR early and read that run; do not start a beta to check a test fix. A by-hand `gh workflow run e2e.yml -f suite=...` is against `docs/rules/change-loop.md` rule 7 unless the owner asks for it. A Mac suite the map did not pick waits for the gate.
6. **Ship** with `tools/ship.sh --background [--title="<the whole PR>" if 2+ commits]`. The PR is what starts the suites of step 5.

## Never
- Re-run the full `run-all` or a beta to look at a failure, or start `e2e.yml` by hand without the owner asking.
- Change a test's expectation to match a wrong product.
- Raise a time budget without a measured reason (applyflows: split it, do not stretch it).
- Touch the beta workflow while another session owns it; ask them.

## Where things live
`docs/rules/change-loop.md` ("Debugging a failing e2e step"), AGENTS.md ("Re-run only the step"), `desktop/e2e/pr-suites.mjs` and `lib/pr-suites.mjs`, `lib/key-check.mjs` (credit and key preflight).
