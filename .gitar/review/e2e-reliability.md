# E2E reliability: expectations and plumbing

Why (28 Oct 2026, owner): 149 red runs included 19 product bugs; 604 of 847 harness commits were plumbing. Loosening a test to turn it green hides the bug.
Source: docs/superpowers/specs/2026-10-28-e2e-reliability-design.md, rules B, E, F and K.

## Rule B: a step's only clock is its measured hang cap
Owner, 30 Oct 2026 (#2612): "wait on the state, not on a specific time". A wait inside an e2e step polls a state (`pollUntil`, `waitForDecisions` in desktop/e2e/lib/wait-on-state.mjs) and has no bound of its own;
the runner hands it the step's measured hang cap (desktop/e2e/hang-caps.json, 3x calm main p95). The mechanical gate refuses a new or changed inline bound in step code
(`waited < N`, `capMs`/`limitMs`/`timeout: N`, `until(…, N)`, `Date.now() - t < N`), and no trailer clears it. Raise a blocking finding for the forms it cannot see:
a bound in a variable or constant, a fixed sleep used as the wait (`pause(5000)` then one read), or a step that reads a state through a slower copy of it
(an extension decision from app.log instead of the extension's store: 3 tries in a row, 10 s, 45 s and 60 s, each raised the bound under a 14-62 s delivery lag).

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

## Rule S: the design's states hold on every surface

Owner, 31 Oct 2026: "Should be gray, or green"; "The backbone shouldn't have any external world, flaky related suites/tests"; "Any AI calls/suites should be green. They should not stop a beta"; "Why there were no guardrails to prevent this. Let's fix the workflow/guardrail".
Source: the design's states table, the grey line and rules A-C. A PR that touches how a run ends (a workflow's retry or verdict step, `flaky-proof`, `tools/pr-verdict.py`, `desktop/e2e/ci-alert.mjs`,
`tools/main_e2e_state.py`, `tools/beta_rate_gate.py`, `tools/backbone_red.py`, `lanes.json`, the plan's matrix) is read against these; raise a blocking finding when one breaks:
- Grey is never red anywhere the owner looks: the job, the PR verdict, main's Telegram alert, the red-main gate, the beta. A grey job ends green with a `::warning`, never `::error` and never a nonzero exit (mechanical: `tests/test_grey_never_red.py`).
- One owner per state: every reader of red or green calls the one grey check; a second copy of the rule (a title string, a regex, a list of causes) is a finding.
- One source per fact: a suite's lane comes only from `lanes.json` through the plan (`matrix.tolerant`); a second flag deciding the same thing (`matrix.outside`) is a finding.
- The backbone has no outside world: no live AI on any try (the retry answers from the same saved table), no wall-clock assertion, no real Notion or site.
- AI never holds a beta: an AI suite is grey or green, its rate is reported, spent credit is one alert.
Each rule of the design names its `Guard:` test (mechanical: `tests/test_e2e_design_guards.py`); a PR that adds a rule or changes one names or updates its guard.
