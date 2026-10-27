# AI slop: blocking findings

Why (owner, 27 Oct 2026): "let's add a gitar rule to protect us from AI Slop." Each item below is a blocking finding (no approval) with file:line, and names the repo rule it protects (CLAUDE.md, docs/rules/).

- **A second copy of a mechanism:** a new helper, reader, retry or watcher beside one that already does the job; name the existing one (docs/rules/data-ownership.md, one copy behind the store interface).
- **Dead code:** unreachable code, unused params, exports, flags or files left behind; commented-out code (docs/rules/files.md).
- **Narrating comments:** a comment that says what the code does (only `Why (<PR or date>): <reason>` is wanted); a stale Why next to a changed line (docs/rules/files.md#comments).
- **Symptom patches:** a new retry, longer timeout, sleep, swallowed catch, special case, threshold nudge, or a site/host name (golden rule "root causes"; "Universal first", guard tools/hardcoded-page-words.mjs).
- **A word list or regex in front of the AI's judgment:** only the offline floor may (CLAUDE.md "The AI decides; code fetches, validates and keeps safe").
- **Weak tests:** asserts the implementation, not the behaviour; would pass on the old code; snapshot or golden churn without a reason (CLAUDE.md "Tests first for any bug the owner saw (watch it fail)").
- **File size and sprawl:** a file pushed past 450-500 lines, or one concern spread over many tiny files (tools/file-size.mjs).
- **A big diff for a small ask:** unrelated renames, reformatting, drive-by refactors.
- **An essay PR body or an unmeasured claim:** "fixed" or "faster" with no number or test (PR descriptions are read in 2-5 s, tools/pr-body-template.md).
