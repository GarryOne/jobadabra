"""Queue shared PR watcher events into the owning Codex thread without terminal input."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid

EVENT = re.compile(r'^ship: (?:DONE|FAILED|REVIEW|MERGED|CLOSED|RED|GREEN|READY|CONFLICT|COMMENT)\b')


def deliver(log, thread, codex, *, run=subprocess.run):
    """Queue complete unseen state events; only successful queueing advances the locked cursor.

    Invariants: one owning thread, no terminal input, no AI call or GitHub read here.
    A replaced/truncated log invalidates its prefix fingerprint; incomplete lines wait.
    """
    try:
        thread = str(uuid.UUID(thread))
    except (ValueError, TypeError, AttributeError):
        return False
    log = Path(log)
    cursor = Path(f'{log}.codex-{thread}.json')
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
                offset = 0
            end = content.rfind(b'\n') + 1
            if end <= offset:
                return True
            events = [line for line in content[offset:end].decode('utf8', errors='replace').splitlines() if EVENT.match(line)]
            if events:
                message = ('PR watcher events for your existing work. Inspect new failures/comments, '
                           'events may be superseded: verify the current head. Continue authorized work, and report READY only on its exact head. '
                           'Do not merge or submit applications.\n' + '\n'.join(events) + f'\nLog: {log}')
                env = dict(os.environ)
                env['PATH'] = f'{Path(codex).parent}{os.pathsep}{env.get("PATH", "")}'
                result = run([codex, 'queue', '--thread', thread, '--message', message, '--resume'],
                             capture_output=True, text=True, timeout=15, env=env)
                if result.returncode:
                    return False
                # Queue success is not an acknowledgement; Codex receives this through its native inbox.
            cursor.write_text(json.dumps({'offset': end, 'prefix': hashlib.sha256(content[:end]).hexdigest()}))
            return True
    except (OSError, subprocess.TimeoutExpired):
        return False


def main():
    """Deliver a watcher's own log using the inherited Codex session and installed CLI."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('log')
    parser.add_argument('--thread', default=os.environ.get('CODEX_THREAD_ID') or os.environ.get('CODEX_SESSION_ID'))
    args = parser.parse_args()
    if not args.thread:
        return 0
    codex = os.environ.get('CMUX_AGENT_LAUNCH_EXECUTABLE') or shutil.which('codex')
    if not codex or not deliver(args.log, args.thread, codex):
        print('codex-pr-events: queue failed; events remain pending in the ship log', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
