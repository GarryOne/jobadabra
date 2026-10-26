"""What this install knows about each employer's job list, so a search reads only the lists that can have changed (owner, 26 Oct 2026: "we
recheck probably too the same employers over and over again"; his pilot search re-read 981 of 1,023 employers it had read minutes before).

Per employer feed, for the current search: when it was read, whether every job of it got its answer (title and place), the tag the site gave
its list (ETag) and a fingerprint of its job ids. No job titles, texts or links (owner: no full job details stored). About 180 bytes each.
- Judged for this search under FRESH_HOURS ago: not read again (the job boards rest the same 6 hours, #1975).
- Older: the site is asked "changed since?" with its tag; a 304 means the same list, so nothing new to judge.
- A title or place still waiting for the AI, another search, or new readers: read again.
A skipped employer's open jobs stay seen (keep_seen), so the 7-day expiry never closes a job its site still lists.
Used by src/sources/feed_scan.py. Tests: tests/test_feed_facts.py.
"""
import hashlib
from datetime import datetime, timedelta, timezone

FRESH_HOURS = 6
TABLE = ('CREATE TABLE IF NOT EXISTS feed_facts (board TEXT PRIMARY KEY, search TEXT NOT NULL, read_at TEXT NOT NULL, judged INTEGER NOT NULL, '
         'etag TEXT, ids TEXT, jobs INTEGER)')


def _now():
    return datetime.now(timezone.utc)


def search_digest():
    """The whole search (roles, places, exclusions, remote) and the job readers: a change of either judges every list again. The rest's key."""
    from . import feeds
    return feeds._search_digest()


def load(db):
    """{board: fact} for the current search; facts of an earlier search are dropped."""
    db.execute(TABLE)
    db.execute('DELETE FROM feed_facts WHERE search != ?', (search_digest(),))
    rows = db.execute('SELECT board, read_at, judged, etag, ids, jobs FROM feed_facts').fetchall()
    return {row[0]: {'read_at': row[1], 'judged': bool(row[2]), 'etag': row[3], 'ids': row[4], 'jobs': row[5]} for row in rows}


def fresh(fact, now):
    """Judged for this search less than FRESH_HOURS ago (now: ISO time)."""
    if not fact or not fact['judged']:
        return False
    return datetime.fromisoformat(now) - datetime.fromisoformat(fact['read_at']) < timedelta(hours=FRESH_HOURS)


def ask(fact):
    """The tag to send with "changed since?", or None (never judged: the list must be read whatever it is)."""
    return fact['etag'] if fact and fact['judged'] else None


def tag_of(state):
    """The site's tag for this read, kept only when the read took one request (a paged list's first page says nothing about the others),
    or a paged site's newest-page tag (ats.first_page)."""
    if state is None or not state.etag:
        return None
    from .ats import HEAD
    return state.etag if state.etag.startswith(HEAD) or state.pages == 1 else None   # a paged site's own tag is its newest page


def ids_of(jobs):
    """A 12-character fingerprint of the list's job ids (the same ids in any order give the same one)."""
    return hashlib.sha256('\n'.join(sorted(str(job.get('id')) for job in jobs or [])).encode()).hexdigest()[:12]


def keep(db, board, now, judged, etag, jobs):
    db.execute('INSERT OR REPLACE INTO feed_facts (board, search, read_at, judged, etag, ids, jobs) VALUES (?, ?, ?, ?, ?, ?, ?)',
               (board, search_digest(), now, int(bool(judged)), etag, ids_of(jobs), len(jobs or [])))


def still_same(db, board, now):
    """The site said the list is unchanged: it counts as read now, still judged."""
    db.execute('UPDATE feed_facts SET read_at = ? WHERE board = ?', (now, board))


def _triage_on():
    from .. import features
    from ..ai import engine
    return not features.disabled('title_triage') and engine.ready()


def settled(job):
    """Every answer this job needs for this search is there: its title (role words, or the AI's answer) and, for a title that fits, its place."""
    from . import feeds
    title = job.get('title') or ''
    if feeds.wanted_location(job) and not feeds.excluded_title(title) and not feeds.sure_title(title) and _triage_on() \
            and feeds.title_key(title) not in feeds._triaged():
        return False
    return not (feeds.placing() and (job.get('location') or '').strip() and feeds.wanted_title(title) and feeds.place_of(job) is None)


def keep_seen(db, report, now=None):
    """The open jobs of the employers this search did not read because their lists are unchanged (report['unchanged']) are still listed:
    seen now, so store.close_stale (7 days) never closes them."""
    names = list(report.get('unchanged') or [])
    if not names:
        return 0
    stamp = (now or _now()).isoformat(timespec='seconds')
    marks = ','.join('?' * len(names))
    count = db.execute(f"""UPDATE jobs SET last_seen_at = ? WHERE state = 'open' AND source_id IN
        (SELECT id FROM sources WHERE kind = 'employer feed' AND name IN ({marks}))""", (stamp, *names)).rowcount
    db.commit()
    return count
