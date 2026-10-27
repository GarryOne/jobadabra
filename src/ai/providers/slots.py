"""The cap on a signed-in CLI's processes at once, with the search's main thread served first (src/ai/providers/cli_base.py).
27 Oct 2026, the search benchmark: a first press reads its job boards in background threads from its first second (src/daily_search.py
early_reads); their page judgments took both of Claude Code's 2 slots, the main thread's set-up calls (pool labels, employer kinds) waited
behind them, ended at 69 s instead of 28 s, and the employer sites that gave the persona its jobs were past the read cut. A call from the main
thread now takes the next free slot before any other thread's; no slot is held back, so the background reads still use every free one.
Tests: tests/test_cli_slots.py."""
import threading


class Slots:
    """`with slots:` holds one of `n` slots; a waiter in the main thread goes before the other threads' waiters."""

    def __init__(self, n):
        self._free, self._first, self._cond = n, 0, threading.Condition()

    def __enter__(self):
        first = threading.current_thread() is threading.main_thread()
        with self._cond:
            self._first += first
            try:
                while not self._free or (not first and self._first):
                    self._cond.wait()
            finally:
                self._first -= first
            self._free -= 1
        return self

    def __exit__(self, *exc):
        with self._cond:
            self._free += 1
            self._cond.notify_all()
