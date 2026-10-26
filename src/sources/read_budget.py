"""The employer sites' read inside the search's time budget (owner, 26 Oct 2026, of a pilot search that read 1,123 employers for 5 minutes:
"it shouldn't just go brute force and check all the employers, it should be smart" / "Stop at 3 minutes and tell you what's left for the
next run"). The sites come best first (src/source_rank.py order, then the list's own order); a timed search starts no new site READ_SECONDS
after its read began (or at the run's deadline, the earlier), always reading the first READ_FLOOR. The sites it did not reach are kept
(data/employers_left.json) and read first, after the floor, next time, so the tail is reached over runs instead of never. No budget (a CLI
or cloud run, a test without one): every site, as before. Used by src/sources/feed_scan.py. Tests: tests/test_read_budget.py."""
import json
import time
from concurrent.futures import TimeoutError as Late
from datetime import datetime, timezone

from .. import paths, time_budget

READ_SECONDS = 120   # of the search's 3 minutes; the AI steps after the read keep their own (time_budget.restart)
READ_FLOOR = 40      # sites read whatever the clock says: the best ones of every search
READ_GRACE = 30      # a site already open may take this long past the read's time; then it is left for the next run, not waited for
LEFT = object()      # result(): the site was still being read at the cut
LEFT_DAYS = 7        # a kept list older than this is dropped (a search moved on)
FILE = 'employers_left.json'


def _file():
    return paths.DATA / FILE


def deadline(now=None):
    """The monotonic time after which no new site starts, or None when the search has no budget."""
    if time_budget.DEADLINE is None:
        return None
    started = now if now is not None else time.monotonic()
    return min(started + READ_SECONDS, max(time_budget.DEADLINE, started))


def cut_at():
    """The monotonic time a timed search stops waiting for any site still being read: employer sites, job boards, the boards its web search
    found, the web search itself (owner's run d4561921e533, 26 Oct 2026: no new site after 2 minutes, but ~22 slow ones already open held the
    read until 5 min 37 s). From the search's start, READ_GRACE past READ_SECONDS; None without a budget."""
    if time_budget.DEADLINE is None or time_budget.BEGAN is None:
        return None
    return time_budget.BEGAN + READ_SECONDS + READ_GRACE


def seconds_left(at):
    """How long to wait for an open site before the cut (None: no cut, wait for it)."""
    return None if at is None else max(0.0, at - time.monotonic())


def result(future, at):
    """The future's result, or LEFT when the cut comes first (its site is not waited for). A failed read raises as future.result() does."""
    try:
        return future.result(timeout=seconds_left(at))
    except Late:
        return LEFT


def over(at, index, now=None):
    """True when the site at `index` (0-based, in read order) must wait for the next run. On a search tape the answer is the recorded one
    (src/budget_tape.py), so a replay reads the same sites as the recording on any machine."""
    if at is None or index < READ_FLOOR:
        return False
    if now is not None:
        return now >= at
    from .. import budget_tape
    return budget_tape.decide('read_over', [index], lambda: time.monotonic() >= at)


def _left(now=None):
    try:
        kept = json.loads(_file().read_text())
        at = datetime.fromisoformat(kept['at'])
    except (OSError, ValueError, KeyError, TypeError):
        return []
    if ((now or datetime.now(timezone.utc)) - at).days >= LEFT_DAYS:
        return []
    return [key for key in kept.get('keys') or [] if isinstance(key, str)]


def ranked(sources):
    """A timed search's sites in the shared ranking's order (src/source_rank.py order: the proven best first, 1 slot in 5 for one not tried,
    the proven dead left out and said); as given without a budget, without a ranking for this search, or when the ranking cannot be read."""
    if time_budget.DEADLINE is None or not sources:
        return list(sources)
    try:
        from .. import places, source_rank
        search = paths.load_search_config(matching=False)
        ordered, skipped = source_rank.order(sources, search, places.countries(search, places.load(), limit=None))
    except Exception as error:  # noqa: BLE001 — the read goes on in the list's own order
        print(f'Warning: employer ranking not used ({type(error).__name__})', flush=True)
        return list(sources)
    if skipped:
        print(f'Employers: {len(skipped)} left out: other installs read them for this kind of role in your countries and found no local job.', flush=True)
    return ordered


def left_first(sources, key, now=None):
    """The sites in read order: the first READ_FLOOR as given (the best), then the ones the last timed read did not reach, then the rest."""
    left = {k: n for n, k in enumerate(_left(now))}
    if not left:
        return list(sources)
    head, tail = list(sources[:READ_FLOOR]), list(sources[READ_FLOOR:])
    waited = sorted((s for s in tail if key(s) in left), key=lambda s: left[key(s)])
    return head + waited + [s for s in tail if key(s) not in left]


def keep_left(unread, key, read, total, now=None):
    """Remember the sites not reached for the next run (none: the file goes) and say it in the log."""
    try:
        if unread:
            _file().parent.mkdir(parents=True, exist_ok=True)
            _file().write_text(json.dumps({'at': (now or datetime.now(timezone.utc)).isoformat(timespec='seconds'), 'keys': [key(s) for s in unread]}) + '\n')
        elif _file().exists():
            _file().unlink()
    except OSError:
        pass
    if unread:
        print(f'Employers: read {read} of {total} sites in the time, best first; the other {len(unread)} are read first next time.', flush=True)
