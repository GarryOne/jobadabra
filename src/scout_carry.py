"""The central scout's feed slices: each run verifies the feeds not read for longest, and carries the others over from their last verified entry.
Why: 22-23 Oct 2026, re-reading every known feed on every run took 12 to 39+ minutes; the job must end in 15-20 minutes (owner).
Tests: tests/test_scout_carry.py."""

import json
import urllib.request
from datetime import datetime, timedelta

CARRY_DAYS = 7   # a feed not verified for this long leaves the index until it answers again


def ensure(db):
    db.execute('CREATE TABLE IF NOT EXISTS feed_entries (ats TEXT NOT NULL, slug TEXT NOT NULL, entry TEXT NOT NULL, verified_at TEXT NOT NULL, '
               'PRIMARY KEY (ats, slug))')


def order(db, items):
    """The known feeds, never-verified first, then the longest unverified: a run that stops early has read the ones most due."""
    ensure(db)
    seen = {(r[0], r[1]): r[2] for r in db.execute('SELECT ats, slug, verified_at FROM feed_entries')}
    return sorted(items, key=lambda item: seen.get(item[0], ''))


def keep(db, entries, at):
    """Remember the verified, published entries (each with its freshness) so the next runs can carry them."""
    ensure(db)
    for entry in entries:
        db.execute('INSERT OR REPLACE INTO feed_entries (ats, slug, entry, verified_at) VALUES (?, ?, ?, ?)',
                   (entry['ats'], entry['slug'], json.dumps(entry, ensure_ascii=False), at))
    db.commit()


def carried(db, skipped, at):
    """The kept entries of feeds this run did not reach, when verified within CARRY_DAYS: [entry]."""
    ensure(db)
    cutoff = (datetime.fromisoformat(at) - timedelta(days=CARRY_DAYS)).date().isoformat()
    out = []
    for key in skipped:
        row = db.execute('SELECT entry, verified_at FROM feed_entries WHERE ats = ? AND slug = ?', key).fetchone()
        if row and row[1] >= cutoff:
            out.append(json.loads(row[0]))
    return out


def seed(db, url, key, get=None):
    """Entries for the feeds of the index published now that this scout has no stored entry for: a first slice run, or a cache lost, must never drop
    them (24 Oct 2026: the first slice run left 1250 feeds out of the index because there was nothing to carry). Dated by their own read date.
    Returns the number added; a download that fails adds none (said, never fatal)."""
    ensure(db)

    def default_get(request):
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    try:
        published = (get or default_get)(urllib.request.Request(url, headers={'Authorization': f'Bearer {key}', 'User-Agent': 'jobadabra-scout'}))
        have = {(r[0], r[1]) for r in db.execute('SELECT ats, slug FROM feed_entries')}
        added = 0
        for entry in published.get('feeds') or []:
            if not isinstance(entry, dict) or not entry.get('ats') or not entry.get('slug') or (entry['ats'], entry['slug']) in have or not entry.get('checked'):
                continue
            db.execute('INSERT OR IGNORE INTO feed_entries (ats, slug, entry, verified_at) VALUES (?, ?, ?, ?)',
                       (entry['ats'], entry['slug'], json.dumps(entry, ensure_ascii=False), str(entry['checked'])[:10]))
            added += 1
        db.commit()
        return added
    except Exception as error:  # noqa: BLE001 — without it the run still goes on, with what it stored itself
        print(f'Warning: the published index was not read for carrying ({type(error).__name__}: {error})')
        return 0
