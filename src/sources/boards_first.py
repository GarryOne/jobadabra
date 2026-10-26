"""The job boards the run's web search found, read at once, before the first-jobs slice and the employer sites (owner, 26 Oct 2026: "START A
JOB SEARCH WITH SEARCHING ON GOOGLE!"; the pilot search's web search found 4 aviation boards at 37 s that were read after 1,123 employer
sites, or never). It waits for the web search started with the run (src/sources/board_web.py early) up to WEB_WAIT seconds, reads what it
found in parallel and puts their jobs on screen at once. When they give board_yield.ENOUGH jobs in your roles and places, the employer read
keeps only its best sites (src/sources/read_budget.py short). The full board read skips the boards read here (taken). Without a web search in this
run (it is asked weekly or monthly per search, src/sources/board_web.py _due) the known working boards are read. Tests: tests/test_boards_first.py."""
WEB_WAIT = 45   # seconds the run waits for its web search before any employer site (the pilot search's answered at 37 s on the plan)

_taken = set()   # hosts read here in this run


def taken():
    """The boards read first in this run (the full read does not read them again)."""
    return set(_taken)


def run(feed_db, search, on_jobs, wait=WEB_WAIT):
    """The web search's boards and the known working ones read now; their jobs in your roles and places (the report's shape), also given to on_jobs at once."""
    from ..ai import board_ideas
    from . import aggregators, board_web, board_yield, boards_ahead, found_boards, read_budget
    _taken.clear()
    read_budget.short(False)
    found = board_web.found_first(search, wait)
    known = board_yield.working(search, board_ideas.load().get('boards') or {}, skip={board['host'] for board in found})
    boards = found + known
    if not boards:
        return []
    said = [f"the {len(found)} the web search found" if found else '', f"the {len(known)} that gave you jobs in this field before" if known else '']
    print(f"Job boards first: reading {' and '.join(part for part in said if part)}, before the employer sites: {', '.join(b['name'] for b in boards)}", flush=True)
    jobs = found_boards.read(search, boards, web=False)
    _taken.update(board['host'] for board in boards)
    matched = aggregators.kept(feed_db, boards_ahead.NAME, jobs)
    if matched:
        on_jobs(matched)
    if len(matched) >= board_yield.ENOUGH:
        read_budget.short()
        print(f'Job boards first: {len(matched)} jobs in your roles and places; the employer sites read only their best {read_budget.READ_FLOOR}', flush=True)
    return matched
