"""Says where the central scout is stuck when it runs past its time budget: stacks of every thread, written to the job log.
Why: 20 Oct 2026, 2 of 6 central runs were cancelled at the job's 75 minutes with an empty log, so no one could tell which check held them.
Tests: tests/test_scout_overrun.py."""

import contextlib
import faulthandler
import os
import sys
import threading
import time

DUMP_EVERY_S = 15 * 60
GRACE_S = 10 * 60   # the budget ends new checks; running ones normally finish well inside this
LEAVE_GRACE_S = 2   # an idle pool worker ends in milliseconds; a check given up on does not


def arm(budget_s, grace_s=GRACE_S, file=None):
    """After budget_s + grace_s, dump every thread's stack once to `file` (stderr). Returns False when there is no budget to overrun."""
    if not budget_s:
        return False
    target = file or sys.stderr
    print(f'scout: stacks of every thread are written every {min(budget_s + grace_s, DUMP_EVERY_S) / 60:.0f} min while the run is going', flush=True)
    faulthandler.dump_traceback_later(min(budget_s + grace_s, DUMP_EVERY_S), repeat=True, file=target)   # repeats: the first one alone came after the job's cancel (22 Oct 2026)
    return True


def disarm():
    """The run ended in time: no dump."""
    faulthandler.cancel_dump_traceback_later()


def leave_if_stuck(grace_s=LEAVE_GRACE_S):
    """Everything is saved and published: a check given up on (scout.run, CHECK_LIMIT_S) may still hold its thread, and Python waits for every
    non-daemon thread before it exits, so the job would sit until its cancel. Leaves at once when one is still running after grace_s.
    Daemon threads never hold the exit and are not counted; a pool shut with wait=False keeps its idle workers alive a moment, and those end
    by themselves (26 Oct 2026: both counted as stuck checks, a test's leftover heartbeat threads ended a unittest shard halfway with exit 0)."""
    until = time.monotonic() + grace_s
    held = [t for t in threading.enumerate() if t is not threading.current_thread() and not t.daemon]
    for thread in held:
        thread.join(max(0, until - time.monotonic()))
    stuck = [t for t in held if t.is_alive()]
    if stuck:
        print(f'scout: {len(stuck)} check thread(s) still running after the run; leaving without them', flush=True)
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(0)


@contextlib.contextmanager
def phase(name, out=print):
    """Says "Scout: <name> took N s" when the step ends (also when it raises): 21 Oct 2026, 37 minutes after the last check had no log line."""
    began = time.monotonic()
    try:
        yield
    finally:
        out(f'Scout: {name} took {time.monotonic() - began:.0f} s')


def publish_deadline(started, job_s=30 * 60, reserve_s=3 * 60, wall=time.time, job_started_at=None):
    """Monotonic time after which no new feed check starts, so the index is published before the job's own limit (reserve: upload + cost report).
    The limit counts from the JOB's start (JOB_STARTED_AT, epoch seconds, set by the workflow), not the process's: 22 Oct 2026 the 23 min of the step before
    it were not counted and the deadline fell after the cancel."""
    job_started_at = job_started_at or float(os.getenv('JOB_STARTED_AT') or 0)
    if job_started_at:
        return time.monotonic() + (job_started_at + job_s - reserve_s - wall())
    return started + job_s - reserve_s
