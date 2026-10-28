# Root cause, never symptoms

Why (owner, 27 Oct 2026): "root causes, never symptoms", and "to avoid going in circles, with tens of PRs about a specific area of the app". Golden rule in the owner's CLAUDE.md; counter: `node tools/area-circles.mjs origin/main`.

## On a PR that fixes a bug

The description (or the commit message) must state, in a few words each:

1. **Root cause**, one sentence with a file:line, a log line or a measurement.
2. **Why this is not a symptom patch.** A patch that hides what was seen is not a fix: a retry, a longer timeout, a swallowed error, a special case, a threshold nudge, a one-off data repair.
3. **What let it through** (which rule, test or check) and whether that was fixed in the same change.

Each of these is a blocking finding (no approval) with file:line: the cause is missing, the change only treats the symptom and says nothing about the real fix and its owner, or the new test does not play the scenario that was reported.

## Going in circles

Look for the line `AREA-CIRCLES 7d=<n> 30d=<n> files=<list>` in the PR description. It counts the earlier PRs that touched the same product files; judge from the subjects listed above it which of them were fixes.

- `7d` is 2 or more and the earlier PRs read as fixes (this PR would be the 3rd): a blocking finding until the description has a `Design:` block in the description: the intended behaviour in the owner's words, as the states, the one owner of each, and the verdicts that change them. The code should then be simplified to match.
- Flag a PR that adds one more case, branch, flag or special case to code that already had 2+ fixes that week; ask what the design says instead.
- The line is missing on a bug-fix PR: ask the author to run `node tools/area-circles.mjs origin/main` and paste its last line.
