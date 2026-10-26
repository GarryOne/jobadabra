"""The job boards the run's web search found, read at once, before the first-jobs slice and the employer sites (owner, 26 Oct 2026: "START A
JOB SEARCH WITH SEARCHING ON GOOGLE!"; the pilot search's web search found 4 aviation boards at 37 s that were read after 1,123 employer
sites, or never). It waits for the web search started with the run (src/sources/board_web.py early) up to WEB_WAIT seconds, reads what it
found in parallel and puts their jobs on screen at once. When they give board_yield.ENOUGH jobs in your roles and places, the employer read
keeps only its best sites (src/sources/read_budget.py short). The full board read skips the boards read here (taken). Nothing when no web
search ran in this run (it is asked weekly or monthly per search, src/sources/board_web.py _due). Tests: tests/test_boards_first.py."""
WEB_WAIT = 45   # seconds the run waits for its web search before any employer site (the pilot search's answered at 37 s on the plan)

_taken = set()   # hosts read here in this run


def taken():
    """The boards read first in this run (the full read does not read them again)."""
    return set(_taken)


def run(feed_db, search, on_jobs, wait=WEB_WAIT):
    """The web search's boards read now; their jobs in your roles and places (the report's shape), also given to on_jobs at once."""
    from . import aggregators, board_web, board_yield, boards_ahead, found_boards, read_budget
    _taken.clear()
    read_budget.short(False)
    boards = board_web.found_first(search, wait)
    if not boards:
        return []
    print(f"Job boards first: reading the {len(boards)} the web search found, before the employer sites: {', '.join(b['name'] for b in boards)}", flush=True)
    found = found_boards.read(search, boards, web=False)
    _taken.update(board['host'] for board in boards)
    matched = aggregators.kept(feed_db, boards_ahead.NAME, found)
    if matched:
        on_jobs(matched)
    if len(matched) >= board_yield.ENOUGH:
        read_budget.short()
        print(f'Job boards first: {len(matched)} jobs in your roles and places; the employer sites read only their best {read_budget.READ_FLOOR}', flush=True)
    return matched
