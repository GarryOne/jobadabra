"""Wake the Claude Code session that shipped a PR when its PR needs it: red, conflict, a comment, ready, merged, closed.

Called by tools/ship-watch.sh after every event line (30 Oct 2026, owner: "Sessions are not watching their PR to be ready. Their PRs are broken but they take no
action. Let's fix it permanently"). Why: the watcher always wrote every event to the ship log, but the one-shot tools/ship-wait.sh ended at the first event and the
red-check hook speaks only on a prompt or a stop, so an idle session, or one that did not re-arm, heard nothing (a8's #2580 sat red unseen). Codex sessions already get the
events pushed (tools/codex-pr-events.py); this is the same for Claude Code, through `cmux agent message`, which delivers by the target agent's hooks and never types into the
terminal: an idle session wakes, a busy one reads it at its next step, and the sender is labelled "PR watcher", never the owner.
Invariants: one cursor per log (<log>.claude.json: offset + prefix hash, a replaced log starts over); only complete lines; the cursor advances only after cmux accepted the
message, so a failed delivery is retried on the next look; no AI call, no GitHub read. Green and review lines never wake (READY says when a PR is done).
Usage: tools/claude-pr-events.py <log>   (env CMUX_SURFACE_ID of the session that ran ship; no surface or a Codex session: silent exit 0).  Guard: tests/test_claude_pr_events.py.
"""
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

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
    log = Path(log)
    cursor = Path(f'{log}.claude.json')
    try:
        with Path(f'{cursor}.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            content = log.read_bytes()
            try:
                state = json.loads(cursor.read_text())
            except (OSError, ValueError):
                state = {}
            offset = state.get('offset', 0)
            if not isinstance(offset, int) or offset < 0 or offset > len(content) or hashlib.sha256(content[:offset]).hexdigest() != state.get('prefix'):
                offset = 0   # the log was replaced or cut: read it from the top
            end = content.rfind(b'\n') + 1   # whole lines only
            if end <= offset:
                return True
            events = [line for line in content[offset:end].decode('utf8', errors='replace').splitlines() if WAKE.match(line)]
            if events:
                message = ASK + '\n'.join(events) + f'\nLog: {log}'
                done = run([cmux, 'agent', 'message', surface, '--from', 'PR watcher', '--json', '--', message], capture_output=True, text=True, timeout=15)
                if done.returncode != 0:
                    return False
            cursor.write_text(json.dumps({'offset': end, 'prefix': hashlib.sha256(content[:end]).hexdigest()}))
            return True
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return False


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
