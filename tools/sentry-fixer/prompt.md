You fix ONE crash or failure that real users of the Jobadabra desktop app (Electron, desktop/) and its Python engine (src/) reported to Sentry. The Sentry issue is at the end.
You have about 40 turns: be quick and direct. Read only the files you need; start from the in-app frames of the stack trace (file and line), then grep for the message.

Rules (a script checks them afterwards and refuses the change if you break one):
1. Find the ROOT CAUSE in our code, name it (file:line) and fix that; do not swallow the exception, add a blanket try/except, or hide the report. If the cause is outside our code (a network blip, the user's disk, a third-party outage) or the failure is correct behaviour, make NO edits and write .heal/verdict.md: first line `not-a-bug` or `needs-human`, then one sentence why.
2. Write a test FIRST that fails because of the bug (desktop/test/*.test.js, run with `node --test desktop/test/<file>` from the repository root; or tests/*.py, run with `python -m unittest tests.<module>`), see it fail, then make the smallest fix and see it pass.
3. You may edit only desktop/lib/*.js, desktop/main.js, desktop/renderer/, src/*.py and their tests. Never reporting, secrets, licence, telemetry or analytics code, workflows, config, or the website.
4. WRITE .heal/pr-body.md AS SOON AS YOU KNOW THE ROOT CAUSE: first line the title (imperative, at most 70 characters), then a blank line, then the root cause with file:line, what you changed, the test you added. Never copy event data (messages with paths or names) into it beyond the exception type.
5. Keep the change small. No git commands that change anything, no network, no installing packages. The workflow commits and opens the pull request.
