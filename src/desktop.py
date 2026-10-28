#!/usr/bin/env python3
"""JSON commands for the desktop app (desktop/), which runs this package as a local helper.

    python -m src.desktop jobs [--limit 200]     ranked open jobs with fit score and application status
    python -m src.desktop status <URL> <status>  record an application status locally (applied, saved, dismissed)
    python -m src.desktop posting <code>         one job's posting (title, company, description) for CV tailoring
    python -m src.desktop strategy               the Strategy page: targets, how matches score, what's avoided, counts

The app sets JOB_PILOTTO_CONFIG_DIR / JOB_PILOTTO_DATA_DIR / JOB_PILOTTO_PROFILE_FILE, so everything
here reads and writes the user's own folder. Output is one JSON document on stdout.
"""
import argparse
import json
import os
from .ai import providers
from datetime import datetime, timezone
from pathlib import Path
import sys

from . import digest, store  # noqa: F401 (tests patch desktop.digest / desktop.store)
from .ai import provenance, score
from .notion.client import job_code  # noqa: F401 (tests read desktop.job_code)
from .paths import JOBS_DB

# The pieces live in desktop_jobs.py, desktop_status.py and desktop_strategy.py; their names stay reachable here (src.desktop.jobs, ...),
# and the tests patch the shared modules (digest, score, store) through this one.
from .desktop_jobs import (GONE, MIN_POSTING, NO_POSTING, NOT_ELIGIBLE, NOT_YET, _deleted_urls, _fit_detail, _kit, jobs, store_posting, posting,  # noqa: F401
                           stage_status)
from .desktop_status import NOTION_STAGES, InProcess, _mark, _matches_rows, delete_job, set_status  # noqa: F401
from .desktop_strategy import (COMPONENTS, GOAL_ROWS, _goals, _quietly, _readable, _section, _visits, calendar_jobs,  # noqa: F401
                               feeds_remote_wanted, strategy)

from .desktop_tracker import (
    _tracker, _unapply, _not_submitted, _places_now, _clear_jobs,
    _rescore_outdated, _refresh_locations, _tune,
)
from .desktop_visits import (
    _visit_outcome,
    _visit_hide,
    _stuck_jobs,
    _stuck_dismiss,
    _set_description,
    _visit_unblock,
    _visit_filters,
    _visit_context,
    _visit_session,
    _visit_jobpages,
    _visit_jobpage,
    _refused_queue,
    _refused_judge,
    _visit_understand,
    _visit_recipe,
)

STATUSES = ('unreviewed', 'saved', 'applied', 'dismissed')


def _role_ideas_on():
    """An AI is on for the role ideas: they carry the role suggestions, the fixed words none (src/coverage.py verdict by_ai)."""
    from .suggestions_search import ideas_on
    return ideas_on()


# -> parsed desktop command arguments, preserving argparse help and errors.
def _parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    listing = sub.add_parser('jobs')
    listing.add_argument('--limit', type=int, default=200)
    listing.add_argument('--first-run', action='store_true', help='the first search is still running: list the jobs waiting for a score too')
    sub.add_parser('delete').add_argument('url')   # a dismissed job: its Notion pages to the trash, the local copy a marker (delete_job)
    marking = sub.add_parser('status')
    marking.add_argument('url')
    marking.add_argument('status', choices=STATUSES)
    sub.add_parser('unapply').add_argument('url')  # a session ended without a submission: Applying -> Kit ready
    sub.add_parser('not-submitted').add_argument('url')  # an Applied was wrong: back to Applying (never a stage with evidence)
    sub.add_parser('posting').add_argument('code')
    sub.add_parser('calendar')   # the Calendar's jobs: Applications rows only, no search cache (a fraction of `jobs`)
    clearing = sub.add_parser('clear-jobs')   # Settings → Clear my job list (src/clear_jobs.py): found and scored jobs go, what you acted on stays
    clearing.add_argument('--dry-run', action='store_true')   # only the counts
    sub.add_parser('strategy')
    sub.add_parser('rescore-outdated')
    sub.add_parser('refresh-locations').add_argument('--url', default='')   # one job's refresh from its drawer; none = every active one
    sub.add_parser('places-now')   # the fingerprint of today's places: a job whose score used another says "older places" (lib/places-now.js)
    sub.add_parser('tune')   # Tune my strategy: what your outcomes say about the search settings (src/tune.py)
    sub.add_parser('explain-coverage')   # 'Explain with AI' on a jobs check with few new jobs (src/ai/few_jobs.py): on the user's click only
    sub.add_parser('visit-outcome').add_argument('file')   # a browser run's results (JSON [{url, ok, why}]): failures remembered (src/sources/visits.py)
    sub.add_parser('visit-hide').add_argument('url')   # you removed this site from the list: not offered again
    sub.add_parser('stuck-jobs')   # open jobs in your places whose posting text only your browser can read (src/sources/describe.py stuck)
    sub.add_parser('stuck-dismiss').add_argument('url')   # you dismissed this job in "Jobs we couldn't read": not offered again
    sub.add_parser('set-description').add_argument('file')   # a posting's text read in your browser (JSON: url, text): kept for that job
    sub.add_parser('visit-list')   # sites only you can open (src/sources/visits.py): refusing employers and portals, least recently read first
    sub.add_parser('visit-unblock').add_argument('file')   # a page with no job list (JSON: url, title, text, ways): at most 2 steps toward it, or "needs you"
    sub.add_parser('visit-filters').add_argument('file')   # a page's filter controls (JSON: url, title, controls): which to set for this search (src/ai/visit_filters.py)
    sub.add_parser('visit-context').add_argument('file')   # for a "Read with Claude" session: the search's own role words and places (plain words)
    sub.add_parser('visit-session').add_argument('session')   # what a Read with Claude session saved (its session name): jobs, matching
    sub.add_parser('visit-jobpages').add_argument('file')   # sites about to be read (JSON [{name, url, kind}]): their job pages, a web search each when unknown
    sub.add_parser('visit-jobpage').add_argument('file')   # a page that is not a job list (JSON: url, html): the job list's address, kept per site
    sub.add_parser('visit-read').add_argument('file')
    refused = sub.add_parser('refused-queue')
    refused.add_argument('--now', action='append', default=[])   # a site to read at once (the person opened a job there)
    refused.add_argument('--all', action='store_true')   # Check for new jobs: every refused site, resting or not
    # refused-queue: refused employer sites and boards due now (src/sources/refused_reads.py); the app asks to count them after a Find jobs run and to hand them out after the person's press
    sub.add_parser('refused-judge').add_argument('file')   # what a page in the real tab is now (JSON: url, status, html, title, final): page, passive_check, captcha, login or refused
    sub.add_parser('refused-outcome').add_argument('file')   # what the extension's fetch of one of them brought (JSON: url, status, html, title, final)
    sub.add_parser('visit-understand').add_argument('file')   # a page outline the extension could not read: Claude's recipe, kept per site
    sub.add_parser('visit-recipe').add_argument('file')   # the recipe kept for a site (JSON: url, forget), or null   # a page the extension sent (JSON: url, html, cards, title, session): its jobs, kept as a feed
    sub.add_parser('role-ideas')   # roles suggested from the Profile, counted in the places' titles; the words set aside come from the store
    sub.add_parser('coverage')   # how much of the market the role keywords catch, and what adding a term would add (src/coverage.py)
    return parser.parse_args(argv)


# -> the cached posting, falling back to the selected store.
def _posting(db, args):
    found = posting(db, args.code)
    if not found['ok']:  # not in the crawl: a job kept only in the store (Notion, or this Mac's)
        try:
            from .stores import open_stores
            found = store_posting(open_stores(), args.code)
        except Exception as error:  # noqa: BLE001 — the first answer ("job not found") stays when the store can't be read
            print(f'Store posting not read: {type(error).__name__}: {error}', file=sys.stderr)
    return found, False


# -> the requested AI explanation of the current coverage verdict.
def _explain_coverage(db, args):
    from . import coverage
    from .ai import few_jobs
    from .paths import load_search_config
    search = load_search_config()
    places = search.get('locations') or {}
    said = coverage.verdict(coverage.load(), search.get('role_keywords') or [], [f for group in places.values() for f in group],
                            search.get('title_exclude_keywords') or [], by_ai=_role_ideas_on())
    if said is not None:
        said['languages'] = coverage.language_drops()
    return few_jobs.explain(said, search), False


# -> the shared coverage rows for Strategy and Focus.
def _coverage(db, args):
    from . import coverage, suggestions_search
    from .paths import load_search_config
    # One read for Strategy's rows and Focus's (src/suggestions_search.py): the same verdict, each row's key for its Not now / Not true
    return suggestions_search.checked(load_search_config(), coverage.load(), extras=True), False


# -> role ideas from the profile and the stored set-aside answers.
def _role_ideas(db, args):
    from . import coverage
    from .ai import role_ideas
    from .paths import load_search_config, local_profile
    if not _role_ideas_on():
        return {'ok': True, 'ideas': []}, True
    try:
        from .ai.insights_data import ANSWER_CATEGORY
        from .store_access import open_run, profile_source
        from .suggestions import set_aside
        stores = open_run()
        profile = local_profile()
        if not profile:   # the active store's Profile (Notion's page as before)
            read = profile_source(stores)
            profile = read() if read else ''
        try:
            aside = set_aside(stores.insights.list(category=ANSWER_CATEGORY))   # a Not true's words, kept in the store
        except Exception as error:  # noqa: BLE001 - Why (#2350, Gitar): the ideas still come; a set-aside word is left out again at the next read
            print(f'Warning: set-aside roles not read ({type(error).__name__}: {error})', file=sys.stderr)
            aside = []
        found = role_ideas.ideas(profile or '', load_search_config(), (coverage.load() or {}).get('missed_titles') or [], aside)
    except Exception as error:  # noqa: BLE001 — no ideas this time, said; never the fixed words' guess instead (audit PR 6)
        return {'ok': False, 'ideas': [], 'error': f'No role ideas this time ({type(error).__name__})'}, True
    from .suggestions_search import ideas_key
    return {'ok': True, 'ideas': found, 'key': ideas_key(load_search_config())}, False


# -> the refused read result after registering any new feed.
def _refused_outcome(db, args):
    from .sources import refused_reads
    page = json.loads(Path(args.file).read_text())
    result = refused_reads.outcome(str(page.get('url') or ''), page.get('status'), str(page.get('html') or ''), str(page.get('title') or ''), str(page.get('final') or ''), step=page.get('step') if page.get('step') in ('engine', 'download', 'tab') else 'download', captcha=page.get('captcha') is True)
    if result.get('feed'):   # like a page the person opened: the next jobs check reads, filters and scores it
        with store.connect(JOBS_DB) as db:
            from . import scout
            scout.ensure_tables(db)
            db.execute("INSERT OR IGNORE INTO feed_sources (ats, slug, company, tier, quality, added_at) VALUES ('visit', ?, ?, 'Standard', NULL, ?)",
                       (result['feed'], result['name'], datetime.now(timezone.utc).isoformat(timespec='seconds')))
            db.commit()
    return {key: value for key, value in result.items() if key != 'feed'}, False


# -> the browser-read jobs after registering their feeds.
def _visit_read(db, args):
    from .sources import visits
    page = json.loads(Path(args.file).read_text())
    result = visits.read(page['url'], page.get('html') or '', page.get('cards'), page.get('title') or '', session=page.get('session') or '',
                         start=page.get('start') or '', known_list=bool(page.get('known_list')), place=str(page.get('place') or ''))
    with store.connect(JOBS_DB) as db:   # the page becomes one of this user's feeds: the next jobs check reads, filters and scores it
        from . import scout
        scout.ensure_tables(db)
        db.execute("""INSERT OR IGNORE INTO feed_sources (ats, slug, company, tier, quality, added_at) VALUES ('visit', ?, ?, 'Standard', NULL, ?)""",
                   (result['feed'], result['name'], datetime.now(timezone.utc).isoformat(timespec='seconds')))
        # A page that is a job system the engine reads by itself (Chanel's Workday, 7 Oct 2026): a feed like any other from now on, read
        # whole with each job's place at every search, no browser needed.
        from .sources import ats
        system = ats.detect(page['url'])
        if system and system[0] in ats.FETCHERS and system[0] not in ('careers', 'visit'):
            company = (page.get('site') or result['name'])[:120]
            added = db.execute("""INSERT OR IGNORE INTO feed_sources (ats, slug, company, tier, quality, added_at) VALUES (?, ?, ?, 'Standard', NULL, ?)""",
                               (system[0], system[1], company, datetime.now(timezone.utc).isoformat(timespec='seconds'))).rowcount
            if added:
                print(f'Visit: {company} runs on {system[0]} ({system[1]}): read by every search from now on, no browser needed', file=sys.stderr)
        db.commit()
    return {'ok': True, 'name': result['name'], 'jobs': len(result['jobs']), 'added': result['added'], 'fits': result['fits'], 'kind': result['kind'],
                      'in_places': result.get('in_places', 0), 'placed': result.get('placed', 0)}, False


# -> the calendar jobs from the chosen store.
def _calendar(db, args):
    tracker = _tracker()
    from .store_access import run_stores
    return calendar_jobs(*run_stores(tracker)), False


# -> the current strategy page data.
def _strategy(db, args):
    tracker = _tracker()
    return strategy(db, tracker), False


# -> the chosen job list with current kit inputs and cache freshness.
def _jobs(db, args):
    tracker = _tracker()
    from .stores import open_stores
    found, stores = None, None
    # Notion only when it holds the data: a token can outlive a move to this Mac's store.
    notion = tracker if os.environ.get('JOB_PILOTTO_STORE', 'notion') == 'notion' else None
    if notion:
        try:
            found = notion.notion_jobs()  # the list, from Notion
        except Exception as error:  # the list still shows from the cache, marked as possibly out of date
            print(f'Warning: Notion unavailable, showing the cached list: {type(error).__name__}: {error}',
                  file=__import__('sys').stderr)
    elif os.environ.get('JOB_PILOTTO_STORE', 'notion') != 'notion':  # the person chose a store on this Mac: the list is its rows
        from .desktop_store_jobs import store_jobs
        stores = open_stores()
        found = store_jobs(stores)
    current = None  # the inputs a kit would be drafted from now: to tell current kits from earlier ones
    if found and any(_kit(job.get('stage'), job.get('next_step') or '') for job in found):
        try:
            from .ai import kit
            # Read exactly as the kit records them (src/daily_helpers.py prepare_kit), on every store (D7): on Notion the Profile as
            # Tracker.page_text reads it, as kits recorded it before the store adapters, so those kits stay current too.
            stores = stores or open_stores(tracker=notion)
            answers = kit.standard_answers(stores)
            current = provenance.kit_inputs(stores.texts.plain('profile'), answers)   # as kits read it (texts.plain)
        except Exception:  # noqa: BLE001 — kits then show as "inputs unknown"
            pass
    from .ai import engine as ai_engine
    result = jobs(db, args.limit, notion_jobs=found, kit_inputs=current, hide_unscored=ai_engine.ready() and not args.first_run)
    fresh = found is not None
    if notion and not fresh:
        result['stale'] = True
    return result, False


# -> the result of deleting a dismissed job.
def _delete(db, args):
    tracker = _tracker()
    from .stores import open_stores
    stores = open_stores(tracker=tracker)
    return delete_job(db, args.url, stores), False


# -> the result of recording a job status.
def _status(db, args):
    tracker = _tracker()
    from .stores import open_stores
    stores = open_stores(tracker=tracker)
    return set_status(db, args.url, args.status, stores), False


# -> the browser-only sites for the current search.
def _visit_list(db, args):
    from .paths import load_search_config
    return {'ok': True, 'visits': _visits(load_search_config(matching=False))}, False


# Handlers return (payload, ensure_ascii); command-specific imports stay in their bodies.
_COMMANDS = {
    'jobs': _jobs,
    'delete': _delete,
    'status': _status,
    'unapply': _unapply,
    'not-submitted': _not_submitted,
    'posting': _posting,
    'calendar': _calendar,
    'clear-jobs': _clear_jobs,
    'strategy': _strategy,
    'rescore-outdated': _rescore_outdated,
    'refresh-locations': _refresh_locations,
    'places-now': _places_now,
    'tune': _tune,
    'explain-coverage': _explain_coverage,
    'visit-outcome': _visit_outcome,
    'visit-hide': _visit_hide,
    'stuck-jobs': _stuck_jobs,
    'stuck-dismiss': _stuck_dismiss,
    'set-description': _set_description,
    'visit-list': _visit_list,
    'visit-unblock': _visit_unblock,
    'visit-filters': _visit_filters,
    'visit-context': _visit_context,
    'visit-session': _visit_session,
    'visit-jobpages': _visit_jobpages,
    'visit-jobpage': _visit_jobpage,
    'visit-read': _visit_read,
    'refused-queue': _refused_queue,
    'refused-judge': _refused_judge,
    'refused-outcome': _refused_outcome,
    'visit-understand': _visit_understand,
    'visit-recipe': _visit_recipe,
    'role-ideas': _role_ideas,
    'coverage': _coverage,
}

# These commands printed after the database context exited; all others printed inside it.
_OUTPUT_AFTER_DB = frozenset(('jobs', 'delete', 'status'))


# -> the common JSON stdout record and successful exit code.
def _output(result):
    payload, ensure_ascii = result
    print(json.dumps(payload, ensure_ascii=ensure_ascii))
    return 0


# -> parse, dispatch and emit one record at the command's original database boundary.
def main(argv=None):
    args = _parse_args(argv)
    handler = _COMMANDS[args.command]
    with store.connect(JOBS_DB) as db:
        result = handler(db, args)
        if args.command not in _OUTPUT_AFTER_DB:
            return _output(result)
    return _output(result)


if __name__ == '__main__':
    raise SystemExit(main())
