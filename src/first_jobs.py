"""First jobs in seconds (spec docs/superpowers/specs/2026-10-16-first-jobs-fast.md): before a search's full crawl, read a small slice of fast feeds,
score 3 jobs at once and save (and sync) each as it is scored, so a new user's list has its first job while the rest of the search runs;
while none of them fits 70+, 3 more, up to MAX_FIRST (owner, 18 Oct 2026: Cluj's slice found 70 jobs at 93 s, scored 3, and its first 70+
waited for the full crawl until 431 s). The 2 job boards that gave installs like this one the most jobs in their places are read in the
slice too (spec 2026-10-18-search-learns-sources.md PR 6); with none shared yet, the 6 first boards proposed for the user's country (one
cached AI call, the same the full read makes; owner, 18 Oct 2026: a driver's jobs all came from a board read after 140 employer sites),
read at once and while the employer sites are (18 Oct 2026: Chisinau's first 2 boards gave nothing; SRE's 70+ waited for 2 boards), each
one that refuses automated reading replaced by the next proposed board (19 Oct 2026: 4 of music's first boards refused, XING was 7th).
The search after it is unchanged; scored jobs are skipped by their hash, so the total AI calls are the same.
The employer sites' jobs are imported and scored without waiting for the boards; a boards step still running joins when it finishes (#2913).
Tests: tests/test_first_jobs.py, tests/test_first_jobs_slow_boards.py, tests/test_proven_boards.py."""
import os
import time
from concurrent.futures import ThreadPoolExecutor

from . import store
from .ai import score, slots
from .sources import ats, feeds

SLICE = 15     # feeds read first
FIRST_JOBS = 3  # jobs scored first, at once
MAX_FIRST = 10  # scored at most in the slice while none fits FIT+ yet: the full search would score these same best-ranked jobs anyway
FIT = 70        # a strong match ends the slice's scoring (src/source_yield.py FIT)
SLICE_BOARDS = 6   # read at once (owner, 19 Oct 2026: music's only paying board, XING, was 7th of the proposal and read at 351 s; up to
                   # board_yield.MAX_UNTRIED, the untried boards one read takes); a board that refuses is replaced by the next proposed one, once
FAST = ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'personio', 'teamtailor', 'join')   # a JSON list in one request


def pick(sources, size=SLICE):
    """The feeds read first: the ones that answer in one request (fast kinds), then the others; each group in the list's own order
    (the index ranks it). A page read in Chrome belongs to one install's visits, not to this slice."""
    usable = [source for source in sources if source.get('ats', 'greenhouse') in ats.FETCHERS and source.get('ats') != 'visit']
    fast = [source for source in usable if source.get('ats', 'greenhouse') in FAST]
    return (fast + [source for source in usable if source not in fast])[:size]


def to_score(db, hidden):
    from .daily_helpers import to_score as eligible
    return eligible(db, hidden)


def proven_boards(feed_db, say=print, search=None):
    """The jobs (report shape) of the slice's boards (board_jobs), in your roles and places."""
    found = board_jobs(say, search)
    return aggregators_kept(feed_db, 'Job boards found', found) if found else []


def board_jobs(say=print, search=None):
    """The jobs (as read) of the job boards that gave installs like this one the most jobs in their places (no AI call: the pool's
    ranking, src/ai/board_ideas.py proven), else of the first boards proposed for this search's countries that never refused us; read now,
    and the full search's board read reuses the pages fetched here. Touches no job cache: it runs beside the employer sites' read."""
    if os.getenv('JOBADABRA_FIXTURE_DIR'):   # the end-to-end fixture mode never reaches a live site (as aggregators.scan)
        return []
    from .ai import board_ideas
    from .paths import load_search_config
    from .sources import found_boards
    search = search or load_search_config()
    top, spare = board_ideas.proven(search, limit=SLICE_BOARDS), []
    if top:
        say(f"First jobs: reading {', '.join(board['name'] for board in top)}, the job board{'s' if len(top) > 1 else ''} that gave people "
            'like you the most jobs')
    else:
        _wait_early(search)
        proposed = _proposed(board_ideas, search)
        top, spare = proposed[:SLICE_BOARDS], proposed[SLICE_BOARDS:2 * SLICE_BOARDS]
        if not top:
            return []
        say(f"First jobs: reading {', '.join(board['name'] for board in top)}, job board{'s' if len(top) > 1 else ''} for your country")
    # a board that refuses gives its place to the next proposed one at once, in the same read (19 Oct 2026: a second wave after the first
    # made Finance's slice wait 35 s)
    return found_boards.read(search, top, early=True, workers=SLICE_BOARDS, spare=spare)


_early = {}   # the slice's board proposal asked once the employers are named (propose_early): {'search': ..., 'future': ...}


def propose_early(search=None):
    """Ask the slice's board proposal (board_ideas.ideas: its AI answers are cached per search) now, in the background, once the search has
    named its employers (src/daily_search.py start_proposal), beside the reading -> its future, or None when the slice needs none (proven boards, the end-to-end fixture mode). The slice waits for
    it (_wait_early) and builds its list then, from the cached answers and the boards the pool serves at that time.
    Why (#2913, 2 Nov 2026): no longer asked at second 0. Its serial calls (field, then slice: 73 s on the Codex relay) held the shared AI while
    the employer pick's calls waited 15-25 s each, so the employers were named at 122 s and 0 of 15 were read (zero run 41346903877; the same step
    took 4 s before the relay). FIRST priority (src/ai/slots.py) does not cure it: it orders who takes a free slot, a running 30-43 s call keeps
    its slot, and the relay has no slots. The #2218 reason below still holds for asking inside the slice, so it is asked just before it.
    Why (#2218, 27 Oct 2026, benchmark run 40446066828): asked inside the slice, its 2 AI calls waited for Claude's 2 slots behind the
    employer titles and the web search, so the boards started at 41-63 s and the read cut (67 s) left them 5-26 s: 0 board jobs.
    Why (#2218, its rerun 40449103205): only the AI's answers are taken early, never the list: at 10 s the pool's index is not downloaded
    yet, and an early list lost its shared boards (aviationcv.com, hipo.ro)."""
    if os.getenv('JOBADABRA_FIXTURE_DIR'):
        return None
    from .ai import board_ideas
    from .paths import load_search_config
    search = search or load_search_config()
    if board_ideas.proven(search, limit=SLICE_BOARDS):
        return None
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='board-proposal')
    future = pool.submit(slots.carry(board_ideas.ideas, slots.FIRST), search)   # its boards are the slice's local boards
    pool.shutdown(wait=False)
    _early.clear()
    _early.update(search=search, future=future)
    return future


def _wait_early(search):
    """The early proposal of this same search ended (waited for until the read cut at most), so the slice's own ask finds its answers
    cached instead of asking again; nothing for another search or none started. Taken once."""
    future = _early.pop('future', None) if _early.get('search') == search else None
    _early.clear()
    if future is None:
        return
    from .sources import read_budget
    try:
        future.result(timeout=read_budget.seconds_left(read_budget.cut_at()))
    except Exception:  # noqa: BLE001 — late or failed: the slice asks itself (a late answer is cached when it comes)
        pass


def _refused(board_ideas):
    """The hosts of the boards that refused automated reading (a 'browser' read)."""
    return {host for host, entry in (board_ideas.load().get('boards') or {}).items() if entry.get('state') == 'browser'}


def _proposed(board_ideas, search):
    """The boards proposed for this search's countries that never refused us, in the proposal's order."""
    refused = _refused(board_ideas)
    return [board for board in board_ideas.ideas(search) if board.get('host') not in refused]


def aggregators_kept(feed_db, name, jobs):
    from .sources import aggregators
    return aggregators.kept(feed_db, name, jobs)


def scored_fits(db):
    """{job id: fit score} of the jobs scored so far."""
    from .source_yield import _fits
    try:
        return {str(job_id): fit for job_id, fit in _fits(db).items()}
    except Exception:  # noqa: BLE001 — unknown: the slice scores its next batch
        return {}


def run(db, feed_db, sources, profile, hidden, sync, say=print, scan=None, scorer=None, model=None, size=SLICE, first=FIRST_JOBS, boards=None,
        fits=None, import_jobs=None):
    """Read `size` feeds and, at the same time, the first boards (boards(say) -> their jobs as read), import what matches, score `first` jobs at a time (best first) with a sync after every score,
    until one fits FIT+ or MAX_FIRST are scored. -> how many were scored. A failure here never blocks the search: the full run that follows
    does everything the slice did."""
    started = time.monotonic()
    scan, scorer, model, fits = scan or feeds.scan, scorer or score.run, model or score.DEFAULT_MODEL, fits or scored_fits
    chosen = pick(sources, size)
    say(f'First jobs: reading {len(chosen)} of {len(sources)} employer sites first')
    from .ai import batch_scope

    def read_boards():   # side by side with the employer sites: each batches its own jobs, so a tape replays in any finishing order
        # Why (#first-press-slots, owner, 27 Oct 2026: "local boards first"): the local boards' reads and titles take Claude's slots first
        with batch_scope.reader('boards'), slots.priority(slots.FIRST):
            return (boards or board_jobs)(say)
    with batch_scope.concurrent(), ThreadPoolExecutor(max_workers=1) as pool:
        reading = pool.submit(slots.carry(read_boards))   # the boards' pages meanwhile; matched below, in the thread that owns the job cache
        with batch_scope.reader('employer sites'):
            report = scan(chosen, feed_db)
        # Why (#2913, 2 Nov 2026): the employer sites' jobs are imported and scored while the boards are still being proposed or read; the boards
        # join when they finish (a slow proposal on a shared AI took 73 s, and the first job waited for it). Boards already done join the first import.
        late = None if reading.done() else reading
        if late is None:
            report['jobs'] = [*(report.get('jobs') or []), *_board_jobs(reading, feed_db, say)]
        (import_jobs or (lambda slice_report: store.import_watch_report(db, slice_report)))(report)   # the search passes SoFar.add: the full crawl then still counts these as new (#1015)
        say(f'First jobs: {len(report.get("jobs") or [])} found')   # the app reads the list again on this line
        found = len(report.get('jobs') or [])
        done, strong, queued = _score_first(db, hidden, profile, scorer, model, first, fits, sync, MAX_FIRST)
        if late is not None:
            joined = _board_jobs(late, feed_db, say)
            if joined:
                found += len(joined)
                (import_jobs or (lambda slice_report: store.import_watch_report(db, slice_report)))({'jobs': joined})
                say(f'First jobs: {len(joined)} found on the job boards')   # Why (#2928, Gitar): the app re-reads its job list on `First jobs: N found` (LIST_CHANGED, desktop/renderer/pages/jobs.js); another wording left these jobs hidden
                if not strong and done < MAX_FIRST:   # Gitar #2928: with little from the employer sites the boards' jobs are the slice's first scores
                    more, strong, more_queued = _score_first(db, hidden, profile, scorer, model, first, fits, sync, MAX_FIRST - done)
                    done, queued = done + more, queued + more_queued
    if not queued:
        say(f'First jobs: {found} found, none to score yet')   # the app closes the first-jobs card on this line: said once, after the boards joined
        return 0
    said = f', one fits {FIT}+' if strong else ''
    say(f'First jobs: {done} scored in {round(time.monotonic() - started)} s{said}; the full search goes on')
    return done


def _board_jobs(reading, feed_db, say):
    """The jobs (report shape) of the boards read, [] when that read failed (the full search reads every board)."""
    try:
        found = reading.result()
        return aggregators_kept(feed_db, 'Job boards found', found) if found else []
    except Exception as error:  # noqa: BLE001 — the full search reads every board
        say(f'Warning: first job boards not read: {type(error).__name__}: {error}')
        return []


def _score_first(db, hidden, profile, scorer, model, first, fits, sync, limit):
    """Score the best-ranked jobs `first` at a time, a sync after each, until one fits FIT+ or `limit` are scored -> (how many were scored, whether one fits, how many were queued)."""
    from . import time_budget
    order = [job['id'] for job in time_budget.best_first(score.queue(db, to_score(db, hidden), profile))][:limit]
    if not order:
        return 0, False, 0
    done, tried, strong = 0, 0, False
    while tried < len(order) and not strong:
        ids = set(order[tried:tried + first])
        tried += len(ids)
        stats = {}
        scorer(db, to_score(db, hidden), profile, model, first, workers=first, stats=stats, on_scored=sync, every=1, only_ids=ids)
        if not stats.get('done'):   # a paused Profile, a spent limit or the time: the next batch would score nothing either
            break
        done += stats['done']
        strong = any(fit >= FIT for job_id, fit in fits(db).items() if job_id in {str(i) for i in ids})
    return done, strong, len(order)
