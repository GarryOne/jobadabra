# Root cause, never symptoms

Why (owner, 27 Oct 2026): "root causes, never symptoms", and "to avoid going in circles, with tens of PRs about a specific area of the app". Golden rule in the owner's CLAUDE.md. Removed 2 Nov 2026 (owner: "let's decommission AREA-CIRCLES. Did it help in any way?… I don't think"): the counter flagged 76% of PRs, so it said nothing; the rule below stays, judged from the PR itself.

## On a PR that fixes a bug

The description (or the commit message) must state, in a few words each:

1. **Root cause**, one sentence with a file:line, a log line or a measurement.
2. **Why this is not a symptom patch.** A patch that hides what was seen is not a fix: a retry, a longer timeout, a swallowed error, a special case, a threshold nudge, a one-off data repair.
3. **What let it through** (which rule, test or check) and whether that was fixed in the same change.

Each of these is a blocking finding (no approval) with file:line: the cause is missing, the change only treats the symptom and says nothing about the real fix and its owner, or the new test does not play the scenario that was reported.

## Going in circles

Judge it from the PR itself: the files it changes and the earlier PRs on the same product or harness code that you can see (desktop/e2e root, lib and suites `.mjs`; tests, fixtures, recordings and the shared registries never count). If you cannot see the history, do not guess: flag only what the diff and the description show.

- The earlier PRs on the same files read as 2 or more fixes in the last 7 days (this PR would be the 3rd): a blocking finding until the description has a `Design:` block in the description: the intended behaviour in the owner's words, as the states, the one owner of each, and the verdicts that change them. The code should then be simplified to match.
- Flag a PR that adds one more case, branch, flag or special case to code that already had 2+ fixes that week; ask what the design says instead.
