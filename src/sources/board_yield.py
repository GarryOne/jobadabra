"""What a job board is worth to this search: the jobs it gave that are relevant (a title the search wants, in a place it wants), not the jobs it
lists (spec docs/superpowers/specs/2026-10-18-search-learns-sources.md, PR 2). A board is dropped after 3 reads with none; untried boards are
read up to 3 a run while fewer than 10 relevant jobs are found; the 'Searching job boards' step reads the found boards in any country.
The count kept in found_boards.json is this read's only (it decides within the run); a board's history over runs is the source_yield table
(src/source_yield.py, one copy): "dead" is read there (PR 6, 18 Oct 2026). Tests: tests/test_board_yield.py, tests/test_proven_boards.py."""
from datetime import date, datetime

from .careers_parse import registrable

DEAD_AFTER = 3         # reads with no relevant job (a StepStone banner counted as 2 jobs before)
ENOUGH = 10            # relevant jobs in the user's places: from here no untried board is read
MAX_UNTRIED = 6        # untried boards read in one run while relevant jobs are fewer than ENOUGH (was 3: music's best board, Talent.com, was 8th of 9 and waited a whole search)


def is_relevant(jobs):
    """The jobs whose title the search wants and whose place is one of the user's (the same judges as every source: the AI title and place
    triage first, then the role and place words)."""
    from . import feeds
    jobs = list(jobs)
    try:
        feeds.triage_places(jobs)
        feeds.triage(jobs)
    except Exception:  # noqa: BLE001 — the role and place words decide
        pass
    return [job for job in jobs if feeds.wanted_title(job.get('title')) and feeds.wanted_location(job)]


def record(entry, listed, relevant, state):
    """Keep this read in the board's entry: jobs listed, relevant jobs and the state (ok: it listed jobs; empty; browser: only a person's
    browser reads it). Whether it is dropped is its history in source_yield (dead)."""
    entry.update({'jobs': listed, 'relevant': relevant, 'last_yield': date.today().isoformat()})
    entry.pop('misses', None)   # kept here before 18 Oct 2026; the history is source_yield's now
    entry['state'] = 'browser' if state == 'browser' else 'ok' if listed else 'empty'


def dead(db):
    """Board hosts whose last DEAD_AFTER measured runs gave no job in the user's places (source_yield rows; a run that read a board keeps
    a row for it, src/source_yield.py measure)."""
    from .. import source_yield
    db.execute(source_yield.TABLE)
    last = {}
    for host, in_places in db.execute("SELECT source, in_places FROM source_yield WHERE kind = 'job board' ORDER BY source, run_at DESC"):
        last.setdefault(host, []).append(in_places)
    return {host for host, counts in last.items() if len(counts) >= DEAD_AFTER and not any(counts[:DEAD_AFTER])}


def total_relevant(kept):
    return sum(int(entry.get('relevant') or 0) for entry in kept.values() if entry.get('state') != 'browser')


def remembered(boards, kept):
    """The boards that gave this install relevant jobs and are missing from this run's proposal: a new AI proposal is a lottery (18 Oct 2026:
    music's Talent.com gave 13 relevant jobs and was proposed in 1 of 5 runs), so a board that paid stays in the list, for the countries the
    proposal serves. A board read as 'browser' or 'empty', or with no relevant job, is not kept this way (its own history drops it)."""
    present = {board['host'] for board in boards}
    served = {country for board in boards for country in board.get('countries') or []}
    return [{'name': entry.get('name') or host, 'host': host, 'search_url': entry['search_url'], 'countries': entry.get('countries') or [],
             'kinds': entry.get('kinds') or [], 'source_kind': entry.get('source_kind') or 'general'}
            for host, entry in kept.items()
            if host not in present and entry.get('state') == 'ok' and int(entry.get('relevant') or 0) > 0 and entry.get('search_url')
            and served & set(entry.get('countries') or [])]


def paid(entry, relevant, search):
    """Keep the role kinds this board gave relevant jobs for (entry['paid_for']): the working boards of a field are known per install, whatever
    the next web search finds (owner's pilot run, 26 Oct 2026: it found 2 unreadable boards, the 3 that list First Officer jobs were not read)."""
    if not relevant:
        return
    from ..role_kinds import UNKNOWN, of_search
    kinds = (of_search(search) or set()) - {UNKNOWN}
    if kinds:
        entry['paid_for'] = sorted(set(entry.get('paid_for') or []) | kinds)


def working(search, kept, skip=()):
    """The boards that gave this install relevant jobs in this search's field and places on their last read (paid), best first, for the
    boards read first (src/sources/boards_first.py); not the ones in skip. A board kept before paid_for existed counts by its own kinds."""
    from .. import places
    from ..role_kinds import UNKNOWN, of_search
    kinds, countries = (of_search(search) or set()) - {UNKNOWN}, set(places.countries(search, limit=None) or [])
    if not kinds:
        return []
    fits = lambda entry: kinds & set(entry.get('paid_for') or entry.get('kinds') or []) and countries & set(entry.get('countries') or [])
    good = [(int(entry.get('relevant') or 0), host, entry) for host, entry in kept.items()
            if host not in skip and entry.get('state') == 'ok' and int(entry.get('relevant') or 0) > 0 and entry.get('search_url') and fits(entry)]
    return [{'name': entry.get('name') or host, 'host': host, 'search_url': entry['search_url'], 'countries': entry.get('countries') or [],
             'kinds': entry.get('kinds') or [], 'source_kind': entry.get('source_kind') or 'sector'} for _, host, entry in sorted(good, key=lambda g: -g[0])]


def not_a_board(entry):
    """A proposed board its check found is none (src/sources/board_check.py): one employer's site or something else at once, no address
    on two days (a Mac that was offline for one search is not a dead board)."""
    kind = entry.get('site_kind')
    return kind in ('one employer', 'other') or (kind == 'gone' and len(entry.get('gone_days') or []) >= 2)


def pick(boards, kept, retry_due=lambda entry: False, dropped=frozenset(), remember=True, enough=ENOUGH):
    """The boards to read now: every one read before (not dropped: `dropped` = dead(db); a 'browser' one once its retry is due), then up to
    MAX_UNTRIED not read yet (one found not to be a board skipped, as a 'browser' one, until its retry), only while the relevant jobs of the boards already read are fewer than ENOUGH. The order is the list's (ranked
    by what the board gave other installs like this one: board_ideas.ideas). remember=False: these boards only (the first-jobs slice's
    second wave, src/first_jobs.py: the boards that paid are in its first)."""
    tried, untried = [], []
    for board in list(boards) + (remembered(boards, kept) if remember else []):
        entry = kept.get(board['host'])
        if registrable(board['host']) in dropped or (entry and (entry.get('state') == 'browser' or not_a_board(entry)) and not retry_due(entry)):
            continue
        (tried if entry and entry.get('last_read') else untried).append(board)
    return tried + (untried[:MAX_UNTRIED] if total_relevant(kept) < enough else [])


def _read_after(entry, since):
    """The board's last read is at or after `since` (None: never)."""
    try:
        return since is not None and datetime.fromisoformat((entry or {})['last_read']) >= since
    except (KeyError, TypeError, ValueError):
        return False


def not_read_since(boards, kept, since, handed=()):
    """The boards not read since `since`: a search run again within the board scan's spacing (src/sources/aggregators.py read_lately) reads the
    boards proposed or found since its last read, not none (owner's pilot run, 26 Oct 2026: a 6-hour rest of the whole board read hid the
    aviation boards proposed after it and the web search). since None: all of them. handed: the boards whose first pages this run read early
    (found_boards._early): their next pages are still to read."""
    if since is None:
        return list(boards)
    fresh = [board for board in boards if board['host'] in handed or not _read_after(kept.get(board['host']), since)]
    from .aggregators import SPACING_HOURS
    print(f'Job boards: {len(boards) - len(fresh)} read in the last {SPACING_HOURS} h skipped; reading {len(fresh)} new ones', flush=True)
    return fresh


def _read_since():
    """When this search read the found boards within the board scan's spacing (src/sources/aggregators.py read_lately), else None."""
    from contextlib import closing
    from ..paths import DATA, load_search_config
    from . import aggregators, boards_ahead, feeds
    try:
        with closing(feeds.database(DATA / 'jobs.sqlite')) as db:
            return aggregators.read_lately(db, boards_ahead.NAME, search=load_search_config())
    except Exception:  # noqa: BLE001 — unknown: the step reads them all
        return None


def step(search, is_relevant=is_relevant):
    """The 'Searching job boards' step for the found boards: reads them for any country and says in one line per board what it gave; boards a
    search read within the board scan's spacing are not read again, their last read is said; the others are read (the First Officer draws, 26 Oct
    2026: ~30 boards proposed, the first-jobs slice had read a few, and the whole step was skipped: 0 boards read). Returns the sources lines
    (src/sources/boards.py main)."""
    from ..ai import board_ideas
    from . import found_boards
    found = board_ideas.ideas(search)
    if not found:
        print('Job boards: no board found for these places and roles yet', flush=True)
        return []
    found = found + remembered(found, board_ideas.load().get('boards') or {})   # boards that paid before stay, whatever this proposal says
    print('Job boards: ' + ', '.join(board['name'] for board in found), flush=True)
    before = {host: entry.get('last_read') for host, entry in (board_ideas.load().get('boards') or {}).items()}
    since = _read_since()   # 19 Oct 2026: a first search read the same boards again right after its digest: those are skipped, one by one
    found_boards.read(search, found, is_relevant=is_relevant, since=since)
    kept, out = board_ideas.load().get('boards') or {}, []
    for board in found:
        entry = kept.get(board['host']) or {}
        if not entry.get('last_read') or (entry['last_read'] == before.get(board['host']) and not _read_after(entry, since)):
            continue   # not read this time nor by this search's slice (dropped, or an untried board over the cap)
        if entry.get('site_kind') in ('gone', 'one employer', 'other'):   # its check found it is no board (src/sources/board_check.py)
            out.append({'source': board['name'], 'status': {'gone': "can't be reached", 'one employer': "one employer's own site: added to your employers",
                                                              'other': 'not a job board'}[entry['site_kind']]})
            continue
        out.append({'source': board['name'], 'status': 'refuses automated reading: offered as a visit' if entry.get('state') == 'browser'
                    else f"{entry.get('jobs', 0)} listed, {entry.get('relevant', 0)} relevant (your roles, your places)"})
    return out
