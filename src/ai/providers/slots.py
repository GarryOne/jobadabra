"""The cap on a signed-in CLI's processes at once, the search's own work served before background reads (src/ai/providers/cli_base.py).
27 Oct 2026, the search benchmark: a first press reads its job boards in background threads from its first second (src/daily_search.py
early_reads); their page judgments took both of Claude Code's 2 slots, the set-up calls waited behind them, and the 552 jobs its employer
sites listed waited up to 49 s a call for their places and titles: "No time left", 0 found (2 before). Work started inside `background()`
(the early board read, the early web search) and the pools it starts (`carry`) now take a slot only when no other call waits for one; no
slot is held back, so they still use every idle one. Tests: tests/test_cli_slots.py."""
import contextlib
import threading

_local = threading.local()


def low():
    """This thread works in the background (its calls wait while another call waits)."""
    return getattr(_local, 'low', False)


@contextlib.contextmanager
def background():
    before = low()
    _local.low = True
    try:
        yield
    finally:
        _local.low = before


def carry(fn):
    """`fn` run in a pool's thread as the submitting thread runs (background or not): pool.map(carry(fn), items)."""
    flag = low()

    def run(*args, **kwargs):
        before = low()
        _local.low = flag
        try:
            return fn(*args, **kwargs)
        finally:
            _local.low = before
    return run


class Slots:
    """`with slots:` holds one of `n` slots; a background waiter goes after every other waiter."""

    def __init__(self, n):
        self._free, self._waiting, self._cond = n, 0, threading.Condition()

    def __enter__(self):
        mine = not low()
        with self._cond:
            self._waiting += mine
            try:
                while not self._free or (not mine and self._waiting):
                    self._cond.wait()
            finally:
                self._waiting -= mine
            self._free -= 1
        return self

    def __exit__(self, *exc):
        with self._cond:
            self._free += 1
            self._cond.notify_all()
