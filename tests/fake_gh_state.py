"""The fake `gh`'s state file, shared by processes that run at the same time (tests/fake_gh.py, tests/test_ship_pr.py).
Why (1 Nov 2026, test_ship_pr's watcher test timing out at 90 s on CI): a ship and the watcher of the ship before it call the fake `gh` together, and each call is load -> change -> save on one JSON file.
Without a lock two calls lost an update, and a plain write_text truncates first, so a reader could see an empty file and crash. Now one call at a time holds an exclusive lock from its load to
its save, and the file is replaced whole (written aside, then renamed), so no reader sees half a file. fcntl is missing on Windows: there the lock is skipped, the rename still holds."""
import json
import os
from contextlib import contextmanager
from pathlib import Path

try:
    import fcntl
except ImportError:   # Windows: no flock; the shell tests of ship.sh do not run there
    fcntl = None


@contextmanager
def locked(path):
    """Exclusive access to the state file at `path` for the length of the block (another process waits here)."""
    with open(f'{path}.lock', 'w') as handle:
        if fcntl:
            fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            if fcntl:
                fcntl.flock(handle, fcntl.LOCK_UN)


def hold(path):
    """The lock for the rest of this process (a script that loads at its start and saves at its end): the OS frees it when the process exits. -> the open handle, keep it referenced."""
    handle = open(f'{path}.lock', 'w')
    if fcntl:
        fcntl.flock(handle, fcntl.LOCK_EX)
    return handle


def write(path, state):
    """Replace the file whole: written to a name of its own, then renamed over it."""
    path = Path(path)
    aside = path.with_name(f'{path.name}.{os.getpid()}.tmp')
    aside.write_text(json.dumps(state))
    os.replace(aside, path)


def write_fresh(path, state):
    """A test's own start of the state, taken under the same lock as every call (a watcher still polling must not write its old copy over it)."""
    with locked(path):
        write(path, state)
