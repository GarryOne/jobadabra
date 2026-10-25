"""The found job boards read beside the employer sites (owner, 19 Oct 2026: music's jobs were on XING, read at 351 s after 425 employer
sites): a search starts the boards' read before feeds.scan, in its own thread (reader 'boards' of src/ai/batch_scope.py); the thread that
owns the job cache keeps their jobs and shows them as soon as the read ends (deliver, from the employer sites' listener), judged as the
boards' reader judged them, and aggregators.scan takes them instead of a second read. Due and enabled by the same rules as that scan.
Tests: tests/test_boards_ahead.py."""
import os
from concurrent.futures import ThreadPoolExecutor, wait as wait_for

NAME = 'Job boards found'   # aggregators.sources' name for found_boards.read


class Ahead:
    def __init__(self, search, read):
        from ..ai import batch_scope

        def run():
            with batch_scope.reader('boards'):
                return read(search)
        self.pool = ThreadPoolExecutor(max_workers=1)
        self.future = self.pool.submit(run)
        self.found = self.matched = None
        self.shown = False

    def wait(self):
        """Until the read ends (inside the side-by-side scope, so its answers join the shared ones)."""
        wait_for([self.future])

    def take(self, db, now=None):
        """(jobs read, jobs kept): waits for the read, keeps them once; a failed read raises as a direct read would."""
        if self.matched is None:
            from ..ai import batch_scope
            from . import aggregators
            found = self.future.result()
            with batch_scope.seen_by('boards'):
                self.matched = aggregators.kept(db, NAME, found, now)
            self.found = found
            self.pool.shutdown(wait=False)
        return self.found, self.matched

    def deliver(self, db, on_jobs):
        """The boards' jobs shown now if their read has ended (in the thread that owns the job cache); once."""
        if self.shown or not self.future.done() or self.future.exception() is not None:
            return
        _, matched = self.take(db)
        self.shown = True
        if matched:
            on_jobs(matched)


def start(db, search, env=None, now=None):
    """An Ahead reading the found boards now, when aggregators.scan would read them in this search; else None."""
    from . import aggregators
    if os.getenv('JOB_PILOTTO_FIXTURE_DIR'):   # the end-to-end fixture mode never reaches a live site (as aggregators.scan)
        return None
    read = dict(aggregators.sources(env)).get(NAME)
    if read is None:
        return None
    if aggregators.read_lately(db, NAME, now, search):
        return None
    return Ahead(search, read)


def scan_beside(sources, db, search, so_far, due, scan=None):
    """The employer sites' read (feeds.scan), with the found boards read beside it when this search reads them (`due`): (report, Ahead or
    None). Each side's jobs go to the list as soon as they are read (src/jobs_so_far.py)."""
    import contextlib
    from ..ai import batch_scope
    from . import feeds
    scan = scan or feeds.scan
    sites = so_far.listener('employer sites')
    if not due:
        return scan(sources, db, on_jobs=sites), None
    boards = so_far.listener('job boards')
    with batch_scope.concurrent():
        ahead = start(db, search)

        def on_site(jobs):
            sites(jobs)
            if ahead is not None:
                ahead.deliver(db, boards)
        with batch_scope.reader('employer sites') if ahead is not None else contextlib.nullcontext():
            report = scan(sources, db, on_jobs=on_site)
        if ahead is not None:
            ahead.wait()
    return report, ahead
