"""Waiting for a SQLite file another process holds, for the tracker store (sqlite.py connect); guarded by tests/test_store_sqlite.py."""
import sqlite3
import time


def unlocked(step, seconds=10):
    """Run `step`; when another process holds the file ("database is locked"), try again for up to `seconds`. SQLite does not wait
    (the connection's timeout is ignored) while a new file's journal mode is switched or a read turns into a write, so two processes
    opening the same file failed at once (Sentry JOB-PILOTTO-APP-2C, 24 Oct 2026: `cron_runs list` at app start, Windows e2e)."""
    deadline = time.monotonic() + seconds
    while True:
        try:
            return step()
        except sqlite3.OperationalError as error:
            if 'locked' not in str(error) or time.monotonic() > deadline:
                raise
            time.sleep(0.05)
