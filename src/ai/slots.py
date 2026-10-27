"""The AI command-line engines' slots (Claude Code, Codex: processes at once) served by priority, then by arrival: a first press's local boards
(their reads, titles and proposal) FIRST, every other call NORMAL, the board web search LATER. A thread's level is set with priority(); a pool
thread takes its caller's level only through carry(). Used by src/ai/providers/cli_base.py; set by src/first_jobs.py, src/sources/found_boards.py
and src/sources/board_web.py. Tests: tests/test_ai_slots.py.
Why (#first-press-slots, owner, 27 Oct 2026: "Web search, combined with more AI slots, combined with local boards first"): on rerun 40450152414
the board reads' calls waited 13-24 s each behind the web search's 25 s call, and the read cut (67 s) came first."""
import contextlib
import heapq
import itertools
import threading

FIRST, NORMAL, LATER = 0, 1, 2
_local = threading.local()


def level():
    """The calling thread's level (NORMAL unless priority() set it)."""
    return getattr(_local, 'level', NORMAL)


@contextlib.contextmanager
def priority(at):
    """Inside the block, this thread's AI calls queue at level `at` (FIRST, NORMAL or LATER); the previous level comes back after it, also on
    an exception. Only this thread: a pool thread it starts takes the level through carry()."""
    before = level()
    _local.level = at
    try:
        yield
    finally:
        _local.level = before


def carry(fn, at=None):
    """`fn` to run in another thread (a pool's) at level `at`, by default the level of the thread that calls carry()."""
    at = level() if at is None else at

    def run(*args, **kwargs):
        with priority(at):
            return fn(*args, **kwargs)
    return run


class Slots:
    """A semaphore of `n` slots handing a free one to the waiting caller with the lowest level, then the earliest. `with slots:` holds one."""

    def __init__(self, n):
        self.n, self.free = n, n
        self._cond = threading.Condition()
        self._queue = []
        self._order = itertools.count()

    def waiting(self):
        with self._cond:
            return len(self._queue)

    def __enter__(self):
        ticket = (level(), next(self._order))
        with self._cond:
            heapq.heappush(self._queue, ticket)
            try:
                while not (self.free and self._queue[0] == ticket):
                    self._cond.wait()
            except BaseException:
                self._queue.remove(ticket)
                heapq.heapify(self._queue)
                self._cond.notify_all()
                raise
            heapq.heappop(self._queue)
            self.free -= 1
            if self.free:   # the next in line may take another free slot
                self._cond.notify_all()
        return self

    def __exit__(self, *exc):
        with self._cond:
            self.free += 1
            self._cond.notify_all()
        return False
