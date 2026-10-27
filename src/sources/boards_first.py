"""The job boards the run's web search found, read at once, before the first-jobs slice and the employer sites (owner, 26 Oct 2026: "START A
JOB SEARCH WITH SEARCHING ON GOOGLE!"; the pilot search's web search found 4 aviation boards at 37 s that were read after 1,123 employer
sites, or never). It reads the boards that gave this install jobs in this field and places before (board_yield.working) at once, then
waits for the web search started with the run (src/sources/board_web.py early) up to WEB_WAIT seconds and reads what it found; each group's
first pages are read in parallel and their jobs put on screen at once. When they give board_yield.ENOUGH jobs in your roles and places, the employer read
keeps only its best sites (src/sources/read_budget.py short). The full board read reads their next pages later, from the pages fetched here. Without a web search in this
run (it is asked weekly or monthly per search, src/sources/board_web.py _due) the known working boards are read. A first press (the first-jobs
slice, which reads the proven boards itself) does not run this in front of its slice: the slice reads, then web_boards() takes the
web search's boards (27 Oct 2026, the search benchmark: 6 fresh personas sat 28 s in this wait, then their slice's boards met the read cut and
found 0-2 jobs). Tests: tests/test_boards_first.py, tests/test_first_press_order.py."""
WEB_WAIT = 45   # seconds the run waits for its web search before any employer site (the pilot search's answered at 37 s on the plan)


def run(feed_db, search, on_jobs, wait=WEB_WAIT):
    """The known working boards read now, then the web search's: their first pages' jobs in your roles and places (the report's shape), each
    group given to on_jobs at once. The full read reads their next pages beside the employer sites, from the pages fetched here (found_boards)."""
    from ..ai import board_ideas
    from . import board_yield, read_budget
    read_budget.short(False)
    known = board_yield.working(search, board_ideas.load().get('boards') or {})
    matched = _read(feed_db, search, known, on_jobs, f'the {len(known)} that gave you jobs in this field before') if known else []
    return web_boards(feed_db, search, on_jobs, wait, matched, {board['host'] for board in known})


def web_boards(feed_db, search, on_jobs, wait=WEB_WAIT, matched=(), read=()):
    """The web search's boards (waited for up to `wait` seconds, never past the read cut) but those in `read`, read at once; with `matched`
    (the jobs already read first) -> all of them. Enough jobs: the employer read keeps only its best sites."""
    from . import board_web, board_yield, read_budget
    matched = list(matched)
    found = [board for board in board_web.found_first(search, wait) if board['host'] not in read]   # the web search ran meanwhile
    matched += _read(feed_db, search, found, on_jobs, f'the {len(found)} the web search found') if found else []
    if len(matched) >= board_yield.ENOUGH:
        read_budget.short()
        print(f'Job boards first: {len(matched)} jobs in your roles and places; the employer sites read only their best {read_budget.READ_FLOOR}', flush=True)
    return matched


def _read(feed_db, search, boards, on_jobs, said):
    """These boards' first pages (early: one page per search, as the first-jobs slice; owner's pilot run, 26 Oct 2026: a board's 5 pages, each
    judged by the AI before the next, held its 16 jobs until 163 s); their new jobs in your roles and places, given to on_jobs."""
    from . import aggregators, boards_ahead, found_boards
    print(f"Job boards first: reading {said}, before the employer sites: {', '.join(board['name'] for board in boards)}", flush=True)
    matched = aggregators.kept(feed_db, boards_ahead.NAME, found_boards.read(search, boards, web=False, early=True))
    if matched:
        on_jobs(matched)
    return matched
