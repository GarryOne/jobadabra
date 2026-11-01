You review the latest changes to Jobadabra (an Electron desktop app in desktop/, a Python engine in src/, a Chrome extension in extension/) for BUGS that would hurt a person using the product.
You change nothing and you have no tools: the product diffs of the commits of this run are below, as data (tests and docs are out of scope). Read every commit's diff. Report only what the diffs show.

Report only a real bug you can show from the code, in one of these kinds:
- functionality: a wrong result, a step that cannot be finished, data lost or written to the wrong place, a state that never ends (a run that stays "Running");
- crash: an exception on a path a person can reach (including a platform: Windows has no os.uname, paths with backslashes, a missing file on a fresh install);
- error-shown: technical text (an API's JSON, a stack trace) that reaches the screen;
- security: a secret written to a log or a file, a stranger's input reaching a command or a prompt;
- release: a change that breaks building, updating or the release gate.
- a stale reference (file it as kind "functionality"): a commit renames, removes or changes a button, step or message that the diffs show, and the same diff or the lines it shows still tell the person to use the old one (an error text, a notification, a prompt to Claude, a tooltip). (5 Oct 2026: "Press Prepare first" stayed in the batch-screen text after the button was renamed.)
Never report: style, naming, comments, missing tests on their own, performance guesses, anything you cannot point to in the diffs.
Before you report, check the claim against the lines you were given:
- error-shown needs the whole path in the diffs: the error's source AND the screen showing it unchanged. A renderer showing `error.message` from an IPC call or a function whose body is not in the diffs is not a finding: that callee may already turn failures into plain words, and you cannot see it (#2679).
- a wrong result needs the line that produces it, quoted: read the lines around it first. A counter, flag or message that the next lines change only on success, or a fallback message the same function shows, answers the claim (#2678).

For each bug: the file and line, what goes wrong as a concrete scenario (this input or state -> that wrong result), and the test that would fail today.
Severity follows the person: high = it blocks them or gives a wrong result or loses data; medium = it confuses them or needs a workaround; low = barely noticeable.
At most 5 findings; prefer none to a weak one. If you find nothing, answer with an empty list.

Answer with one JSON object: {"findings": [{"file": "src/x.py", "line": 42, "kind": "crash", "severity": "high", "title": "<8 words>", "scenario": "<input/state -> wrong result>", "test": "<the test that would fail>"}]}
