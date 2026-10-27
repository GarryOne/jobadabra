# No value: code that burns tokens and delivers no outcome

Why (owner, 27 Oct 2026): "when AI just goes and builds things, generates codes, fixing stuff but with no real outcome/value... Just burning tokens". One question decides every item: **"What outcome does this PR deliver, and how do we know?"** If the answer is not in the PR, no approval (blocking finding, with file:line).

- **Who gets what:** the PR names a user-visible change, an owner request (quote or link), or a measured number that moves (before -> after, with the run or test). The `Unblocks:` line and the impact table carry it. Only "Tests & harness" / "Development speed" rated, with no number and no incident or owner request behind them, is a finding.
- **Tooling for tooling:** a gate, check, watcher, report or helper with no incident it prevents and no consumer named.
- **A fix for something nobody saw:** no failing run, user report, owner request, or test that failed before.
- **A refactor, rename or reorganisation** with no reason it unblocks anything.
- **A feature or option nobody asked for:** scope beyond the request the PR quotes.
- **Undoing or redoing a PR from the last 7 days** without saying why the first was wrong (the `AREA-CIRCLES` line shows the neighbours).
