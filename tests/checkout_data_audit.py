"""Fails the exact test that opens a file for writing, or opens a SQLite database, inside the checkout's data/ or reports/.
Why (31 Oct 2026, a8): tools/py-shards.py names a leaked file but not the test that wrote it, and the first two CI rounds each named a different test (OnlyVisitsTest, test_non_it_crawl);
this makes the writer the failure. It sees only this process: a child process is still caught by the file snapshot in tools/py-shards.py."""
import os
import sys
from pathlib import Path

_WRITE_FLAGS = 'wax+'


class CheckoutDataWrite(BaseException):
    """A BaseException so a test's `except Exception` or `except OSError` cannot swallow it (host_pace._save does)."""


def _writes(mode, flags):
    """True for open() with a write mode, and for os.open with a write/create flag (its mode is None)."""
    if isinstance(mode, str):
        return any(flag in mode for flag in _WRITE_FLAGS)
    return isinstance(flags, int) and bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT))


def _inside(path, folders):
    try:
        resolved = Path(path).resolve()
    except (OSError, TypeError, ValueError):
        return False
    return any(folder == resolved or folder in resolved.parents for folder in folders)


def install(root):
    """Add the audit hook for root/data and root/reports; call once per process (a hook cannot be removed)."""
    folders = [Path(root).resolve() / 'data', Path(root).resolve() / 'reports']

    def hook(event, args):
        if event == 'open' and _writes(args[1], args[2]) and isinstance(args[0], (str, bytes, Path)):
            path = args[0]
        elif event == 'sqlite3.connect' and isinstance(args[0], (str, bytes, Path)):
            path = args[0]
        else:
            return
        if _inside(path.decode() if isinstance(path, bytes) else path, folders):
            raise CheckoutDataWrite(f'a test wrote into the checkout\'s data folder: {path} (use a temp folder, or set JOB_PILOTTO_DATA_DIR for a subprocess)')

    sys.addaudithook(hook)
