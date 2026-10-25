"""Print why a claude-code-action step failed: the API's own error text from its execution file, secrets masked.

The action's log hides the error ("full output hidden for security"), so four runs on 21-24 Oct 2026 failed with
is_error:true, 0 turns, $0 and no reason. The text is in the execution file on the runner; this prints it as an
annotation and a step-summary line. Tests: tests/test_claude_failure_reason.py.
"""
import json
import os
import re
import sys

DEFAULT_FILE = "/home/runner/work/_temp/claude-execution-output.json"
SECRET = re.compile(r"(sk-ant-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]+|Bearer\s+\S+|[A-Za-z0-9_-]{40,})")


def reason(path):
    """One line saying what the API answered, or '' when the file has no failed result."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return ""
    messages = data if isinstance(data, list) else [data]
    for m in reversed(messages):
        if isinstance(m, dict) and m.get("type") == "result" and m.get("is_error"):
            text = m.get("result") or m.get("error") or ""
            status = m.get("api_error_status")
            head = f"HTTP {status}: " if status else ""
            return SECRET.sub("***", head + str(text or "no error text in the result")).replace("\n", " ")[:600]
    return ""


def main(argv):
    line = reason(argv[1] if len(argv) > 1 else DEFAULT_FILE)
    if not line:
        return 0
    msg = f"Claude did not run; the API said: {line}"
    print(f"::error::{msg}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
