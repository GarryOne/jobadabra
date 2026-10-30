"""One owner of "tell each ship event once": the locked cursor over a ship log, shared by tools/codex-pr-events.py and tools/claude-pr-events.py.

Why (30 Oct 2026, Gitar on #2582): both delivery scripts copied the same cursor rules, so a fix to how a replaced log or a half-written line is read would have reached
only one channel. Invariants: one cursor file per (log, channel) with an offset and a hash of the log up to it, so a replaced or cut log is read from the top; only
complete lines count; the cursor moves only after `send` accepted, so a refused delivery is retried on the next call; no AI call, no GitHub read.
"""
import fcntl
import hashlib
import json
import re
import subprocess
from pathlib import Path


def deliver_pending(log, cursor, pattern, send):
    """Send the unseen complete lines of `log` that match `pattern` through `send(lines) -> bool`; True when nothing is pending or `send` accepted them."""
    log, cursor = Path(log), Path(cursor)
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
            events = [line for line in content[offset:end].decode('utf8', errors='replace').splitlines() if re.match(pattern, line)]
            # Why (#2618, 30 Oct 2026): failed delivery can outlive a push; the watcher publishes its latest observed head before retrying.
            try:
                number, head = Path(f'{log}.head').read_text().split()
            except (OSError, ValueError):
                number, head = '', ''
            if head:
                events = [line for line in events if not (line.startswith(f'ship: RED #{number} ')
                          and line.rsplit(' ', 1)[-1] != head)]
            if events and not send(events):
                return False
            cursor.write_text(json.dumps({'offset': end, 'prefix': hashlib.sha256(content[:end]).hexdigest()}))
            return True
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return False
