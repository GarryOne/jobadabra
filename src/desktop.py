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

STATUSES = ('unreviewed', 'saved', 'applied', 'dismissed')


def _role_ideas_on():
    """An AI is on for the role ideas: they carry the role suggestions, the fixed words none (src/coverage.py verdict by_ai)."""
    from .suggestions_search import ideas_on
    return ideas_on()


def main(argv=None):
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
    args = parser.parse_args(argv)
    with store.connect(JOBS_DB) as db:
        if args.command == 'posting':
            found = posting(db, args.code)
            if not found['ok']:  # not in the crawl: a job kept only in the store (Notion, or this Mac's)
                try:
                    from .stores import open_stores
                    found = store_posting(open_stores(), args.code)
                except Exception as error:  # noqa: BLE001 — the first answer ("job not found") stays when the store can't be read
                    print(f'Store posting not read: {type(error).__name__}: {error}', file=sys.stderr)
            print(json.dumps(found, ensure_ascii=False))
            return 0
        if args.command == 'explain-coverage':
            from . import coverage
            from .ai import few_jobs
            from .paths import load_search_config
            search = load_search_config()
            places = search.get('locations') or {}
            said = coverage.verdict(coverage.load(), search.get('role_keywords') or [], [f for group in places.values() for f in group],
                                    search.get('title_exclude_keywords') or [], by_ai=_role_ideas_on())
            if said is not None:
                said['languages'] = coverage.language_drops()
            print(json.dumps(few_jobs.explain(said, search), ensure_ascii=False))
            return 0
        if args.command == 'coverage':
            from . import coverage, suggestions_search
            from .paths import load_search_config
            # One read for Strategy's rows and Focus's (src/suggestions_search.py): the same verdict, each row's key for its Not now / Not true
            print(json.dumps(suggestions_search.checked(load_search_config(), coverage.load(), extras=True), ensure_ascii=False))
            return 0
        if args.command == 'role-ideas':
            from . import coverage, features
            from .ai import engine, role_ideas
            from .paths import load_search_config, local_profile
            if not _role_ideas_on():
                print(json.dumps({'ok': True, 'ideas': []}))
                return 0
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
                print(json.dumps({'ok': False, 'ideas': [], 'error': f'No role ideas this time ({type(error).__name__})'}))
                return 0
            from .suggestions_search import ideas_key
            print(json.dumps({'ok': True, 'ideas': found, 'key': ideas_key(load_search_config())}, ensure_ascii=False))
            return 0
        if args.command == 'visit-outcome':
            from .sources import visits
            visits.outcome(json.loads(Path(args.file).read_text()))
            print(json.dumps({'ok': True}))
            return 0
        if args.command == 'visit-hide':
            from .sources import visits
            visits.hide(args.url)
            print(json.dumps({'ok': True}))
            return 0
        if args.command == 'stuck-jobs':
            from .sources import describe
            print(json.dumps({'ok': True, 'jobs': describe.stuck(db)}, ensure_ascii=False))
            return 0
        if args.command == 'stuck-dismiss':
            from .sources import visits
            visits.dismiss(args.url)
            print(json.dumps({'ok': True}))
            return 0
        if args.command == 'set-description':
            from .sources import describe
            data = json.loads(Path(args.file).read_text())
            print(json.dumps({'ok': True, 'saved': describe.save_text(db, data.get('url') or '', data.get('text') or '')}))
            return 0
        if args.command == 'visit-list':
            from .paths import load_search_config
            print(json.dumps({'ok': True, 'visits': _visits(load_search_config(matching=False))}, ensure_ascii=False))
            return 0
        if args.command == 'visit-context':
            from .notion.search_settings import terms
            from .paths import load_search_config
            search = load_search_config(matching=False)
            places = search.get('locations') or {}
            print(json.dumps({'role_words': terms(search.get('role_keywords'))[:10], 'places_first': terms(places.get('top_tier'))[:6],
                              'places_also': terms((places.get('country_wide') or []) + (places.get('abroad') or []))[:6],
                              'title_words_ruled_out': terms(search.get('title_exclude_keywords'))[:12]}, ensure_ascii=False))
            return 0
        if args.command == 'visit-unblock':
            from .ai import visit_unblock
            from .paths import load_search_config
            from .digest import PREFERENCES
            page = json.loads(Path(args.file).read_text())
            try:
                planned = visit_unblock.plan_twice(page, load_search_config(matching=False), PREFERENCES)
            except Exception as error:  # noqa: BLE001 — said to the extension, which stops the site with this reason
                print(json.dumps({'ok': False, 'error': f'{providers.who()} could not find a way to the jobs ({type(error).__name__})'}))
                return 0
            print(f"Visit unblock: {len(planned['steps'])} steps for {str(page.get('url') or '')[:80]}: "
                  + '; '.join(f"{s['action']} {s['label'][:40]}{' = ' + s['value'] if s['value'] else ''}" for s in planned['steps'])
                  + (f" (needs you: {planned['needs_person']})" if planned['needs_person'] else '')
                  + (' (Sonnet, after Haiku found no way)' if planned.get('model') == visit_unblock.SECOND_MODEL else ''), file=sys.stderr)
            print(json.dumps({'ok': True, **planned}, ensure_ascii=False))
            return 0
        if args.command == 'visit-filters':
            from .ai import visit_filters
            from .paths import load_search_config
            from .digest import PREFERENCES
            page = json.loads(Path(args.file).read_text())
            try:
                planned = visit_filters.plan(page, load_search_config(matching=False), PREFERENCES)
            except Exception as error:  # noqa: BLE001 — said to the extension, which then reads the page as it is
                print(json.dumps({'ok': False, 'error': f'{providers.who()} could not choose the filters ({type(error).__name__})'}))
                return 0
            print(f"Visit filters: {len(planned['steps'])} steps for {str(page.get('url') or '')[:80]}: "
                  + '; '.join(f"{s['action']} {s['label'][:40]}{' = ' + s['value'] if s['value'] else ''}" for s in planned['steps']), file=sys.stderr)
            print(json.dumps({'ok': True, **planned}, ensure_ascii=False))
            return 0
        if args.command in ('visit-understand', 'visit-recipe'):
            from .sources import visits
            page = json.loads(Path(args.file).read_text())
            if args.command == 'visit-recipe':
                if page.get('forget'):
                    visits.forget_recipe(page['url'])
                forgot = bool(page.get('missed')) and visits.recipe_missed(page['url'])
                print(json.dumps({'ok': True, 'forgot': forgot, 'recipe': None if page.get('forget') or forgot else visits.recipe_for(page['url'])}))
                return 0
            from .ai import visit_reader
            try:
                recipe, model = visit_reader.understand_twice(page)
                if model == visit_reader.SECOND_MODEL:   # said, so the log shows whether the second try pays off
                    print(f"Visit: Haiku found no job list on {str(page.get('url') or '')[:80]}; Sonnet did", file=sys.stderr)
                elif not recipe and page.get('groups'):
                    print(f"Visit: no job list on {str(page.get('url') or '')[:80]}, by Haiku nor Sonnet", file=sys.stderr)
            except Exception as error:  # noqa: BLE001 — said; the extension reads what its quick guess found
                print(json.dumps({'ok': False, 'error': f'{providers.who()} could not read this page ({type(error).__name__})'}))
                return 0
            if recipe:
                visits.save_recipe(page['url'], recipe)
            print(json.dumps({'ok': True, 'recipe': recipe}, ensure_ascii=False))
            return 0
        if args.command == 'visit-session':
            from .sources import visits
            print(json.dumps({'ok': True, 'result': visits.session_result(args.session)}, ensure_ascii=False))
            return 0
        if args.command == 'visit-jobpages':
            from .sources import visits
            from . import employer_index
            sites = json.loads(Path(args.file).read_text())
            print(json.dumps({'ok': True, 'pages': visits.find_job_pages(sites, employer_index.me_now().get('countries') or [])}))
            return 0
        if args.command == 'visit-jobpage':
            from .sources import visits
            page = json.loads(Path(args.file).read_text())
            print(json.dumps({'ok': True, 'url': visits.job_page(page['url'], page.get('html') or '')}))
            return 0
        if args.command == 'refused-queue':
            from .sources import refused_reads
            print(json.dumps({'ok': True, 'sites': refused_reads.queue(now_hosts=args.now, everything=args.all)}, ensure_ascii=False))
            return 0
        if args.command == 'refused-judge':
            from .sources import refused_state
            page = json.loads(Path(args.file).read_text())
            print(json.dumps({'ok': True, 'state': refused_state.page_state(page.get('status'), str(page.get('html') or ''), str(page.get('title') or ''), str(page.get('final') or ''))}))
            return 0
        if args.command == 'refused-outcome':
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
            print(json.dumps({key: value for key, value in result.items() if key != 'feed'}, ensure_ascii=False))
            return 0
        if args.command == 'visit-read':
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
            print(json.dumps({'ok': True, 'name': result['name'], 'jobs': len(result['jobs']), 'added': result['added'], 'fits': result['fits'], 'kind': result['kind'],
                              'in_places': result.get('in_places', 0), 'placed': result.get('placed', 0)}, ensure_ascii=False))
            return 0
        from .notion.client import Tracker
        tracker = Tracker.from_env()
        if args.command in ('unapply', 'not-submitted'):
            from .stores import open_stores, rules
            stores = open_stores(tracker=tracker)  # Notion when connected, else this Mac's store: no gate
        if args.command == 'unapply':
            try:
                outcome = rules.revert_applying(stores, args.url)
            except Exception as error:  # noqa: BLE001 — shown to the user; nothing changed
                print(json.dumps({'ok': False, 'error': f'Your job tracker could not be updated ({type(error).__name__}); nothing changed. Try again.'}))
                return 0
            print(json.dumps({'ok': True, 'notion': outcome}))
            return 0
        if args.command == 'not-submitted':
            # The owner says an Applied was wrong. Only a bare Applied is undone, and its false 📈 event goes with
            # it, so the application's timeline does not keep a submission that never happened (1 Oct 2026).
            try:
                outcome, row = rules.revert_unsubmitted(stores, args.url)
                dropped = stores.events.archive(row['id'], 'Applied') if outcome == rules.UPDATED and row else 0
            except Exception as error:  # noqa: BLE001 — shown to the user; nothing changed
                print(json.dumps({'ok': False, 'error': f'Your job tracker could not be updated ({type(error).__name__}); nothing changed. Try again.'}))
                return 0
            errors = {'unchanged': 'That job is not at Applied, so there is nothing to undo.',
                      'past': 'That job is past Applied (a confirmation or an interview is recorded), so its stage is not changed here.'}
            print(json.dumps({'ok': outcome == rules.UPDATED, 'notion': outcome, 'events': dropped,
                              **({} if outcome == rules.UPDATED else {'error': errors[outcome]})}))
            return 0
        if args.command == 'calendar':
            from .store_access import run_stores
            print(json.dumps(calendar_jobs(*run_stores(tracker)), ensure_ascii=False))
            return 0
        if args.command == 'places-now':
            from .ai import locations
            print(json.dumps({'places': locations.fingerprint_now()}))
            return 0
        if args.command == 'clear-jobs':
            from . import clear_jobs
            from .store_access import run_stores
            stores, _ = run_stores(tracker)
            keep = True   # the person's own dismissals always stay
            try:
                result = clear_jobs.plan(db, stores, keep) if args.dry_run else {'ok': True, **clear_jobs.clear(db, stores, keep)}
            except Exception as error:  # noqa: BLE001 — shown to the person; the store is written first, so a refusal changed nothing local
                result = {'ok': False, 'error': f'Your job list could not be cleared ({type(error).__name__}); nothing changed. Try again.'}
            print(json.dumps(result, ensure_ascii=False))
            return 0
        if args.command == 'rescore-outdated':   # Strategy's one Re-score: every outdated job once (src/desktop_strategy.py outdated)
            from .desktop_strategy import rescore_outdated
            from .store_access import run_stores, url_stages
            stores, _ = run_stores(tracker)
            try:
                stages = url_stages(stores)
            except Exception:  # noqa: BLE001 (stages that cannot be read: every shown job counts as active)
                stages = {}
            print(json.dumps({'queued': rescore_outdated(db, stages)}))
            return 0
        if args.command == 'refresh-locations':   # the explicit refresh after a change of places: active jobs only (src/ai/locations.py)
            from .ai import locations
            from .store_access import run_stores
            from .store_access import url_stages
            stores, _ = run_stores(tracker)
            try:
                stages = url_stages(stores)
            except Exception:  # noqa: BLE001 (stages that cannot be read: every shown job counts as active)
                stages = {}
            active = locations.active_ids(db, stages)
            if args.url:
                active &= locations.id_for_url(db, args.url)
            print(json.dumps({'queued': locations.refresh(db, locations.current(), active)}))
            return 0
        if args.command == 'tune':
            from .store_access import run_stores, url_stages
            stores, notion = run_stores(tracker)
            if stores.name == 'notion' and not notion:   # Notion chosen but not readable: as before
                print(json.dumps({'ok': False, 'error': 'Connect Notion first: your outcomes (dismissed, applied, interviews) live there.'}))
                return 0
            from . import tune
            from .paths import load_search_config
            print(json.dumps(tune.run(db, notion, load_search_config(), stages=url_stages(stores)), ensure_ascii=False))
            return 0
        if args.command == 'strategy':
            print(json.dumps(strategy(db, tracker), ensure_ascii=False))
            return 0
        if args.command == 'jobs':
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
        else:
            from .stores import open_stores
            stores = open_stores(tracker=tracker)
            result = delete_job(db, args.url, stores) if args.command == 'delete' else set_status(db, args.url, args.status, stores)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
