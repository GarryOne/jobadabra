"""The jobs check's search itself (modes scheduled, run, today, more): crawl the feeds, import, enrich, score, sync Job Matches and the
ledger, build the digest, send it to Telegram, save and log the run. `search(args, stores)` returns the exit code. The data is the
active store's (src/stores: open once, passed down), on every store; this Mac's store never gets a copy in Notion.
Tests: tests/test_daily.py, tests/test_refresh_batch.py, tests/test_search_budget.py, tests/test_places_strict.py, tests/test_place_triage.py,
tests/test_contribute.py, tests/test_watch.py, tests/test_score.py, tests/test_source_yield.py.
"""
import json
import random
import sys
from collections import Counter
from datetime import datetime, timezone
from . import read_methods, contribute, coverage, digest, first_jobs, doctor, employer_index, features, jobs_so_far, ledger_store, notify, run_counts, scout, source_yield, store, telegram
from .ai import budget, enrich, insights, interviews, kit, score
from .notion import client as notion_client, funnel
from .paths import DATA, REPORTS, load_search_config
from .ai import engine as _engine
from .store_access import open_run
from .sources import describe, feeds, google_jobs
from .daily_helpers import (STALE_DAYS, crawl_counts, digest_note, downloaded_index, for_job_matches, left_out, log_crawl, new_cron_run, no_profile,
                            new_job_lines, none_scored, save_run, scoring_plan, starter_sources, time_budget_on, to_score, top_new, url_stages)


def ai_ready():
    """An AI is ready: unscored jobs wait for a score and the digest leaves them out, as the app's Jobs list does."""
    return _engine.ready()

def search(args, stores=None):
    stores = stores or open_run()
    run_counts.reset()   # this search's own counts start at 0
    read_methods.reset(datetime.now(timezone.utc).isoformat(timespec='seconds'))   # and how its sources are read (src/read_methods.py)
    run = new_cron_run(args.mode)
    started = datetime.now(timezone.utc).isoformat(timespec='seconds')   # a job first seen from now on is new (src/source_yield.py)
    spend = None
    if args.mode in ('scheduled', 'run', 'today'):
        # AI budget: at 90% of the month's limit the optional AI steps pause; alerts are sent at the end.
        try:
            spend = budget.status(stores)
            # The monthly budget is API spend: with Claude Code the AI runs on the user's Claude plan, so "$0.00 of $15" says nothing (6 Oct 2026).
            from .ai import engine as ai_engine
            chosen = ai_engine.providers.spec()
            print(f'AI: {chosen.plan} (no API budget to watch)' if chosen.billing == ai_engine.SUBSCRIPTION else f'AI budget: {budget.describe(spend)}')
            budget.apply_caps(args, spend, run['warnings'])
        except Exception as error:
            print(f'Warning: budget check skipped: {type(error).__name__}: {error}')
    read_profile = scoring_plan(args, stores)   # read once, before any site: the time plan knows the search scores (time_budget.score_first)
    if args.mode != 'more' and args.first_jobs and args.score_max and not args.only_visits and read_profile:
        try:   # Why (27 Oct 2026, benchmark): asked in the slice, its boards started at 41-63 s of a 67 s read cut (first_jobs.propose_early)
            first_jobs.propose_early()
        except Exception as error:  # noqa: BLE001 — the slice asks the proposal itself
            print(f'Warning: early board proposal skipped: {type(error).__name__}: {error}', flush=True)
    if args.mode in ('scheduled', 'run') and not args.only_visits:   # the board web search at second 0, beside the proposal (src/sources/board_web.py early)
        from .sources import board_web   # Why (#first-press-slots, owner, 27 Oct 2026: "Web search ... in parallel"): it started at ~25 s, after the employers' pick
        board_web.early(load_search_config())
    hidden, saved, dismissed = frozenset(), frozenset(), frozenset()
    stages = None   # job URL -> Stage: also what the pool's outcome counts read (src/contribute.py outcomes)
    try:
        stages = url_stages(stores)
        hidden = frozenset(u for u, st in stages.items() if st not in notion_client.VISIBLE_STAGES)
        saved = frozenset(u for u, st in stages.items() if st == 'Saved')
        dismissed = frozenset(u for u, st in stages.items() if st == 'Dismissed')
    except Exception as error:  # A Notion outage shouldn't block the digest.
        print(f'Warning: could not read your applications: {error}')
        run['warnings'].append(f'{"Notion applications" if stores.name == "notion" else "Applications"} unreadable: {error}')
    sources = starter_sources()
    report, imported = {'jobs': [], 'sources': []}, []
    with store.connect(args.db) as db:
        # A '➕ Next' page reads the stored list as is: importing would mark new jobs
        # as seen and reorder the list between pages.
        if args.mode != 'more':
            # The feed watcher and canonical store intentionally have different schemas.
            # Keep the source-specific history separate, then import the report.
            # sources.json plus every active feed the scout found (local table + Notion Source Registry).
            feed_list = scout.active_sources(db, stores, sources, [] if args.only_visits else downloaded_index())
            if args.only_visits:
                feed_list = [source for source in feed_list if source.get('ats') == 'visit']
                print(f'Reading only the {len(feed_list)} page(s) read in Chrome on this Mac')
            if employer_index.problem:  # said on the run, not only in its log: the check then crawled a small list
                run['warnings'].append(f'Employer index not downloaded ({employer_index.problem}): this check crawled {len(feed_list)} feeds, not the full list')
            with feeds.database(DATA / 'jobs.sqlite') as feed_db:
                so_far = jobs_so_far.SoFar(db)   # each source's jobs in the list as soon as it is read, not all at the end (owner, 18 Oct 2026); before the slice, so its jobs stay "new" in the count
                first_boards = []
                full_read = args.mode in ('scheduled', 'run') and not args.only_visits
                slice_first = args.first_jobs and args.score_max and not args.only_visits and read_profile
                from .sources import boards_first
                if full_read and not slice_first:   # the web search's boards read before any employer site (src/sources/boards_first.py); a first
                    try:   # press reads its slice first and the web search's boards after it, never waiting in front of it (27 Oct 2026, benchmark)
                        first_boards = boards_first.run(feed_db, load_search_config(), so_far.listener('job boards'))
                    except Exception as error:  # noqa: BLE001 — the full board read reads them
                        print(f'Warning: job boards first skipped: {type(error).__name__}: {error}', flush=True)
                if slice_first:
                    try:   # a new user's first jobs in seconds: a slice of fast feeds, 3 jobs scored and synced one by one, then the full crawl below
                        first_jobs.run(db, feed_db, feed_list, read_profile(), hidden, sync=lambda: stores.matches.sync(
                            db, for_job_matches(db, hidden), hidden - dismissed, None, dismissed, partial=True),
                                        import_jobs=lambda slice_report: so_far.add(slice_report.get('jobs') or [], 'employer sites'))
                    except Exception as error:  # noqa: BLE001 — the full search does everything the slice did
                        print(f'Warning: first jobs skipped: {type(error).__name__}: {error}', flush=True)
                    if full_read:
                        try:
                            first_boards = boards_first.run(feed_db, load_search_config(), so_far.listener('job boards'))
                        except Exception as error:  # noqa: BLE001 — the full board read reads them
                            print(f'Warning: job boards first skipped: {type(error).__name__}: {error}', flush=True)
                from .sources import boards_ahead   # the found boards read beside the employer sites, not after them (owner, 19 Oct 2026)
                report, ahead = boards_ahead.scan_beside(feed_list, feed_db, load_search_config(), so_far, due=args.mode in ('scheduled', 'run'))
                report['jobs'] += first_boards
                crawl_funnel = report.get('funnel')   # not `funnel`: that name is the Notion funnel module used further down
                if crawl_funnel:   # the same fixed-list tags the pool uses (src/contribute.py): all that ever describes this search to the product
                    crawl_funnel['roles'], crawl_funnel['regions'] = contribute.tags()
                run['funnel'] = crawl_funnel   # kept on the run's details too (src/run_details.py), not only in data/coverage.json (last crawl)
                coverage.save(crawl_funnel)   # how much of the market the role keywords catch (Strategy page, and anonymous counts if reports are on)
                # Paid per search, so only full crawls use it; off without SERPAPI_API_KEY.
                if args.mode in ('scheduled', 'run') and google_jobs.api_key():
                    google = google_jobs.scan(feed_db, google_jobs.api_key(),
                                              google_jobs.settings(load_search_config()))
                    report['jobs'] += google['jobs']
                    report['sources'] += google['sources']
                # Aggregators with public APIs (src/sources/aggregators.py): free ones always, keyed ones with their keys; each at most every 6 hours.
                if args.mode in ('scheduled', 'run'):
                    from .sources import aggregators
                    found = aggregators.scan(feed_db, load_search_config(), on_jobs=so_far.listener('job boards'), ahead=ahead)
                    report['jobs'] += found['jobs']
                    report['sources'] += found['sources']
                    # Job-alert emails in the user's own Gmail (src/sources/job_alerts.py): LinkedIn & co. without ever fetching their pages.
                    from . import features
                    from .ai import engine
                    if features.enabled('job_alerts') and engine.ready():
                        from .sources import google as google_api, google_scopes, job_alerts
                        gmail = google_api.Google.from_env()
                        if gmail and (gmail.scopes is None or 'gmail' in gmail.scopes):   # Gmail left unticked: no alert emails to read
                            try:
                                alerts = job_alerts.scan(feed_db, gmail, engine.client(action='mail'))
                                report['jobs'] += alerts['jobs']
                                report['sources'] += alerts['sources']
                            except google_scopes.MissingScope:   # an older sign-in without Gmail: learned now, the crawl goes on without alert emails
                                pass
            from .ai import cost as ai_cost
            if ai_cost.SIDE:   # careers pages, link picks and alert emails read with AI during this crawl: part of the run's AI cost
                run['sources'] = dict(ai_cost.SIDE)
            for source in report.get('sources') or []:   # an employer's own site that refuses us: offered as a site only you can open
                if not source.get('ok') and source.get('ats') == 'careers' and source.get('slug'):
                    from .sources import careers as careers_pages, visits
                    visits.refused(source['company'], careers_pages.decode(source['slug']), source.get('error') or '')
            imported = so_far.statuses(report, store.import_watch_report(db, report))   # a job shown early stays "new"
            from .sources import feed_facts
            feed_facts.keep_seen(db, report)   # employers not read because their lists are unchanged: their jobs are still listed
            run.update(crawl_counts(report, imported))
            # What this refresh added, by place (owner, 7 Oct 2026: "we should understand what's being added, what's being removed").
            new_here = Counter(store.place_name(job.get('location')) for job, status in zip(report.get('jobs', []), imported) if status == 'new')
            if new_here:
                print(f'Added {sum(new_here.values())} new job(s): {store.grouped(new_here)}', flush=True)
                for line in new_job_lines(report.get('jobs', []), imported):
                    print(line, flush=True)   # the result card lists them when no digest is sent (desktop/renderer/new-jobs-card.js)
            if args.mode in ('scheduled', 'run', 'today'):
                try:  # opt-in (src/contribute.py); the pool never affects a run
                    contribute.maybe_send(feed_list, report, stores, db=db, stages=stages)
                except Exception as error:  # noqa: BLE001
                    print(f'Warning: pool contribution skipped: {type(error).__name__}: {error}')
            if args.mode in ('scheduled', 'run'):
                # Only full crawls can tell that a job disappeared.
                gone_from = Counter()
                run['closed_stale'] = store.close_stale(db, STALE_DAYS, who=gone_from)
                print(f"Expired {run['closed_stale']} job(s) not seen for {STALE_DAYS} days" + (f': {store.grouped(gone_from)}' if gone_from else ''))
                if not employer_index.problem:   # a list that failed to download is not a list of dropped employers
                    dropped = store.close_dropped(db, {source['company'] for source in feed_list})
                    if dropped:
                        print(f'Expired {dropped} job(s) from employers your search no longer reads')
        if args.mode != 'more' and args.company_report.exists():
            company_report = json.loads(args.company_report.read_text())
            imported += store.import_company_report(db, company_report)
        if args.mode in ('scheduled', 'run'):
            # Last of the imports (7 Oct 2026: the job boards' report, imported after it, opened again jobs this had just closed): jobs outside
            # your places close; acted on, added by you, or with no place stay.
            from .sources import feeds as feed_places
            outside = Counter()
            feed_places.place_open_jobs(db)
            elsewhere = store.close_elsewhere(db, feed_places.keep_open, where=outside)
            if elsewhere:
                print(f'Unmatched {elsewhere} job(s) outside your places: {store.grouped(outside)}')
            pruned = store.prune_gone(db)   # unmatched or expired, unseen for 60 days, never acted on: the cache stops growing for ever
            if pruned:
                print(f'Removed {pruned} old unmatched or expired job(s) from this computer\'s cache')
        # Jobs that came without a description (SmartRecruiters' list, a jobs.ch page that failed) get it now, or
        # they'd never be enriched or scored. A few per run; a failure is tried again next run.
        try:
            note = describe.backfill(db)
            if note:
                print(note)
        except Exception as error:
            print(f'Warning: description backfill skipped: {type(error).__name__}: {error}')
        # A refresh with a time budget takes one batch end to end (owner, 7 Oct 2026: "a batch should handle it from start to finish"): the new
        # jobs it can read and score in its time, best places first; the rest waits for the next refresh and is not listed until scored.
        batch, batch_started = None, None
        if time_budget_on() and args.score_max and read_profile:
            try:
                from . import time_budget
                waiting = score.queue(db, to_score(db, hidden), read_profile())
                taken = time_budget.batch('score', len(waiting))
                batch, batch_started = {job['id'] for job in waiting[:taken]}, __import__('time').monotonic()
                run['waiting'] = len(waiting) - taken
            except Exception as error:  # noqa: BLE001 — each step then takes its own batch
                print(f'Warning: no batch for this refresh ({type(error).__name__}): each AI step takes its own')
        def read_jobs(only_ids=None):
            # Runs after import so fresh descriptions are included. AI trouble never blocks the digest.
            try:
                run['enrich'] = {}
                print(enrich.run(db, enrich.DEFAULT_MODEL, args.enrich_max, stats=run['enrich'], only_ids=only_ids))
                run['warnings'] += left_out(run['enrich'], 'read by AI')
            except Exception as error:
                print(f'Warning: enrichment skipped: {type(error).__name__}: {error}')
                run['warnings'].append(f'enrichment skipped: {type(error).__name__}')
        # A refresh with a batch scores first, straight from each posting (owner, 7 Oct 2026: reading each job with AI took the whole 3 minutes,
        # twice, and scored nothing); the AI reading (facts such as languages) gets the time left after. Without a batch: reading, then scoring.
        if args.enrich_max and batch is None:
            read_jobs()
        if args.score_max and read_profile:
            # Scores only jobs that survive the hard filters; the Profile is re-read every run
            # (the desktop app's local Profile file when set, else the Notion page).
            try:
                profile = read_profile()
                candidates = to_score(db, hidden)
                run['score'] = {}

                def to_notion():
                    # Owner, 7 Oct 2026: Job Matches was written only after the whole search, so a stopped one left nothing there. The scores
                    # so far are written now and then; the end of the search still writes the rest and marks what is gone or applied.
                    if args.mode not in ('scheduled', 'run', 'today'):
                        return
                    try:
                        print(stores.matches.sync(db, for_job_matches(db, hidden), hidden - dismissed, None, dismissed, partial=True) + ' (so far)', flush=True)
                    except Exception as error:  # noqa: BLE001 — the end of the search writes them
                        print(f'Job Matches: not updated yet ({type(error).__name__}); the end of the search writes them', flush=True)
                print(score.run(db, candidates, profile, score.DEFAULT_MODEL, args.score_max, stats=run['score'], on_scored=to_notion, only_ids=batch))
                if batch is not None:
                    from . import time_budget
                    now = __import__('time').monotonic
                    time_budget.record('job', now() - batch_started, run['score'].get('done') or 0)
                    # Done with time left: the next batch, sized from the pace just measured, read and scored the same way (the first is a guess).
                    while run.get('waiting') and not time_budget.over('score'):
                        queue = score.queue(db, to_score(db, hidden), profile)
                        taken = time_budget.batch('score', len(queue), say=False)
                        if not taken:
                            break
                        batch, batch_started, run['waiting'] = {job['id'] for job in queue[:taken]}, now(), len(queue) - taken
                        more = {}
                        print(score.run(db, to_score(db, hidden), profile, score.DEFAULT_MODEL, args.score_max, stats=more,
                                        on_scored=to_notion, only_ids=batch))
                        time_budget.record('job', now() - batch_started, more.get('done') or 0)
                        if not more.get('done'):
                            break
                    if run.get('waiting'):
                        print(f'⏱ {run["waiting"]} found job(s) wait for the next refresh, to be scored (best places and closest jobs first)', flush=True)
                run['warnings'] += left_out(run['score'], 'scored')
                for warning in none_scored(run.get('waiting'), run['score']):
                    print(f'Warning: {warning}', flush=True)
                    run['warnings'].append(warning)
                if run['score'].get('paused'):   # said on the run's card, not only in its log
                    run['warnings'].append(score.PAUSED)
            except Exception as error:
                print(f'Warning: scoring skipped: {type(error).__name__}: {error}')
                run['warnings'].append(f'scoring skipped: {type(error).__name__}')
        if args.enrich_max and batch is not None:
            read_jobs()   # with the time left: the budget sizes it, best places first
        for warning in no_profile(args.score_max, None, read_profile):
            print(f'Warning: {warning}')
            run['warnings'].append(warning)
        open_urls = None   # the crawl's open jobs, set by the Job Matches sync below; None checks every saved job
        if args.mode in ('scheduled', 'run', 'today'):
            try:
                scored = for_job_matches(db, hidden)
                open_urls = {j['url'].strip() for j in store.digest_jobs(db, limit=10_000) if j.get('url')}
                run['top_new'] = top_new(report, scored)
                # Scored jobs into the store's Job Matches (src/stores Matches.sync); a store problem never blocks the digest.
                run['matches'] = stores.matches.sync(db, scored, hidden - dismissed, open_urls, dismissed)
                print(run['matches'])
                if args.auto_kit_max:
                    # Runs after scoring so it sees the same fits; a kit failure never blocks the digest.
                    run['kits'] = {}
                    summary, drafted_jobs = kit.auto_run(db, scored, stores, kit.DEFAULT_MODEL,
                                                         args.auto_kit_max, args.auto_kit_min_score, stats=run['kits'])
                    run['kit_titles'] = [f"{job['title']} ({job['company']})" for job, _ in drafted_jobs]
                    print(summary)
            except Exception as error:
                print(f'Warning: Job Matches sync or auto-kit skipped: {type(error).__name__}: {error}')
                run['warnings'].append(f'Job Matches sync or auto-kit skipped: {type(error).__name__}')
            try:   # which sources gave this search its relevant jobs, kept per run (src/source_yield.py); never stops a search
                from .sources import found_boards
                source_yield.run(db, started, read=found_boards.read_since(started))   # every board read keeps a row: its history (board_yield.dead)
            except Exception as error:  # noqa: BLE001
                print(f'Warning: source yield not measured: {type(error).__name__}: {error}')
        if args.mode == 'scheduled':
            # Application ledger (src/ledger_store.py, any store): log Stage edits, and mark silent applications No response.
            try:
                print(ledger_store.sync(stores))
            except Exception as error:
                print(f'Warning: ledger sync skipped: {type(error).__name__}: {error}')
                run['warnings'].append(f'ledger sync skipped: {type(error).__name__}')
            # Saved / Kit ready jobs whose posting was taken down (their board confirms it) → Closed, named in the report.
            try:
                summary, run['gone_titles'] = ledger_store.close_gone(stores, open_urls)
                print(summary)
            except Exception as error:
                print(f'Warning: taken-down check skipped: {type(error).__name__}: {error}')
                run['warnings'].append(f'taken-down check skipped: {type(error).__name__}')
            # A recorded interview whose application still says Interview scheduled (saved before the app moved it on).
            try:
                print(interviews.sweep(stores=stores))
            except Exception as error:
                print(f'Warning: interview sweep skipped: {type(error).__name__}: {error}')
        if args.mode == 'scheduled' and stores.name == 'notion' and not features.disabled('notion'):
            # 🎯 Pipeline page: conversion between funnel steps and the step to improve (no AI). Notion only: the notion adapter writes it.
            try:
                funnel.write(stores, funnel.funnel(funnel.reached(stores)),
                             datetime.now(timezone.utc).strftime('%d %b %H:%M UTC'))
            except Exception as error:
                print(f'Warning: funnel update skipped: {type(error).__name__}: {error}')
                run['warnings'].append(f'funnel update skipped: {type(error).__name__}')
        seed = args.seed or random.randrange(1, 10**9)
        shown_ids = []
        messages, new_count, keyboards = digest.build_digest(db, args.limit, hidden_urls=hidden, page=args.page,
                                                      seed=seed, shown_ids=shown_ids, saved_urls=saved,
                                                      hide_unscored=ai_ready())
    text = '\n\n'.join(messages)
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / 'daily-latest.txt').write_text(text + '\n', encoding='utf-8')
    (REPORTS / 'daily-latest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    if sys.stdout.isatty():  # the Telegram HTML is a preview for a terminal; the app's log gets a summary line
        print(text)
    if not args.send:
        if not sys.stdout.isatty():
            telegram.to_app(text)  # the desktop app shows the list itself
        print('\n' + digest_note(len(shown_ids), new_count, terminal=sys.stdout.isatty()))
        if args.mode in ('scheduled', 'run', 'today'):
            save_run(run)  # the desktop app's activity bar shows its counts
            if args.log_run:
                log_crawl(stores, run)
        return 0
    token, chat_id = telegram.credentials()
    if args.mode == 'scheduled' and not new_count:
        print('\nNo new jobs since the last run; nothing sent.')
        run['telegram'] = 'nothing new; not sent'
    else:
        refused = None
        for message, keyboard in zip(messages, keyboards):
            try:
                telegram.send(message, token, chat_id, keyboard, kind='matches')
            except Exception as error:  # a blocked bot, a removed chat, no network: the run says so in words, it does not crash
                refused = telegram.failure_words(error)
                break
        if not refused and notify.wants_email() and not notify.flush('matches') and not token:   # the digest's e-mail goes now, so a failure keeps the jobs unshown like a refused Telegram message
            refused = notify.failure_words()
        if refused:
            # The jobs are imported and saved; only the delivery failed. Not marked as shown, so the next digest lists them again.
            print(f'Warning: {refused}')
            run['telegram'] = 'not sent: the e-mail was refused' if not token else 'not sent: Telegram refused it'
        else:
            if args.mode != 'more':
                # '➕ Next' runs don't save the database, so only first pages count for rotation.
                with store.connect(args.db) as db:
                    digest.mark_shown(db, shown_ids, seed)
            print(f"\nSent {len(messages)} {'Telegram message(s)' if token else 'message(s) by e-mail'}; imported {len(imported)} jobs.")
            run['telegram'] = f'sent {len(messages)} message(s), {new_count} new'
    if spend and not run.get('telegram', '').startswith('not sent'):
        with store.connect(args.db) as db:
            budget.alert_once(db, spend, lambda text: telegram.send(text, token, chat_id))
    if args.mode == 'scheduled' and datetime.now(timezone.utc).hour == doctor.HEALTH_HOUR_UTC:
        # Once a day: one Telegram line if a health check fails (Google sign-in, mail, budget, feeds).
        try:
            print(doctor.alert(stores, lambda text: telegram.send(text, token, chat_id)))
        except Exception as error:
            print(f'Warning: health check skipped: {type(error).__name__}: {error}')
    if args.insight and args.mode == 'scheduled':
        # One insight a day, with the first scheduled run after insights.SEND_HOUR_UTC.
        try:
            run['insight'] = {}
            with store.connect(args.db) as db:
                print(insights.run(db, stores, send=lambda text, markup: telegram.send(text, token, chat_id, markup),
                                   stats=run['insight']))
        except Exception as error:
            print(f'Warning: insight skipped: {type(error).__name__}: {error}')
            run['warnings'].append(f'insight skipped: {type(error).__name__}')
    if args.mode in ('scheduled', 'run', 'today'):
        save_run(run)
        log_crawl(stores, run)  # sending runs; a terminal preview (no --send) isn't logged unless --log-run
    return 0
