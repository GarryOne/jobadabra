---
name: fix-failing-e2e
description: How to fix a red e2e suite (a beta gate, a nightly, a PR's suite run) without burning 40-minute betas. Read the artifacts, name the cause (test drift, product bug, infra, flake), prove the fix on the one step, then the whole fixed suite plus its siblings on CI by hand, never through a beta. Use when an e2e suite or the beta gate is red, or before you edit a suite or its lib.
---

# Fix a failing e2e

Why this exists (24 Oct 2026): in beta runs 5-11 about 8 of ~10 e2e fixes were tests lagging the app; each was proved by a whole beta (30-50 min), and a suite stops at its first red step, so each beta showed one more layer.

## The loop
0. **Design first:** follow the [canonical repair rule](../../../docs/superpowers/specs/2026-10-28-e2e-reliability-design.md#the-rules), its current implementation status, and `desktop/e2e/lanes.json` before diagnosis or edits.
   **Is this red compliant with the design?** (owner, 31 Oct 2026: "Is the failures compliant with our e2e redesign?… let's close this gap. Let's fix the process/workflow".)
   Name the state the design gives it before anything else: a backbone wrong value is red; a suite cut by its budget is red (owner, 31 Oct 2026: grey only for
   causes outside our code; the suite is too long); a picked step that no longer exists, an AI refusal or spent credit, and any tolerant suite are grey or a rate, never red. When the design says grey or tolerant and it ran red, the suite is
   not the bug: the wiring is. Fix the shared mechanism for the whole class with a test that plays this red (never the suite, never a re-run), `E2E-cause: ci`, name the
   design's rule letter in the commit body, and check the rule's `Guard:` line in the design names the test. 31 Oct 2026: wizard ran red on main on a picked step
   #2659 had removed and on a live AI retry; employers, qualityai and a frozen Mac runner ran red the same way, each fixed as a new bug instead of the wiring.
   **Flaky check, before any cause** (owner, 31 Oct 2026: "why I need to flag this personally… You detect flakinesss and immedaitely treat the flakiness root cause"):
   find the red step's last green run (main, a PR, a re-check) and diff the files it runs between the two commits (`git diff <green> <red> -- <the step's suite, lib and app files>`;
   the coverage map names the app files). Nothing it runs changed: it is **flaky**. Say so first, then name the non-deterministic input (the real hidden Chrome or extension
   worker, runner load, a race, a clock, the outside world) and fix that input's class and the guardrail that let it block: a new step's burn-in, a measured hang cap for
   every step, evidence that survives a cut, the flip detector (plan row 33). Never patch only the step, never re-run, never call it "the next layer".
   31 Oct 2026: the beta gate went red three times on apply in one day; the third (the triage read step, stalled on code that had passed twice) was flaky, and the owner saw it first.
1. **Read before you run.** `suite-failures.json`, the suite's step table (`steps.json`), the run log, the screenshot (`gh run download <run> -n e2e-artifacts-<suite>`). A failure that says only `""` or "not found" is missing evidence: add the log line first. **A "⚠ one cause, N steps" line comes first** (the log's end and the run's Summary page, gate G3, 26 Oct 2026): those reds are one fix (e.g. a click on one locator that was not visible), and their own checks never ran, so expect a next layer after it: fix the cause, then read the run on your PR before calling the suite fixed.
2. **Name the cause in one line, from this list** (the /admin/operations/e2e page uses the same words; the id in brackets is what step 7's trailer says):
   - **Test drift** (`drift`): the app's words, roles or timing changed. Fix the test to read the app's own name (a shared constant), never a new copy.
   - **Product bug** (`product`): the app is wrong. Fix the app, add the test first.
   - **Our CI and AI** (`ai`: the key's credit, the AI refused or answered differently; `ci`: a CI step before the suite, a workflow or tool; `picker`: the PR step picker named a missing step; `runner`: a lost or cancelled runner, the network). Do not touch tests.
     A job "cancelled" with 0 steps, no log and no runner name never started: read its annotations (`gh api repos/<r>/check-runs/<job>/annotations`); "not acquired by Runner" = GitHub's capacity, not a timeout (beta 3, 26 Oct 2026). `rerun-not-acquired.yml` re-runs it once when nothing else is red.
   - **Over budget** (`timing`): "the suite's N-minute budget ran out" or "not run: the suite was over its budget". Red, and ours: the suite is too long (owner, 31 Oct 2026). Measure its first-try minutes on main and the beta first, then either remove its real-clock waits (rule B: a test clock, #2681) or split or rebalance it (the suite's `shards` and step weights: apply 2 → 3 in #2684, 12.8 → 8.0 min). Never raise the budget.
   - **Flake** (`flake`; `timing` when a state wait hit its hang cap): red on timing or the test's environment, then green on the same code in a later run (step 0's flaky check finds it). The job itself is red: a suite has one try and it is the verdict (owner, 31 Oct 2026; `tests/test_e2e_single_try.py`). Follow rule B: state waits with hang caps in backbone, speed measurements in tolerant clock. A larger timeout is not evidence of a deterministic repair.
   - **Test bug** (`test`): the test was wrong on its own (a race, a bad stub, a wrong assumption) and the app had not moved.
   - **Intermittent** (`test` or `product`): a wrong value that came right in a later run of the same commit; triage labels it intermittent (`lib/flaky-proof.mjs`). The design’s suspension path is NOT wired yet (plan PR 21, row 33); until then the job stays red and the owner decides. See the canonical repair rule’s implementation status; never rerun until green or loosen an expectation.
3. **List the siblings.** `node desktop/e2e/pr-suites.mjs --base origin/main` names every suite that quotes the text you changed; fix them in the same change (a suite stops at its first red step, so the next layer is likely there).
4. **A line with a `Why (...)` comment is a decision:** read the Why and its PR before changing it (the red may be the test's drift, not that line);
   change it only on purpose, update or remove the Why with it, and say `Why-changed: <which Why> — <reason>` in the commit (`tools/why-changed.mjs`).
   **Prove the step alone, in seconds:** `cd desktop/e2e && E2E_STEPS="<step>,<its prerequisites>" node run-all.mjs --only <suite>`. Prove the repro first (your setup took effect).
5. **Then the whole fixed suite plus the siblings, on CI, from your PR:** the PR's own "E2E suites for a PR" run (`pr-suites.yml`) starts the Linux suites your changed files and removed UI text point at, plus every suite (macOS too) that runs the lines you changed (the coverage map, gate G1b), on your branch, and waits: a red suite blocks the merge (gate G1a, 26 Oct 2026). Open the PR early and read that run; do not start a beta to check a test fix. A by-hand `gh workflow run e2e.yml -f suite=...` is against `docs/rules/change-loop.md` rule 7 except its one exception (owner, 24 Oct 2026): the one fixed Linux suite, on your own branch (`--ref <branch>`).
   **Use it for a fix a PR run cannot see** (28 Oct 2026, beta 3: 6 suites red on "neuron count unreadable" because #2375 put the cap's env on the preflight step only; three betas went by on "the secret exists"): a by-hand run has `E2E_FULL=1`, so it fails what a PR run skips (the AI cap). Read the job's env listing for the names you added and check `grep -c ai-capped <log>` is 0 before any beta. A Mac suite the map did not pick waits for the gate.
6. **Ship** with `tools/ship.sh --background [--title="<the whole PR>" if 2+ commits]`. The PR is what starts the suites of step 5.
   **After the fix merges** (owner, 31 Oct 2026: "when we fix e2e on main. We should run first only the failing e2e suite, then rerun a beta full e2e suite. This should be part of the skill … or of the tooling/workflow"): the next beta (`tools/beta-release.sh` by hand, or the nightly) re-runs ONLY main's red suites on main first (`tools/red-main-gate.sh`) and starts the full beta only when they are green. Never start a full beta, or a whole-suite run, to check a fix.
7. **Say the cause in the fix's commit** (before step 6 pushes it), so /admin/operations/e2e reads it instead of guessing (owner, 27 Oct 2026): `E2E-cause: <drift | test | product | flake | timing | ai | ci | picker | runner> [suite, suite]`.
   A product fix that touches no test says it too (`E2E-cause: product apply`). A suite or lib change with no red behind it: `E2E-cause: none <why>`.
   The push gate refuses an e2e suite or lib change without it (`tools/e2e-cause-trailer.mjs`).

## Never
- Re-run the full `run-all` or a beta to look at a failure, or start `e2e.yml` by hand beyond rule 7's one fixed suite on your branch (step 5).
- Change a test's expectation to match a wrong product.
- Treat a clock/AI/outside result as a deterministic product failure, or change budgets/shards before applying the approved lane design. A necessary journey split still needs rules E and F and measured evidence.
- Touch the beta workflow while another session owns it; ask them.

## Where things live
`docs/rules/change-loop.md` ("Debugging a failing e2e step"), AGENTS.md ("Re-run only the step"), `desktop/e2e/pr-suites.mjs` and `lib/pr-suites.mjs`, `lib/key-check.mjs` (credit and key preflight).
