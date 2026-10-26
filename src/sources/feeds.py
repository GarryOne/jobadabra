#!/usr/bin/env python3
"""Small, dependency-free job watcher. Python 3.10+."""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import hashlib
import html
import json
import os
from pathlib import Path
import re
import sqlite3
import unicodedata
import urllib.request

from . import ats, posting_text
from .. import country_codes, coverage, run_counts
from ..paths import CONFIG, DATA, REPORTS, keyword_regex, load_search_config, place_regex
from ..ai import batch_scope, providers
from ..ai.providers.contract import detail, reason

DESCRIPTION_LIMIT = 12000
_SEARCH = load_search_config()


def plain_text(markup):
    """Greenhouse sends HTML-escaped HTML; return readable text that keeps its structure (src/sources/posting_text.py)."""
    return posting_text.html_to_text(markup, DESCRIPTION_LIMIT)


# Feed jobs whose title doesn't match config/search.json's role_keywords never reach the digest.
TITLES = keyword_regex(_SEARCH['role_keywords'])
# Titles that contain a role keyword but are another job entirely ("Infrastructure Tax Lead", "SAP ABAP
# Developer"): dropped before any AI step, from feeds, job boards and Google Jobs alike.
EXCLUDED_TITLES = keyword_regex(_SEARCH.get('title_exclude_keywords') or [r'(?!x)x'])


TRIAGED = None   # {title: could fit} decided by Claude for this search (src/ai/title_triage.py), read once a run


def title_key(title):
    return ' '.join(str(title or '').lower().split())[:160]   # how the AI's answers for titles are kept


def judged_title(title):
    """The AI's answer for this title in this search (src/ai/title_triage.py): True, False, or None when it has not judged it yet."""
    return _triaged().get(title_key(title))


def _words_title(title):
    """The words' answer, for a title the AI has not judged (no AI, or not reached yet): none of title_exclude_keywords and a role keyword."""
    if EXCLUDED_TITLES.search(title or '') or EXCLUDED_TITLES.search(plain(title)):
        return False
    return bool(TITLES.search(title or '') or TITLES.search(plain(title)))


def wanted_title(title):
    """A title we score: the AI's answer when it judged it for this search (src/ai/title_triage.py; owner, 26 Oct 2026: "The AI decides"; a
    role word kept "Pilote / Product Owner" for a pilot search, a level word dropped "Senior First Officer"); else the words (_words_title)."""
    judged = judged_title(title)
    return _words_title(title) if judged is None else judged


def sure_title(title):
    """A title shown at once, before the AI sort (src/sources/feed_scan.py): the same answer, so a role-word hit shows until the AI says no
    (owner, 26 Oct 2026: "Show at once, AI removes"; keep_open closes one it later rejects)."""
    return wanted_title(title)


def _triaged_shared():
    global TRIAGED
    if TRIAGED is None:
        try:
            from ..ai import title_triage
            TRIAGED = dict(title_triage.known(_SEARCH))
        except Exception:  # noqa: BLE001 — nothing decided yet: the exact words only
            TRIAGED = {}
    return TRIAGED


batch_scope.watch('triaged', _triaged_shared, lambda own: _triaged_shared().update(own))


def _triaged():
    """The titles decided; a reader side by side with another sees its own (src/ai/batch_scope.py)."""
    return batch_scope.view('triaged', _triaged_shared)


def triage(jobs):
    """Ask Claude about the titles of these jobs that are in the user's places, the role and excluded words' hits too (once per title and search).
    Off without AI or with JOB_PILOTTO_DISABLE=title_triage: the exact words only."""
    from .. import features
    from ..ai import engine
    from ..time_budget import best_first   # your best places' titles first: a short search sorts them before the rest
    asked = [job for job in jobs if job.get('title') and wanted_location(job)]   # every title in your places, words or not (owner, 26 Oct 2026)
    titles = [job['title'] for job in best_first(asked)]   # sorted after the filter: a first search lists ~60,000 jobs, a few thousand are asked about
    if not titles or features.disabled('title_triage') or not engine.ready():
        return
    here = [job['title'] for job in best_first(asked) if in_my_place(job)]   # located in your places: asked first, and past the clock (time_budget.local_titles)
    try:
        from ..ai import title_triage
        _triaged().update(title_triage.decide(here, _SEARCH, local=True) if here else {})
        _triaged().update(title_triage.decide(titles, _SEARCH))
    except Exception as error:  # noqa: BLE001 — not sorted this run: the exact words only, said
        print(f'Warning: job titles not sorted by {providers.who()} ({reason(error)}): only your role words match this run')
        detail('sources', error)


def in_my_place(job):
    """The job is located in one of your places (Claude's 'best' answer, or the place words name it), not merely remote anywhere."""
    return place_of(job) == 'best' or mentions(PLACE, country_codes.name(job.get('location') or ''))


def excluded_title(title):
    return bool(EXCLUDED_TITLES.search(title or '') or EXCLUDED_TITLES.search(plain(title)))


EXCLUDED_EACH = [(fragment, keyword_regex([fragment])) for fragment in _SEARCH.get('title_exclude_keywords') or []]


def dropped_by(title):
    """The excluded-title word that drops a title the role keywords catch ('' when none): counted, so the app can say what a word costs."""
    if not (TITLES.search(title or '') or TITLES.search(plain(title))):
        return ''
    return next((fragment for fragment, pattern in EXCLUDED_EACH if pattern.search(title or '') or pattern.search(plain(title))), '')

# Feed jobs outside these places (config/search.json's locations, plus generic remote synonyms)
# are dropped before they reach the digest or the AI stages.
# Only the user's places (7 Oct 2026: a hard-coded \bch\b and UAE, left from the first search, let every Swiss town in for a
# Romandie search; a place word "Switzerland" adds \bch\b itself, src/regions.py).
_PLACES = [*_SEARCH['locations']['top_tier'], *_SEARCH['locations']['country_wide'], *_SEARCH['locations']['abroad']]
PLACE = place_regex(_PLACES)
_REMOTE_SYNONYMS = r'remote|anywhere|worldwide|global|emea|europe'


def fetch(source):
    """Normalised jobs for one source: {'company', 'ats' (default greenhouse), 'slug' or legacy 'board'}."""
    return ats.fetch(source.get("ats", "greenhouse"), source.get("slug") or source["board"])


# Remote roles restricted to these regions (config/search.json) are not open to someone in your places.
REMOTE_ELSEWHERE = place_regex(_SEARCH['remote_excluded_regions'] or [r'(?!x)x'])   # no region skipped: an empty pattern would match every text and drop every remote job


def plain(text):
    """The text without accents ("Zürich" -> "Zurich"): a place typed without its umlaut still finds the posting that has it."""
    return "".join(c for c in unicodedata.normalize("NFKD", text or "") if not unicodedata.combining(c))


def mentions(pattern, text):
    """The place words find the text as written or without its accents (7 Oct 2026: "geneva|geneve" missed "Genève, Switzerland", and the
    digest called it outside your places). Every place-word fallback goes through this."""
    return mention_of(pattern, text) is not None


def mention_of(pattern, text):
    """The place words' match in the text, as written or without its accents; None when they do not name it."""
    return (pattern.search(text) or pattern.search(plain(text))) if text else None


def remote_wanted(search=None):
    """False when the settings' "Remote jobs" says no (7 Oct 2026: a photographer and shop seller wants jobs in Geneva and Lausanne only)."""
    said = [str(v).strip().lower() for v in ((search or _SEARCH).get('remote_jobs') or [])]
    return not any(v in ('no', 'non', 'nein', 'none', 'never', 'off', 'false') for v in said)


REMOTE_WANTED = remote_wanted()


PLACED = None   # {location: 'best' | 'in' | 'out'} decided by Claude for these places (src/ai/place_triage.py), read once a run


def _placed_shared():
    global PLACED
    if PLACED is None:
        try:
            from ..ai import place_triage
            PLACED = dict(place_triage.known(_SEARCH))
        except Exception:  # noqa: BLE001 — the place words then decide
            PLACED = {}
    return PLACED


batch_scope.watch('placed', _placed_shared, lambda own: _placed_shared().update(own))


def placed():
    """The places decided; a reader side by side with another sees its own (src/ai/batch_scope.py)."""
    return batch_scope.view('placed', _placed_shared)


READ = None   # {job url: answer} from the postings' own words, for vague locations (src/ai/place_triage.py read), read once a run


def _read_shared():
    global READ
    if READ is None:
        try:
            from ..ai import place_triage
            READ = dict(place_triage.read_known(_SEARCH))
        except Exception:  # noqa: BLE001
            READ = {}
    return READ


batch_scope.watch('read', _read_shared, lambda own: _read_shared().update(own))


def read_places():
    return batch_scope.view('read', _read_shared)


def _verdict(job):
    """Claude's full answer for this job: its location's, or for a vague location (only a country, no place) the posting's own words';
    'vague' while those are not read yet; None when it has not placed the location."""
    from ..ai import place_triage
    from ..ai.place_triage import norm, read_verdict
    verdict = placed().get(norm(job.get('location'))) if (job.get('location') or '').strip() else None
    if verdict == 'out:vague' and (place_triage.excluded_remote(job.get('location'), _SEARCH) or place_triage.cannot_hold_places(job.get('location'), _SEARCH)):
        return 'out'   # remote limited to a region you skip, or a country none of your places is in: outside, whatever an earlier answer said (21 Oct 2026; 24 Oct 2026)
    if verdict == 'out:vague':   # names no town: the posting's own words (src/ai/place_triage.py read)
        read = read_verdict(job, read_places())
        return 'vague' if read is None else 'out' if read == 'unclear' else read
    return verdict


def place_of(job):
    """Claude's answer for this job ('best', 'in', 'out'; 'vague' while its posting is not read yet), or None when it has not placed the
    location (the place words decide then)."""
    verdict = _verdict(job)
    return verdict.split(':')[0] if verdict else None


def needs_visa(job):
    """Claude's answer: True when your work rights do not cover this job's place, False when they do, None when it has not placed it."""
    verdict = _verdict(job)
    return None if verdict in (None, 'vague') else verdict.endswith(':visa')


def triage_places(jobs):
    """Ask Claude where the new locations are, for the jobs that could be kept (their title fits); each location once per version of the
    places. Off without AI or with JOB_PILOTTO_DISABLE=place_triage: the place words only."""
    from .. import features
    from ..ai import engine
    locations = [job.get('location') for job in jobs if (job.get('location') or '').strip() and job.get('title') and wanted_title(job['title'])]
    if not locations or features.disabled('place_triage') or not engine.ready():
        return
    try:
        from ..ai import place_triage
        # A refresh places a batch: the ones your place words name first, then the ones most jobs share (7 Oct 2026: it asked in feed
        # order, Warsaw and Dallas first, and "Genève, Switzerland" with 6 jobs waited behind 1,400 others), each job counted by how close
        # it is to your search (src/job_rank.py; 18 Oct 2026: a first search in Cluj placed 1,313 locations for 10 minutes before scoring)
        from ..job_rank import ranker
        closeness, count = ranker(), Counter()
        for job in jobs:
            if (job.get('location') or '').strip() and job.get('title') and wanted_title(job['title']):
                count[place_triage.norm(job['location'])] += 1 + closeness(job)
        ordered = sorted(count, key=lambda location: (not mentions(PLACE, location), -count[location]))
        placed().update(place_triage.decide(ordered, _SEARCH))
        placed().update(place_triage.vague(ordered, _SEARCH))   # of the ones outside: which name no town of their own
    except Exception as error:  # noqa: BLE001 — not placed this run: the place words decide, said
        print(f'Warning: job locations not placed by {providers.who()} ({reason(error)}): your place words decide this run')
        detail('sources', error)


def placing():
    """True when Claude places the job locations this run (AI ready, place_triage not turned off)."""
    from .. import features
    from ..ai import engine
    return not features.disabled('place_triage') and engine.ready()


def keep_open(job):
    """For the cleanup of jobs outside your places: an open job whose title fits and whose location Claude has not placed for these places
    yet stays open until it has (7 Oct 2026: after a change of places, the place words closed Carouge and Meyrin jobs for a Geneva search;
    place_open_jobs places the open jobs' locations first, so this waits a refresh or two, for the open jobs only)."""
    if judged_title(job.get('title')) is False:
        return False   # its title the AI judged not this search's (a role word had shown it at once): it leaves the list (owner, 26 Oct 2026)
    if placing() and job.get('title') and wanted_title(job['title']) and (job.get('location') or '').strip() and place_of(job) is None:
        return True
    return wanted_location(job)


def place_open_jobs(db):
    """Before the cleanup of jobs outside your places: Claude places the locations of the open jobs too (7 Oct 2026: the job boards' jobs,
    imported straight into the list, never reached it; the place words closed Carouge and Meyrin jobs at every refresh, and the digest
    called "Genève" outside your places)."""
    rows = db.execute("SELECT location, title, url, description FROM jobs WHERE state = 'open' AND COALESCE(location, '') != ''").fetchall()
    triage_places([{'location': location, 'title': title} for location, title, _, _ in rows])
    # A location that names no place of its own: the posting's words tell where the job is (any site, no per-site field)
    vague = [{'location': location, 'title': title, 'url': url, 'description': description or ''} for location, title, url, description in rows]
    vague = [job for job in vague if place_of(job) == 'vague' and job['description']]
    if not vague or not placing():
        return
    try:
        from ..ai import place_triage
        read_places().update(place_triage.read(vague, _SEARCH))
    except Exception as error:  # noqa: BLE001 — read next refresh; until then these jobs stay open
        print(f'Warning: postings not read for their place ({reason(error)}); they stay open until the next refresh')
        detail('sources', error)


def wanted_location(job):
    """One of your places: Claude's answer for this location when it has placed it (src/ai/place_triage.py); else the place words
    (config/search.json), or remote that isn't limited elsewhere (unless you want no remote jobs)."""
    verdict = place_of(job)
    if verdict is not None:
        return verdict != 'out'   # 'vague': kept until its posting is read
    where = country_codes.name(job.get("location") or "")   # a field that is only a country code ("MD") is that country, whichever reader gave it
    if mentions(PLACE, where):
        return True
    if not REMOTE_WANTED:
        return False
    said = re.search(_REMOTE_SYNONYMS, where, re.I)
    # A posting whose place is only a city elsewhere is based there, even when its feed flags it remote (7 Oct 2026: "London" and "Singapore"
    # account executive jobs reached a Geneva search). One that says remote in its place ("Remote, Germany") is judged by the regions you skip.
    if job.get("remote") and not said and where.strip():
        return False
    return bool(job.get("remote") or said) and not REMOTE_ELSEWHERE.search(where)


def database(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    # Its own table name: this file is also the canonical store (src/store.py), whose `jobs` table has a
    # different schema. Sharing the name made every feed insert fail after the 25 Sep 2026 file rename.
    db.execute("""CREATE TABLE IF NOT EXISTS feed_jobs (
        board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT,
        PRIMARY KEY(board, id))""")
    return db


def record(db, board, job, now):
    # Source timestamps aren't publication dates. Compare the actual listing fields.
    fingerprint = hashlib.sha256(json.dumps({
        "title": job["title"], "location": job["location"],
        "url": job["url"]
    }, sort_keys=True).encode()).hexdigest()
    previous = db.execute("SELECT fingerprint FROM feed_jobs WHERE board=? AND id=?",
                          (board, str(job["id"]))).fetchone()
    status = "new" if previous is None else "changed" if previous[0] != fingerprint else "seen"
    db.execute("""INSERT INTO feed_jobs VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(board, id) DO UPDATE SET
        fingerprint=excluded.fingerprint, last_seen=excluded.last_seen""",
        (board, str(job["id"]), fingerprint, now, now))
    return status


FETCH_WORKERS = 8   # feeds downloaded at once; the database work below stays sequential


def _fetched(fetcher, source):
    try:
        return fetcher(source), None
    except Exception as error:  # noqa: BLE001 — reported per source below
        return None, error


# An employer that gave this search nothing (no title match in its places) REST_AFTER checks in a row is skipped for REST_DAYS, then checked
# again (6 Oct 2026: a photographer's checks read 190 software employers every 4 hours for 0 matches). Per install, learned from its own crawl;
# a change of roles or places starts over, since what fits then is different.
REST_AFTER, REST_DAYS = 5, 7
REST_TABLE = 'CREATE TABLE IF NOT EXISTS feed_rest (board TEXT PRIMARY KEY, misses INTEGER NOT NULL, rest_until TEXT, search TEXT NOT NULL)'


def _readers():
    """A fingerprint of the job readers: an employer resting under older readers (which may have read it wrong) is woken by a release.
    Code only (readers.py): a comment or a printed line changed in these files wakes no one."""
    from .readers import code_fingerprint
    return code_fingerprint([f'sources/{name}' for name in ('ats.py', 'careers.py', 'render.py', 'feeds.py')])


READERS = _readers()


def _search_digest(search=None):
    """What a rest depends on: the roles and places searched, and the readers that found nothing (either changing starts over)."""
    search = search or _SEARCH
    return hashlib.sha256(json.dumps([search.get('role_keywords'), search.get('locations'), READERS], sort_keys=True, default=str).encode()).hexdigest()[:12]


def resting(db, now, search=None):
    """The boards resting now ({board: until}); rows of an earlier search are dropped first."""
    db.execute(REST_TABLE)
    db.execute('DELETE FROM feed_rest WHERE search != ?', (_search_digest(search),))
    return {row[0]: row[1] for row in db.execute('SELECT board, rest_until FROM feed_rest WHERE rest_until > ?', (now,))}


def runway(rows, now):
    """How long your employers last (owner, 7 Oct 2026: "how many turns until I exhaust my employers"): rows are feed_rest's (misses, rest_until).
    {'resting', 'until'}: resting now, and when the first of them wakes; {'runs', 'count'}: the next searches with nothing for you after which
    `count` more rest (the biggest group, the sooner of a tie). An employer with a match starts again from 0, so this is the most it can be."""
    resting = sorted(until for _, until in rows if until and until > now)
    left = {}
    for misses, until in rows:
        if not (until and until > now) and misses:
            runs = max(1, REST_AFTER - misses)
            left[runs] = left.get(runs, 0) + 1
    soon = None
    if left:
        runs = max(left, key=lambda k: (left[k], -k))
        soon = {'runs': runs, 'count': sum(n for k, n in left.items() if k <= runs)}
    return {'resting': len(resting), 'until': resting[0] if resting else None, 'soon': soon, 'rest_after': REST_AFTER, 'rest_days': REST_DAYS}


def _after_check(db, board, matched, now, search=None):
    if matched:
        db.execute('DELETE FROM feed_rest WHERE board = ?', (board,))
        return
    row = db.execute('SELECT misses FROM feed_rest WHERE board = ?', (board,)).fetchone()
    misses = (row[0] if row else 0) + 1
    until = (datetime.fromisoformat(now) + timedelta(days=REST_DAYS)).isoformat(timespec='seconds') if misses >= REST_AFTER else None
    db.execute('INSERT OR REPLACE INTO feed_rest (board, misses, rest_until, search) VALUES (?, ?, ?, ?)', (board, misses, until, _search_digest(search)))


def scan(sources, db, fetcher=None, details=None, on_jobs=None):
    """Read every employer feed of a search; the code lives in src/sources/feed_scan.py (moved for the 500-line rule)."""
    from .feed_scan import scan as read_all
    return read_all(sources, db, fetcher=fetcher, details=details, on_jobs=on_jobs)


def render(report):
    esc = lambda value: html.escape(str(value), quote=True)
    jobs = report["jobs"]
    new = sum(j["status"] == "new" for j in jobs)
    failed = sum(not s["ok"] for s in report["sources"])
    rows = "".join(
        f'<article data-search="{esc(j["company"] + " " + j["title"] + " " + j["location"])}">'
        f'<small>{esc(j["company"])} · {esc(j["status"])}</small>'
        f'<h2><a href="{esc(j["url"])}" target="_blank" rel="noopener noreferrer">{esc(j["title"])}</a></h2>'
        f'<p>{esc(j["location"])}</p></article>' for j in jobs)
    sources = "".join(f'<li>{esc(s["company"])}: ' +
        (f'{s["total"]} postings, {s["matches"]} title matches' if s["ok"] else f'FAILED — {esc(s["error"])}') + '</li>'
        for s in report["sources"])
    return f'''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Jobadabra</title>
<style>body{{font:17px system-ui;background:#f4f6fa;color:#182537;max-width:850px;margin:40px auto;padding:0 20px}}
article{{background:white;border:1px solid #dae1e9;padding:20px;border-radius:12px;margin:14px 0}}h2{{font-size:20px;margin:8px 0}}
a{{color:#165bba}}small{{color:#526173}}input{{box-sizing:border-box;width:100%;padding:14px;font:inherit;border:1px solid #8294ac;border-radius:8px}}
[hidden]{{display:none}}p{{line-height:1.5}}</style>
<h1>Jobadabra</h1><p>{len(jobs)} matching postings · {new} newly seen · {failed} failed sources</p>
<p>Last scan: {esc(report["generated_at"])}. New means first seen by this watcher, not newly published.</p>
<p>Worldwide title matches. Location eligibility, seniority and remote conditions have not been screened.</p>
<label for="filter">Filter by company, title or location</label><input id="filter" placeholder="e.g. Switzerland, remote, platform">
<p id="count" aria-live="polite"></p>
{rows or '<p>No matching jobs returned. Check source status below.</p>'}
<details><summary>Source status</summary><ul>{sources}</ul></details>
<script>const input=document.querySelector('#filter');input.addEventListener('input',()=>{{let count=0;
document.querySelectorAll('article').forEach(el=>{{el.hidden=!el.dataset.search.toLowerCase().includes(input.value.toLowerCase());if(!el.hidden)count++;}});
document.querySelector('#count').textContent=count+' visible jobs';}});</script></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=DATA)
    parser.add_argument("--reports-dir", type=Path, default=REPORTS)
    args = parser.parse_args()
    from .. import scout
    sources = scout.starter_list()
    with database(args.data_dir / "jobs.sqlite") as db:
        report = scan(sources, db)
    args.reports_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    for name in (stamp, "latest"):
        (args.reports_dir / f"{name}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        (args.reports_dir / f"{name}.html").write_text(render(report), encoding="utf-8")
    print(json.dumps({"matches": len(report["jobs"]), "new": sum(j["status"] == "new" for j in report["jobs"]),
                      "sources": report["sources"], "report": str(args.reports_dir / "latest.html")}, indent=2))
    return 1 if any(not s["ok"] for s in report["sources"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
