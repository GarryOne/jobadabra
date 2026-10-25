"""Whether an install's scout needs to find new employer names (owner, 20 Oct 2026: "Central + Mac only when thin"): the central scout finds
employers for every kind of work across Europe every 6 hours; an install adds names only where that shared list is thin for its own search.
Covered = the downloaded employer list (src/employer_index.py) has at least scout_cells.FLOOR employers that mostly hire for one of the
search's kinds of work (role_kinds.of_search) with a job in the search's places. Then the install checks only the names the person added.
A long list is not enough (26 Oct 2026: 1,000+ office employers filed under a pilot's kind, 0 hits, no new names found): the
search's own last measured run (src/source_yield.py) must also have given MIN_HITS jobs in its places. Tests: tests/test_scout_when_thin.py."""
from . import employer_index, role_kinds, scout_cells, source_yield
from .paths import load_search_config

MIN_HITS = 10   # jobs in the person's places the last measured run must have given before the shared list counts as cover


def covered(search=None, cache=None, db=None):
    """How many employers the shared list already has for this search, when at least FLOOR; None when the scout should look for more
    (kinds of work not known yet, no list downloaded, too few, or the search's own last run gave fewer than MIN_HITS jobs in its places,
    judged from the job cache `db`; none measured yet counts as thin)."""
    from .sources import feeds
    kinds = role_kinds.of_search(search if search is not None else load_search_config())
    index = employer_index._read(cache or employer_index.CACHE)
    if not kinds or not index or not index['feeds']:
        return None
    have = sum(1 for feed in index['feeds'] if scout_cells.top_kind(feed) in kinds
               and any(feeds.wanted_location({'location': place}) for place in feed.get('places') or []))
    if have < scout_cells.FLOOR:
        return None
    hits = sum(row['in_places'] for row in source_yield.latest(db)) if db is not None else 0
    return have if hits >= MIN_HITS else None
