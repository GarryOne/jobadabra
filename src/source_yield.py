"""Yield per source: which employer feeds and job boards gave this search its relevant jobs (spec
docs/superpowers/specs/2026-10-18-search-learns-sources.md, PR 1).

After each jobs check, per source: its open jobs, those in the user's places, how many were new this run, scored, and with a fit of 70 or more.
Kept per run in the job cache (table source_yield), so a source can be kept, retried or dropped by what it gave (job boards, the employer queue,
the widening step), and said in one line, "Where your jobs came from". A board's jobs are counted per board host (registrable domain), never
as one "Job boards found"; an employer feed's under its company. Counts only, nothing about the person. Tests: tests/test_source_yield.py.
"""
import json
import urllib.parse

from .sources.careers_parse import registrable

FIT = 70   # "fit 70+": the score band where the core of the role matches (src/ai/score.py bands)
TABLE = '''CREATE TABLE IF NOT EXISTS source_yield (
    run_at TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL,
    open INTEGER NOT NULL, in_places INTEGER NOT NULL, new INTEGER NOT NULL, scored INTEGER NOT NULL, fit70 INTEGER NOT NULL,
    local INTEGER NOT NULL DEFAULT 0, local_fit70 INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (run_at, kind, source))'''
FIELDS = ('kind', 'source', 'open', 'in_places', 'new', 'scored', 'fit70', 'local', 'local_fit70')   # local*: only jobs LOCATED in your places, never worldwide remote


def _table(db):
    """The table, with the local columns added to one a build before 24 Oct 2026 made."""
    db.execute(TABLE)
    have = {row[1] for row in db.execute('PRAGMA table_info(source_yield)')}
    for column in ('local', 'local_fit70'):
        if column not in have:
            db.execute(f'ALTER TABLE source_yield ADD COLUMN {column} INTEGER NOT NULL DEFAULT 0')


def _source(name, kind, url):
    """A job board's source is its host (each board on its own, whatever reader brought it); anything else keeps its name."""
    if kind == 'job board':
        host = registrable(urllib.parse.urlsplit(url or '').hostname or '')
        if host:
            return host
    return name


def _fits(db):
    """{job id: fit score} from the scores table, {} when this cache has none yet."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scores'").fetchone():
        return {}
    fits = {}
    for job_id, data in db.execute('SELECT job_id, data_json FROM scores'):
        try:
            fits[job_id] = int(json.loads(data or '{}').get('score') or 0)
        except (ValueError, TypeError):
            continue
    return fits


def measure(db, run_at, in_places=None, read=None):
    """[{kind, source, open, in_places, new, scored, fit70}] for every source with an open job, best first (fit 70+, then jobs in your places).
    run_at: when this run started (ISO, UTC): a job first seen then or later is new. in_places: the place check (default the crawl's own).
    read: {board host: relevant jobs this read} for the found boards read this run (found_boards.read_since): each keeps a row, so "no job
    in your places three reads running" can be seen here (board_yield.dead); one whose jobs link to other sites keeps its read's count."""
    from .sources.feeds import in_my_place
    if in_places is None:
        from .sources.feeds import wanted_location as in_places
    fits = _fits(db)
    rows = {}
    for job_id, title, url, location, first_seen, name, kind in db.execute(
            "SELECT j.id, j.title, j.url, j.location, j.first_seen_at, s.name, s.kind FROM jobs j JOIN sources s ON s.id = j.source_id "
            "WHERE j.state = 'open'"):
        key = (kind, _source(name, kind, url))
        row = rows.setdefault(key, dict.fromkeys(FIELDS, 0) | {'kind': key[0], 'source': key[1]})
        row['open'] += 1
        if not in_places({'title': title, 'location': location or ''}):
            continue
        row['in_places'] += 1
        row['new'] += (first_seen or '') >= run_at
        here = in_my_place({'title': title, 'location': location or ''})
        row['local'] += here
        if job_id in fits:
            row['scored'] += 1
            row['fit70'] += fits[job_id] >= FIT
            row['local_fit70'] += here and fits[job_id] >= FIT
    for host, relevant in (read or {}).items():
        rows.setdefault(('job board', host), dict.fromkeys(FIELDS, 0) | {'kind': 'job board', 'source': host, 'in_places': relevant or 0})
    return sorted(rows.values(), key=lambda row: (-row['fit70'], -row['in_places'], -row['open'], row['source']))


def record(db, run_at, rows):
    """Keep this run's rows (a run measured twice keeps its last count)."""
    _table(db)
    with db:
        db.executemany(f"INSERT OR REPLACE INTO source_yield (run_at, {', '.join(FIELDS)}) VALUES (?, {', '.join('?' * len(FIELDS))})",
                       [(run_at, *(row[field] for field in FIELDS)) for row in rows])


def latest(db):
    """The last measured run's rows, best first, or []."""
    _table(db)
    names = ('run_at', *FIELDS)
    found = db.execute(f"SELECT {', '.join(names)} FROM source_yield WHERE run_at = (SELECT MAX(run_at) FROM source_yield) "
                       'ORDER BY fit70 DESC, in_places DESC, open DESC, source').fetchall()
    return [dict(zip(names, row)) for row in found]


def board_counts(db):
    """{board host: {'in_places', 'fit70'}} of the last measured run: what each job board gave this search in jobs LOCATED in your places (never
    worldwide remote: 24 Oct 2026, "in places" said 750 for Moldova and about 5 were there), shared with the pool (src/contribute.py site_facts)
    so other installs read the boards that gave people like them their local jobs first."""
    return {row['source']: {'in_places': row['local'], 'fit70': row['local_fit70']} for row in latest(db) if row['kind'] == 'job board'}


def line(rows, limit=5):
    """'Where your jobs came from: board-one.test (job board) 2 in your places, 2 fit 70+ · ...': the sources that gave jobs in your places."""
    useful = [row for row in rows if row['in_places']]
    if not useful:
        return 'Where your jobs came from: no source gave a job in your places yet'
    said = [f"{row['source']} ({row['kind']}) {row['in_places']} in your places" + (f", {row['fit70']} fit {FIT}+" if row['fit70'] else '')
            for row in useful[:limit]]
    more = len(useful) - limit
    return 'Where your jobs came from: ' + ' · '.join(said) + (f" and {more} more source{'s' if more != 1 else ''}" if more > 0 else '')


def run(db, run_at, read=None):
    """Measure, keep and say this run's yield; returns the rows. Never stops a search (the caller catches)."""
    rows = measure(db, run_at, read=read)
    record(db, run_at, rows)
    print(line(rows), flush=True)
    return rows
