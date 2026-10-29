# E2E reliability: expectations and plumbing

Why (28 Oct 2026, owner): 149 red runs included 19 product bugs; 604 of 847 harness commits were plumbing. Loosening a test to turn it green hides the bug.
Source: docs/superpowers/specs/2026-10-28-e2e-reliability-design.md, rules E, F and K.

## Rule E: a backbone expectation changes deliberately

A PR that changes an expected value, threshold, tolerance or wait, or skips, deletes or moves a backbone test out of backbone, must carry a commit trailer:
`Expect-changed-by: <sha or the owner's request>` or `Test-was-wrong: <why>`.
Raise a blocking finding when it is missing, unsupported, or merely makes the test match wrong product behaviour. A real product fix keeps the assertion.
Read the cited behaviour change and verify the revised test still protects the user's journey. The gate uses main's lane registry to cover backbone and tolerant suites; suspended and retired suites are free.

The mechanical gate catches changed or removed throw-guard conditions (including their numbers and counts), removed `*Problems(...)` helper calls,
numeric assert/expect/wait changes, timeout literals, removed assertions or protected files, test.skip/it.skip, shared baseline/expectation JSON and truth.json,
and registry moves out of backbone. Suites and shared lib check modules both carry guard/helper signatures; lib files whose names contain check, problems,
quality, judge, baseline or truth also protect numbers in comparisons and named ALLOW/MAX/MIN/LIMIT/THRESHOLD/TOLERANCE/BAND/RATE limits and defaults.
Review the cases it cannot prove: changed strings/booleans, variables outside guard conditions, computed thresholds, aliased helpers, custom assertions and waits,
conditional early returns, individual steps moved between files or lanes, other fixture formats, and semantic rewrites that preserve the signatures.

## Rule F: plumbing has one design job

Every new or changed e2e workflow (the list `E2E_WORKFLOWS` in `tools/e2e-reliability-check.mjs`) and harness module needs exactly one comment `Job:` line naming a design job:
run the backbone; serve stored answers; wait on state; pick the suites; run tolerant suites as rates; keep the scorecard; report health.
The PR's commits need `Harness-job: <job>` or `Fixes-backbone-red: <run ID or URL>`.
Raise a blocking finding for a missing or inaccurate job or trailer, or an unsupported backbone red: it must be red twice on the same commit.
Untouched legacy modules are labelled during the planned inventory/shrink PRs; this check is incremental.

## Rule K: no fix circles

Tolerant results never get a fix PR. A tolerant result, a red already gone, or a health grey is no justification for harness work: raise a blocking finding.
After 2 rounds of disagreement on one Gitar finding, the session answers in that thread with the evidence and asks the owner to decide.
Raise a blocking finding if the session continues the disagreement beyond that cap without the owner's decision. The owner resolves the decision in the thread.
Approval remains withheld while a blocking finding is unresolved; the approval step reads review findings, not the PR description.
