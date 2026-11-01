"""One Notion pace shared with the desktop app and every other process on this computer using the same connection.

Notion allows about 3 requests a second per connection, counted together: the app, this engine and a terminal run
each pacing only themselves still burst past it (429). They take turns through one small file in the temp folder,
named after a hash of the token. Same file and format as desktop/lib/notion-pace.js: "<next slot ms> <calm until ms>".
A mkdir lock makes each claim atomic (across processes and threads). If the file can't be used, the process keeps
its own pace.
"""
import hashlib
import os
import re
import shutil
import tempfile
import threading
import time

# ~3 requests a second; a GitHub run sets JOB_PILOTTO_NOTION_GAP_MS higher, leaving room for the user's app (same limit).
GAP_MS = int(os.getenv('JOB_PILOTTO_NOTION_GAP_MS') or 340)
LOCK_STALE_MS = 3000
LOCK_TRIES = 200

_local = threading.Lock()
_next_local = 0


def _standin():
    """Only the explicit in-memory e2e service omits pacing; the loopback rule matches desktop/lib/notion-pace.js."""
    return bool(os.getenv('JOB_PILOTTO_E2E') and os.getenv('JOB_PILOTTO_E2E_NOTION_STANDIN') == '1'
                and re.match(r'^http://127\.0\.0\.1(?::\d+)?(?:/|$)', os.getenv('JOB_PILOTTO_E2E_NOTION_BASE_URL', '')))


def pace_file(token):
    digest = hashlib.sha256(str(token).encode()).hexdigest()[:12]
    return os.path.join(tempfile.gettempdir(), f'jobadabra-notion-{digest}.pace')


clock = time.time  # the pace's clock; tests set a fake one, so waits don't depend on the machine's speed


def _now():
    return int(clock() * 1000)


def _locked(path, fn):
    lock = path + '.lock'
    for attempt in range(LOCK_TRIES + 1):
        try:
            os.mkdir(lock)
            break
        except FileExistsError:
            try:
                if _now() - os.stat(lock).st_mtime * 1000 > LOCK_STALE_MS:
                    shutil.rmtree(lock, ignore_errors=True)
            except OSError:
                pass
            if attempt == LOCK_TRIES:
                raise TimeoutError('Notion pace lock busy')
            time.sleep(0.005)
    try:
        return fn()
    finally:
        shutil.rmtree(lock, ignore_errors=True)


def _read(path):
    try:
        with open(path) as handle:
            parts = handle.read().split()
    except OSError:
        parts = []
    numbers = [float(part) for part in parts[:2]] + [0, 0]
    return numbers[0], numbers[1]


def claim(token):
    """The moment (ms) the next request may go, shared across processes; None when the file can't be used."""
    if _standin():
        return _now()
    path = pace_file(token)

    def take():
        next_slot, calm = _read(path)
        at = max(next_slot, calm, _now())
        with open(path, 'w') as handle:
            handle.write(f'{int(at + GAP_MS)} {int(calm)}')
        return at
    try:
        return _locked(path, take)
    except (OSError, TimeoutError, ValueError):
        return None


def calm_until(token, until_ms):
    """After a 429: every process waits until `until_ms`."""
    if _standin():
        return
    path = pace_file(token)

    def write():
        next_slot, calm = _read(path)
        with open(path, 'w') as handle:
            handle.write(f'{int(next_slot)} {int(max(calm, until_ms))}')
    try:
        _locked(path, write)
    except (OSError, TimeoutError, ValueError):
        pass


def wait_turn(token, sleep=time.sleep):
    global _next_local
    at = claim(token)
    if at is None:
        with _local:
            at = max(_next_local, _now())
            _next_local = at + GAP_MS
    wait = at - _now()
    if wait > 0:
        sleep(wait / 1000)
