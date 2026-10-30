"""Wake the Claude Code session that shipped a PR when its PR needs it: red, conflict, a comment, ready, merged, closed.

Called by tools/ship-watch.sh after every event line (30 Oct 2026, owner: "Sessions are not watching their PR to be ready. Their PRs are broken but they take no
action. Let's fix it permanently"). Why: the watcher always wrote every event to the ship log, but the one-shot tools/ship-wait.sh ended at the first event and the
red-check hook speaks only on a prompt or a stop, so an idle session, or one that did not re-arm, heard nothing (a8's #2580 sat red unseen). Codex sessions already get the
events pushed (tools/codex-pr-events.py); this is the same for Claude Code, through `cmux agent message`, which delivers by the target agent's hooks and never types into the
terminal: an idle session wakes, a busy one reads it at its next step, and the sender is labelled "PR watcher", never the owner.
Cursor rules (one cursor per log in <log>.claude.json, whole lines only, moves only after cmux accepted, so a refused delivery is retried): tools/pr_events_cursor.py. Green and review lines never wake (READY says when a PR is done).
Usage: tools/claude-pr-events.py <log>   (env CMUX_SURFACE_ID of the session that ran ship; no surface or a Codex session: silent exit 0).  Guard: tests/test_claude_pr_events.py.
"""
import os
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))   # the sibling module, whether run as a script or loaded by path
from pr_events_cursor import deliver_pending  # noqa: E402

# Every line the watcher and ship write that names an ending, and the two that are not asks. Why (30 Oct 2026): GREEN and REVIEW say "checks passed", not "act" (READY, MERGED
# and CLOSED are the ones that do); built from the full list so tests/test_ship_endings.py, which wants every ending named where the endings are listed, still holds.
ENDINGS = ('DONE', 'FAILED', 'REVIEW', 'MERGED', 'CLOSED', 'RED', 'GREEN', 'READY', 'COMMENT', 'CONFLICT')
QUIET = ('GREEN', 'REVIEW')
# "CONFLICT FIXED" is the watcher's own repair, nothing for the session to do.
WAKE = re.compile(r'^ship: (?:' + '|'.join(end for end in ENDINGS if end not in QUIET) + r')\b(?! FIXED)')

ASK = ('PR watcher (an automatic message, not the owner; it gives no approval). Events of your own PR, newest last. Act now by your rules, and verify the current head first, '
       'an event may be superseded: RED = fix it and say the cause; CONFLICT = rebase; COMMENT = mark the working label, then fix or answer; READY = tell the owner; '
       'MERGED = fast-forward the primary checkout, remove the worktree, tell the owner what to do; CLOSED unmerged = ask why.\n')


def deliver(log, surface, cmux, *, run=subprocess.run):
    """Send the unseen wake events of `log` to the session on `surface` as one message; True when nothing is pending or the message was accepted."""
    try:
        surface = str(uuid.UUID(surface)).upper()
    except (ValueError, TypeError, AttributeError):
        return True

    def send(events):
        message = ASK + '\n'.join(events) + f'\nLog: {log}'
        return run([cmux, 'agent', 'message', surface, '--from', 'PR watcher', '--json', '--', message], capture_output=True, text=True, timeout=15).returncode == 0

    return deliver_pending(log, f'{log}.claude.json', WAKE, send)


def main():
    """Deliver the watcher's own log to the session this shell belongs to."""
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    surface = os.environ.get('CMUX_SURFACE_ID')
    cmux = os.environ.get('CMUX_BUNDLED_CLI_PATH') or shutil.which('cmux')
    if not surface or not cmux or os.environ.get('CODEX_THREAD_ID') or os.environ.get('CODEX_SESSION_ID'):
        return 0   # not a cmux Claude session: the log and tools/ship-wait.sh stay the only channel
    if not deliver(sys.argv[1], surface, cmux):
        print('claude-pr-events: delivery failed; the events stay pending in the ship log', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
