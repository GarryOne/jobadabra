"""The employer behind every job a board or aggregator lists (spec docs/superpowers/specs/2026-10-18-search-learns-sources.md, PR 4).
A job whose company is missing ("Unknown employer") or only the board's name ("via <board>") has its employer read from the job page's own
JobPosting data (hiringOrganization), a few pages per run. Every real employer name seen is kept in data/board_employers.json and offered to
the scout (scout_candidates.board_employer_candidates) with the origin "Board employer"; the scout's queue ranks it by yield, not this file.
Never past a refusal: 401/403 or an unreadable page (a 429 waits: host_pace) leaves the job as it was. Tests: tests/test_board_employers.py."""
import json
import urllib.error
from datetime import datetime, timezone

from . import careers

PLACEHOLDERS = ('Unknown employer', 'via ')   # what the readers put when the page names nobody
MAX_LOOKUPS = 20      # job pages fetched per run for jobs without an employer
MAX_KEPT = 2000       # employer names kept


def fetch(url):
    return careers.get_text(url)


def missing(company):
    company = (company or '').strip()
    return not company or company.startswith(PLACEHOLDERS)


def _file():
    from ..paths import DATA
    return DATA / 'board_employers.json'


def _load():
    try:
        return json.loads(_file().read_text())
    except (OSError, ValueError):
        return {}


def note(jobs, source):
    """Keep the employer names of these jobs (the ones with a real company), counting their jobs per name."""
    names = _load()
    stamp = datetime.now(timezone.utc).isoformat(timespec='seconds')
    for job in jobs:
        name = (job.get('company') or '').strip()
        if missing(name):
            continue
        entry = names.setdefault(name, {'source': source, 'jobs': 0})
        entry.update(jobs=entry['jobs'] + 1, last_seen=stamp)
    if len(names) > MAX_KEPT:
        names = dict(sorted(names.items(), key=lambda item: item[1].get('last_seen', ''))[-MAX_KEPT:])
    if names:
        file = _file()
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(json.dumps(names, ensure_ascii=False, indent=1))


def note_site(name, website, source):
    """Keep one employer met as its own site (a proposed board that is one company's: src/sources/board_check.py), with its address."""
    names = _load()
    entry = names.setdefault(name, {'source': source, 'jobs': 0})
    entry.update(website=website, last_seen=datetime.now(timezone.utc).isoformat(timespec='seconds'))
    file = _file()
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(names, ensure_ascii=False, indent=1))


def candidates():
    """The scout's candidates: every kept employer name, most jobs first (the scout's own queue does the real ranking)."""
    for name, entry in sorted(_load().items(), key=lambda item: -item[1].get('jobs', 0)):
        yield dict(name=name, origin='Board employer', priority=65, **({'website': entry['website']} if entry.get('website') else {}))


def fill_missing(jobs, fetch=None):
    """Set the company of jobs that have none from their job page's hiringOrganization; at most MAX_LOOKUPS pages, refusals left alone."""
    fetch = fetch or globals()['fetch']
    from . import read_budget
    if read_budget.past_cut():   # past the search's read cut no page is read: the next search names them (tests/test_three_minutes.py)
        waiting = min(MAX_LOOKUPS, sum(1 for job in jobs if missing(job.get('company')) and job.get('url')))
        from .. import time_budget
        time_budget.later('employer names', waiting, 'job pages' if waiting != 1 else 'job page')
        return
    asked = 0
    for job in jobs:
        if not missing(job.get('company')) or not job.get('url'):
            continue
        if asked >= MAX_LOOKUPS:
            break
        asked += 1
        try:
            found = careers.jsonld_jobs(fetch(job['url']), job['url'])
        except (urllib.error.URLError, OSError, ValueError):
            continue
        name = next((j['employer'] for j in found if j.get('employer')), '')
        if name:
            job['company'] = name
