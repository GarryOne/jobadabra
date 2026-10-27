"""A timed search's process ends at its deadline (owner, 26 Oct 2026: "A find jobs session should take at most 3min"). Site reads still open
after the read cut are neither waited for nor killed (src/sources/late_reads.py), but Python joins every such thread when the process exits:
the owner's run 8501ae436f60 was done at 155 s and exited at 271 s, and the app showed it running until then. Once the engine is done, the
open reads get what is left of the run's time to end and keep their answer; then the process exits without them, and the next search reads
those sites itself. Without a budget nothing changes. A step with a budget of its own (the employer finder, src/scout.py) gives its deadline
to `until` (27 Oct 2026: a first press's scout waited for 6 checks until 379 s of 180). Tests: tests/test_run_exit.py."""
import os
import sys
import threading
import time


_own = [None]


def until(deadline):
    """This process's deadline when it runs no search budget (time_budget): its own step's end (time.monotonic())."""
    _own[0] = deadline


def _open():
    return [t for t in threading.enumerate() if t is not threading.main_thread() and not t.daemon and t.is_alive()]


def finish(code):
    """`code`, after the open reads ended or the run's deadline came; past the deadline the process exits here with `code`."""
    from . import time_budget
    deadline = time_budget.end() or _own[0]   # a step with its share of the press ends at its stage, not at the press's deadline
    if deadline is None or not _open():
        return code
    for thread in _open():
        thread.join(max(0.0, deadline - time.monotonic()))
    left = _open()
    if not left:
        return code
    print(f"⏱ {len(left)} site read(s) still open at the run's time: the next search reads those sites", file=sys.stderr, flush=True)
    sys.stdout.flush()
    os._exit(code if isinstance(code, int) else 1)
