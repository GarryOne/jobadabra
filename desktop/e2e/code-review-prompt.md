You review the latest changes to Jobadabra (an Electron desktop app in desktop/, a Python engine in src/, a Chrome extension in extension/) for BUGS that would hurt a person using the product.
You change nothing. You read, then write ONE file: .review/findings.json.

The changes to review: the COMMITS listed at the end (product code only, largest first, at most 30). Go through EVERY one: `git show --stat <sha>`, then
`git show <sha> -- src desktop/lib desktop/main.js desktop/preload.cjs desktop/renderer extension` (tests and docs are out of scope). Open the surrounding code with Read
and Grep when a change touches logic. Write .review/reviewed.txt with the shas you really read (one per line), then .review/findings.json.

Report only a real bug you can show from the code, in one of these kinds:
- functionality: a wrong result, a step that cannot be finished, data lost or written to the wrong place, a state that never ends (a run that stays "Running");
- crash: an exception on a path a person can reach (including a platform: Windows has no os.uname, paths with backslashes, a missing file on a fresh install);
- error-shown: technical text (an API's JSON, a stack trace) that reaches the screen;
- security: a secret written to a log or a file, a stranger's input reaching a command or a prompt;
- release: a change that breaks building, updating or the release gate.
- a stale reference (file it as kind "functionality"): a commit renames, removes or changes a button, step or message, and another file still tells the person to use the old one (an error text, a notification, a prompt to Claude, a tooltip). Grep the whole repo for the old words before you report: `grep -rn "<old label>" desktop src extension`. (5 Oct 2026: "Press Prepare first" stayed in the batch errors after the Prepare button became Apply.)
Never report: style, naming, comments, missing tests on their own, performance guesses, anything you cannot point to in the code.

For each bug: the file and line, what goes wrong as a concrete scenario (this input or state -> that wrong result), and the test that would fail today.
Severity follows the person: high = it blocks them or gives a wrong result or loses data; medium = it confuses them or needs a workaround; low = barely noticeable.
At most 5 findings; prefer none to a weak one. If you find nothing, write [].

.review/findings.json is a JSON array: [{"file": "src/x.py", "line": 42, "kind": "crash", "severity": "high", "title": "<8 words>", "scenario": "<input/state -> wrong result>", "test": "<the test that would fail>"}]
