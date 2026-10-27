"""Shared base of the source scout (src/scout.py and its scout_*.py pieces): paths, tuning numbers, the candidate table's SQL,
the search words, the small name helpers, and the two settings the pieces share as ONE binding: `CENTRAL` (set by `scout.main` for the central
scout) and `EMPLOYERS_DB` (the Notion Employers & Sources database). Read them as `scout_core.CENTRAL` / `scout_core.EMPLOYERS_DB`.
Tests: tests/test_scout.py, tests/test_scout_notion_sync.py, tests/test_seeds_private.py, tests/test_stop_means_stop.py.
"""

import json
import os
import re
import sqlite3
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from .paths import CONFIG, load_search_config
from .sources import ats, host_pace


SEEDS = CONFIG / 'scout_seeds.json'
# Notion "Employers & Sources": one row per employer or job board (formerly Source Registry + Company Research).
EMPLOYERS_DB = os.getenv('NOTION_EMPLOYERS_DB', '')
DEFAULT_BATCH = 40      # candidates probed per run (15 until 3 Oct 2026: the queue then held 400+ names and moved too slowly)
# A long queue is worked through faster and not made longer (owner, 7 Oct 2026: 609 ideas waited, the app probed 15 a run while each run added ~200):
# a run probes a sixth of the queue (40 to 100). Since 18 Oct 2026 new names are added however long it is: the queue is worked by each
# source's yield instead (src/scout_queue.py; the 100-name pause had frozen every new name for 12 days).
MAX_BATCH = 100


def batch_for(pending, asked=DEFAULT_BATCH):
    """How many candidates a run probes, for this many waiting: at least what was asked, more for a long queue."""
    return max(asked, min(MAX_BATCH, (pending or 0) // 6))


def pending_count(db):
    try:
        return db.execute("SELECT COUNT(*) FROM scout_candidates WHERE status = 'pending'").fetchone()[0]
    except sqlite3.OperationalError:   # before the first run made its table
        return 0
HN_THREADS = 2          # Latest monthly "Who is hiring?" threads to read.
RECHECK_DAYS = {'low': 21, 'none': 90, 'watch': 7}   # watch: a careers page with no open jobs today, looked at again weekly
# Tier 1 feeds are crawled with this many matching roles anywhere: their Zurich/London roles come and go.
TIER1_MIN_RELEVANT = 3
SMALL_GUESS = 5   # a guessed feed with fewer jobs is checked against the company's own careers page (find_feed)
# Lists of software employers only: Hacker News "Who is hiring?", hiring-without-whiteboards, SwissDevJobs, and the seed lists unless the seed file
# says "tech_only": false (absent means true: every app copied the shipped tech list at first run). A search outside IT neither harvests nor probes
# them (6 Oct 2026: a photographer's runs checked Netflix, Stripe and Databricks while the AI's Geneva retail and watchmaking ideas waited in the
# queue). Wikidata, jobs.ch employers and the AI's ideas cover every trade.
TECH_LIST_ORIGINS = ('Hacker News', 'hiring-without-whiteboards', 'SwissDevJobs')
SEED_ORIGINS = ('Tier 1 seed', 'Seed list:')

TABLES = """
CREATE TABLE IF NOT EXISTS scout_candidates (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    origin TEXT NOT NULL,
    priority INTEGER NOT NULL,
    tier TEXT NOT NULL DEFAULT 'Standard',
    ats TEXT,
    slug TEXT,
    careers TEXT,
    website TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    quality INTEGER,
    stats_json TEXT,
    added_at TEXT NOT NULL,
    checked_at TEXT,
    next_check TEXT,
    checked_with TEXT,
    outcome TEXT
);
-- Which checked employers each Employers & Sources database already has a row for (sync_notion): a run without Notion, a failed
-- write or a new workspace leaves some out, and they are written later instead of staying only on this computer (6 Oct 2026).
CREATE TABLE IF NOT EXISTS notion_synced (
    db_id TEXT NOT NULL,
    key TEXT NOT NULL,
    PRIMARY KEY (db_id, key)
);
CREATE TABLE IF NOT EXISTS feed_sources (
    ats TEXT NOT NULL,
    slug TEXT NOT NULL,
    company TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'Standard',
    quality INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    added_at TEXT NOT NULL,
    PRIMARY KEY (ats, slug)
);
"""
# Columns added to scout_candidates after it first shipped. A table made earlier lacks them, so ensure_tables adds them on EVERY path that opens
# the table (17 Oct 2026: with more than IDEAS_PAUSE names waiting, run() skipped harvest() -- the only place that added them -- and next_batch
# failed with "no such column: checked_with").
ADDED_COLUMNS = {'scout_candidates': (('website', 'TEXT'),   # since 3 Oct 2026
                                      ('checked_with', 'TEXT'),   # the readers that judged it (scout.READERS), since 6 Oct 2026
                                      ('outcome', 'TEXT'))}   # why a 'none' has no feed: one of OUTCOMES, since 20 Oct 2026


def ensure_tables(db):
    """Create the scout tables and bring an older one up to date; call it before the first query on any path that reads them."""
    db.executescript(TABLES)
    for table, columns in ADDED_COLUMNS.items():
        have = {row[1] for row in db.execute(f'PRAGMA table_info({table})')}
        for name, kind in columns:
            if name not in have:
                db.execute(f'ALTER TABLE {table} ADD COLUMN {name} {kind}')
    return db


_SEARCH = load_search_config()


def now():
    return datetime.now(timezone.utc)


def clean_name(name):
    """A company name as a person would write it: harvested text ('Acme|Senior SRE|Remote', 'Acme https://acme.io') is cut back."""
    name = re.split(r'\s*[|]\s*', re.sub(r'https?://\S+', ' ', name or ''), 1)[0]
    return re.sub(r'\s+', ' ', name).strip(' -–—:,;')[:60]


def key_for(name):
    return re.sub(r'[^a-z0-9]', '', re.sub(r'\b(ag|sa|gmbh|ltd|inc|llc|plc)\b', '', name.lower()))


_reads_end = [None]   # time.monotonic() at which the employer lists' reads stop (scout_candidates.harvest until), None: no bound


def _timeout(seconds):
    """`seconds`, or the list reads' time left when shorter; past it a read is not started.
    Why (#first-press-jobs, 27 Oct 2026): a Wikidata 504 held the app's 45 s scout 77-138 s, every benchmark press ran 180-251 s."""
    end = _reads_end[0]
    if end is None:
        return seconds
    left = end - time.monotonic()
    if left < 1:
        raise TimeoutError("the scout's time for new names is up")
    return min(seconds, left)


def _get_json(url, timeout=30):
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT})
    with host_pace.open(request, _timeout(timeout)) as response:
        return json.load(response)


def _get_text(url):
    request = urllib.request.Request(url, headers={'User-Agent': ats.USER_AGENT})
    with host_pace.open(request, _timeout(30)) as response:
        return response.read().decode('utf-8', 'replace')


# The central scout (python -m src scout --publish-index, jobadabra-lab) keeps the full lists it publishes; an install ignores the copies
# of the lists the app shipped before 6 Oct 2026 (src/legacy_lists.py): those sources reach it through the central index now.
CENTRAL = False
# Why an employer has no readable job feed, as the fixed words installs and the central scout share (20 Oct 2026) and how many days each rests
# before it is probed again: a site that was down comes back sooner than one that has none or turned the engine away.
from .employer_index import OUTCOMES   # noqa: E402 (kept beside its comment)
# Keys of employers some install found with no readable job site lately (the central scout reads them before its run; an install reads the
# downloaded employer index instead), so the central scout does not probe what installs already tried.
SHARED_DEAD = set()
# The central scout's time for names and checks, so it always publishes inside its 75-minute job (central-scout.yml): 20 Oct 2026, 2 of 4 runs
# were cancelled checking 500 hospital and school sites (slower than job-system boards) and published nothing. Publishing takes ~15 minutes.
CENTRAL_BUDGET_S = 8 * 60   # names and employer checks; the whole job is up to 30 minutes (owner, 24 Oct 2026; 15-20 on 23 Oct)
VERIFY_BUDGET_S = 12 * 60    # then the feeds' verification: what it does not reach is carried over (src/scout_carry.py)
# One employer's check may take this long before the run stops waiting for it (21 Oct 2026: 6 checks of Swiss mountain huts held all six workers
# for up to 30 minutes each; the run was cancelled at 75 minutes, nothing was published, twice). The late one counts as unreachable (rests 7 days).
CHECK_LIMIT_S = 5 * 60
