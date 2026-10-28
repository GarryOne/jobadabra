#!/usr/bin/env python3
"""Source scout: grow the list of employer job feeds a few companies per run.

Each run
1. harvests candidate employers (seed list with Tier 1 first, Hacker News "Who is
   hiring?", the open hiring-without-whiteboards list, employers already seen
   on jobs.ch, and boards found by searching for the user's roles),
2. probes a small batch of them for a public job feed (Greenhouse, Lever, Ashby,
   Workable, Recruitee, Personio, SmartRecruiters, plus Amazon and Netflix),
3. scores every feed it finds for quality (0-100) against the owner's goals,
4. registers useful feeds (the store's employers: Notion Employers & Sources, + local table) so the
   4-hourly crawl includes them, and
5. sends one Telegram summary.

Progress lives in the table scout_candidates, so later runs continue where this
one stopped. Nothing here applies to jobs; it only finds where jobs are posted.
"""

import argparse
import json
import os
import re  # noqa: F401 -- retained public names; scout_run uses the scout dependency seam
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ALL_COMPLETED, FIRST_COMPLETED, ThreadPoolExecutor, wait  # noqa: F401 -- retained public names; scout_run uses the scout dependency seam
from datetime import timedelta  # noqa: F401 -- retained public names; scout_run uses the scout dependency seam
from html import escape
from pathlib import Path
from . import budget_tape, read_methods, run_exit, contribute, employer_index, scout_carry, scout_need, scout_overrun, scout_queue, scout_role_search, run_log, scout_core, store, telegram, tgcard  # noqa: F401 -- retained public names; scout_run uses the scout dependency seam
from .notion import client as notion, cron_runs  # noqa: F401 -- notion: tests patch scout.notion (its Tracker)
from .paths import CONFIG, JOBS_DB, load_search_config
from .sources import ats, careers, feeds  # noqa: F401 -- `feeds` is also reached as scout.feeds by tests
from .scout_candidates import counts_when_covered, harvest, harvest_met, skipped_origins, starter_list  # noqa: F401 -- retained public names; scout_run uses the scout dependency seam
from .scout_core import DEFAULT_BATCH, RECHECK_DAYS, SEEDS, TABLES, TIER1_MIN_RELEVANT, batch_for, ensure_tables, key_for, now, pending_count
from .scout_index import board_stats, build_index, central_stats, dead_ends, run_record, fetch_boards, fetch_contributions, market_coverage, publish_index, publish_summary, published_line, record_unread, run_headline
from .scout_notion import active_sources, export_sources, mark_synced, not_updated, sync_employers, synced_key, write_employer  # noqa: F401 -- retained public names; scout_run uses the scout dependency seam
from .scout_probe import READERS, find_feed, next_batch, quality, skipping
from .scout_core import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    DEFAULT_BATCH, EMPLOYERS_DB, HN_THREADS, MAX_BATCH, RECHECK_DAYS, SEEDS, SEED_ORIGINS, SMALL_GUESS, TABLES, TECH_LIST_ORIGINS,
    TIER1_MIN_RELEVANT, _SEARCH, _get_json, _get_text, batch_for, clean_name, key_for, now, pending_count)
from .scout_candidates import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    LOCATION_WORDS, ROLE_WORDS, WIKIDATA_MAX_AGE, WIKIDATA_QUERY, WIKIDATA_TIMEOUT_S, _seed_candidates,
    hacker_news_candidates, harvest, local_company_candidates, search_countries, seed_candidates, skipped_origins, starter_list,
    swissdevjobs_candidates, whiteboards_candidates, wikidata_candidates, wikidata_query, wikidata_rows)
from .scout_probe import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    JOB_SUBDOMAINS, JUDGES, READERS, READER_FILES, STACK, STOP_WORDS, SWISS_OR_ZURICH, belongs_to, board_url, find_feed, job_hosts,
    job_places, next_batch, quality, readers_version, relevant_roles, skipping, workday_url)
from .scout_notion import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    FEED_STATUS, active_sources, employer_record, excluded_companies, export_sources, mark_synced, own_feeds, research_links,
    sync_employers, write_employer)
from .scout_index import (  # noqa: F401 -- re-exported: other modules and tests use `scout.<name>`
    FIT_MIN_INSTALLS, FIT_NAMES, MARKET_TERMS, MIN_INSTALLS, OWN_MIN_INSTALLS, POOL_MIN_INSTALLS, QUIET_DAYS, SWISS, board_stats,
    build_index, central_stats, dead_ends, fetch_boards, fetch_contributions, fits, health, market_coverage, pool_of, publish_index,
    publish_summary, record_unread, run_headline)
from . import scout_run


# The employers are checked in parallel threads: print() writes the text and its newline separately, so two lines could join
# ("…Hochschule BernScout: checked 6 of 15", 6 Oct 2026). One locked write per line, with its count.
PROGRESS_LOCK = threading.Lock()


def progress_line(text):
    sys.stdout.write(f'{text}\n')
    sys.stdout.flush()


def ai_ideas(db, harvest_sources=None):
    """Claude's ideas for new candidates (every run), or None: off, no AI available, tests that pass their own
    harvest sources, or a failure (the scout then simply carries on with the usual sources)."""
    from . import features
    from .ai import engine, scout_ideas
    if harvest_sources is not None or os.getenv('JOB_PILOTTO_FIXTURE_DIR') or not features.enabled('scout_ai') or not engine.ready():
        return None
    from . import scout_cells   # the central scout aims at the list's thinnest kind × country, not the example search's roles
    search, label = scout_cells.aim(db, load_search_config()) if scout_core.CENTRAL else (load_search_config(), '')
    try:
        found = scout_ideas.run(db, search, label=label)
    except Exception as error:  # noqa: BLE001 — the ideas are a bonus: a failed call must never stop the scout
        print(f'Warning: scout ideas skipped: {type(error).__name__}: {error}')
        return None
    if found:
        print(f"Scout ideas: {found['companies']} companies and {found['directories']} from company lists. {found['note']}")
    return found


# Orchestrate the scout phases while retaining the public dependency seams.
def run(db, batch=DEFAULT_BATCH, stores=None, seeds=None, probe=ats.probe, harvest_sources=None, workers=6, static=None, budget=0):
    """Harvest, probe one batch, register what is useful. Returns (summary dict, list of outcomes).
    A board already crawled is a duplicate: the starter list (`static`, default config/sources.json), the feeds registered here and the store's
    active employers. stores: where each checked employer is written (None: only this computer's scout table)."""
    seeds = seeds or json.loads(SEEDS.read_text())
    if static is None:
        static = starter_list()
    scout = sys.modules[__name__]
    skip = scout_run.read_lists(scout, db, seeds)
    deadline, may_add, have = scout_run.name_budget(scout, db, harvest_sources, budget)
    added, ideas = scout_run.harvest_names(scout, db, seeds, stores, harvest_sources, skip, budget, deadline, may_add, have)
    candidates, left = scout_run.plan_candidates(scout, db, batch, skip, have)
    active, search, lookup = scout_run.probe_options(scout, db, stores, static, harvest_sources)
    check, note_site, unread = scout_run.make_checks(scout, lambda: len(candidates), probe, active, search, lookup)
    save, shared = scout_run.make_recorder(scout, db, stores)
    outcomes = scout_run.probe_parallel(scout, candidates, check, save, workers, deadline)
    candidates, outcomes = scout_run.keep_completed(candidates, outcomes, budget)
    return scout_run.finish_run(scout, db, candidates, outcomes, note_site, unread, shared, skip, left, added, ideas, have)


def telegram_summary(summary, results):
    found = sorted([(c, o) for c, o in results if o['status'] == 'found'], key=lambda x: -x[1]['quality'])
    counts = {s: sum(1 for _, o in results if o['status'] == s) for s in ('none', 'low', 'manual', 'duplicate', 'watch')}
    blocks = []
    for i, (c, o) in enumerate(found, 1):
        s = o['stats']
        tier = ' · Tier 1' if c['tier'] == 'Tier 1' else ''
        places = s['places'][:3]
        blocks.append(tgcard.block(
            f"{i}. {escape(c['name'])} · Source quality {o['quality']}{tier}",
            escape(tgcard.dot(f"{s['relevant']} matching roles", f"{s['preferred']} in preferred locations")),
            tgcard.fact('Location' if len(places) == 1 else 'Locations', ', '.join(places)),
            tgcard.fact('Platform', o['ats'].capitalize())))
    if not found:
        blocks.append('No new useful feeds in this batch.')
    detail = [f"{counts['none']} without a job feed we can read (their own job site, or jobs.ch)", f"{counts['low']} low relevance"]
    left = summary.get('left') or 0
    if left:   # not checked here: other installs found no job site there lately (7 Oct 2026: 52 of 92 went unsaid)
        detail.append(f"{left} set aside for 30 days (other installs found no job site we can read there)")
    if counts['watch']:
        detail.append(f"{counts['watch']} careers page{'s' if counts['watch'] != 1 else ''} with no open jobs today (watched weekly)")
    if counts['manual']:
        detail.append(f"{counts['manual']} Tier 1 on manual watch")
    if summary.get('ideas'):
        ideas = summary['ideas']
        blocks.append(tgcard.block('New ideas', escape(f"{ideas['companies']} companies and {ideas['directories']} from company lists queued"),
                                   escape(ideas['note'])))
    rest = tgcard.dot(*detail, f"{summary['total_feeds']} feeds crawled", f"{summary['queued']} candidates queued",
                      f"{summary['harvested']} new candidates found" if summary['harvested'] else '')
    blocks.append(tgcard.block('Not added', escape(rest)))
    plural = 's' if len(found) != 1 else ''
    first = summary.get('first_time')
    again = summary['checked'] - first if first is not None else 0
    # Checked again only once every new name was tried (next_batch): said, so it is not read as effort spent instead of new names (7 Oct 2026).
    return tgcard.card('New employer sources', tgcard.dot(f"{summary['checked']} checked", f"{first} new to the search" if first is not None else '',
                                                         f"{again} checked again (no new names left)" if again else '',
                                                         f"{left} set aside" if left else '', f"{len(found)} new source{plural}"), blocks,
                       emoji='🔎', footer='Source quality measures the source, not your job fit.')


def ai_cost_line(what, usd, api_calls, plan_calls, calls):
    """What a run's AI cost, in words: dollars only for calls on the API key; calls through Claude Code are on the user's Claude plan
    (6 Oct 2026: "$0.000 in 21 call(s)" read as broken to a Claude Code user)."""
    from .ai import providers
    plan, tool = ('ChatGPT plan', 'Codex') if providers.spec().family == 'openai' else ('Claude plan', 'Claude Code')
    if plan_calls and not api_calls:
        return f'AI of this {what}: {plan_calls} call(s) on your {plan} ({tool}: no cost per call)'
    if plan_calls:
        return f'AI cost of this {what}: ${usd:.3f} for {api_calls} call(s) on your API key, plus {plan_calls} on your {plan}'
    return f'AI cost of this {what}: ${usd:.3f} in {calls} call(s)'


def report_ai_cost(side):
    """Print what this run's AI calls cost, and write {usd, calls} to JOB_PILOTTO_AI_COST_FILE when set (the central scout's workflow
    reports it to the owner's /ai-cost page). Always written when asked, even $0: a job that spent nothing must still show up."""
    usd, calls = float(side.get('usd') or 0), int(side.get('done') or 0)
    print(ai_cost_line('scout run', usd, int(side.get('api_calls') or 0), int(side.get('cli_calls') or 0), calls))
    target = os.getenv('JOB_PILOTTO_AI_COST_FILE')
    if target:
        Path(target).write_text(json.dumps({'usd': round(usd, 6), 'calls': calls}))


def employer_store():
    """The active store, opened as the jobs check opens it (src/store_access.py open_run): Notion through the engine's own client when
    the user is on it, else this Mac's."""
    from .store_access import open_run
    return open_run()


def where_of(stores):
    return 'Notion' if stores.name == 'notion' else 'your employer list'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=JOBS_DB)
    parser.add_argument('--batch', type=int, default=DEFAULT_BATCH, help='candidates probed per run')
    parser.add_argument('--budget', type=int, default=0, help='seconds: no new check starts after this; the rest wait for the next run (0 = none)')
    parser.add_argument('--send', action='store_true', help='send the summary to Telegram')
    parser.add_argument('--log-run', action='store_true', help="log this run in the active store's run history (⏱️ Search runs on "
                                                                 'Notion; the desktop app does)')
    parser.add_argument('--publish-index', action='store_true',
                        help='the central scout: after the run, verify every feed and upload the employer index '
                             '(needs INDEX_PUBLISH_KEY; URL: JOB_PILOTTO_INDEX_URL or the default)')
    parser.add_argument('--sync-store', '--sync-notion', dest='sync_store', action='store_true',
                        help='write the employers already checked on this computer that the active store lacks (its employer list; '
                             'on Notion, Employers & Sources: the app runs it when Notion is connected), then stop')
    parser.add_argument('--paste-file', type=Path, help='a page the user pasted (text or one address): its companies are checked first (src/scout_paste.py)')
    parser.add_argument('--export-sources', action='store_true',
                        help='write config/sources.json: the shared starter list of verified public feeds '
                             '(sources.json + the active store\'s active employers with a feed)')
    args = parser.parse_args()
    if args.sync_store:
        stores = employer_store()
        if not synced_key(stores):
            print('Employers: no employer list to write to; nothing to write.')
            return 0
        with store.connect(args.db) as db:
            ensure_tables(db)
            written, failed = sync_employers(db, stores)
        print(f'Employers: {written} written to {where_of(stores)}')   # each one not written said so in its own Warning line
        return 1 if failed and not written else 0
    started = time.monotonic()
    scout_core.CENTRAL = bool(args.publish_index)   # the central scout: its full lists, published to every install
    if args.export_sources:
        kept, failed = export_sources(employer_store())
        print(f'Wrote {len(kept)} feeds ({sum(k["jobs"] for k in kept):,} open jobs) to config/sources.json')
        for item in failed:
            print(f"  left out {item['company']} ({item['ats']}:{item['slug']}): {item['error']}")
        return 0
    from .features import disabled
    if disabled('scout'):
        print('Source scout is off (JOB_PILOTTO_DISABLE includes scout).')
        return 0
    stores = employer_store()
    from . import trial
    if trial.pause_run(args, stores, mode='scheduled'):   # Always on after the free trial: no new employer checks (src/trial.py)
        return 0
    logged = args.send or args.log_run   # on any store: the row is in the run history wherever the data is
    if logged:
        run_log.auto_begin(stores)  # the scout's run row opens when it starts
    log = run_log.new_run('scout')
    with store.connect(args.db) as db:
        if args.paste_file:
            from . import scout_paste
            try:
                print(scout_paste.summary(scout_paste.add(db, scout_paste.read_file(args.paste_file), search=load_search_config())))
            except Exception as error:  # noqa: BLE001 — the usual run still goes on
                print(f'Warning: pasted page not read: {type(error).__name__}: {error}')
        fetched = None   # the central scout reads what installs shared before its run, so it skips their dead ends (20 Oct 2026)
        if args.publish_index and scout_core.CENTRAL and os.getenv('INDEX_PUBLISH_KEY'):
            fetched = fetch_contributions(os.getenv('JOB_PILOTTO_INDEX_URL') or employer_index.URL, os.environ['INDEX_PUBLISH_KEY'], with_nofeed=True)
            scout_core.SHARED_DEAD = employer_index.fresh_nofeed(fetched[1])
        if scout_core.CENTRAL:
            scout_overrun.arm(args.budget or scout_core.CENTRAL_BUDGET_S)   # an empty log at the job's cancel hid what held two runs (20 Oct 2026)
        with scout_overrun.phase('checking employers'):
            summary, results = run(db, args.batch, stores, budget=args.budget or (scout_core.CENTRAL_BUDGET_S if scout_core.CENTRAL else 0))
        if synced_key(stores):   # employers checked earlier (before this store), or whose write failed, catch up now
            written, failed = sync_employers(db, stores)
            if written or failed:
                print(f'Employers: {written} checked earlier written to {where_of(stores)}')
        if not scout_core.CENTRAL:   # what this run found goes to the central list right away (opt-in; src/contribute.py), not with the next jobs check
            try:
                from . import contribute
                contribute.maybe_send(active_sources(db, stores, starter_list()), {'sources': []}, stores, db=db)
            except Exception as error:  # noqa: BLE001 — the pool never affects a run
                print(f'Warning: pool contribution skipped: {type(error).__name__}: {error}')
        if args.publish_index:
            key = os.getenv('INDEX_PUBLISH_KEY')
            if not key:
                raise SystemExit('--publish-index needs INDEX_PUBLISH_KEY')
            index_url = os.getenv('JOB_PILOTTO_INDEX_URL') or employer_index.URL
            from . import scout_boards, scout_cells
            deadline = min(scout_overrun.publish_deadline(started) - scout_boards.RESERVE_S, time.monotonic() + scout_core.VERIFY_BUDGET_S)
            with scout_overrun.phase('reading what installs shared'):
                contributions, shared_dead = fetched or fetch_contributions(index_url, key, with_nofeed=True)
            swiss_titles = []
            with scout_overrun.phase('reading the index published now, to carry its feeds'):
                scout_carry.seed(db, index_url, key)
            with scout_overrun.phase(f'checking every feed for the index'):
                feeds_out, failed = build_index(db, json.loads((CONFIG / 'sources.json').read_text()), contributions=contributions, workers=24,
                                                boards=json.loads(SEEDS.read_text()).get('boards', []), swiss_titles=swiss_titles, deadline=deadline, carry=True)
            scout_cells.keep(db, feeds_out)   # the next run's ideas aim at the thinnest kind × country
            print(scout_cells.coverage_line(scout_cells.totals(feeds_out)))
            board_facts = []
            with scout_overrun.phase('board pass (job boards of a thin country)'):   # the checks stopped RESERVE_S early: it has its time, else it says so
                scout_boards.run(db, until=scout_overrun.publish_deadline(started), named=scout_boards.named_country(os.environ.get('SCOUT_BOARD_COUNTRY')))
            board_facts = scout_boards.facts(db)   # everything measured in the last 30 days, not only this run's country
            with scout_overrun.phase('market coverage and stats'):
                stats = central_stats(db, feeds_out, market_coverage(swiss_titles, deadline=deadline), run=run_record(summary, results))
            with scout_overrun.phase('reading the job boards'):
                boards = board_stats(fetch_boards(index_url, key))
            with scout_overrun.phase('uploading the index'):
                count = publish_index(feeds_out, index_url, key, stats=stats, nofeed=dead_ends(db, shared_dead), boards=boards, board_facts=board_facts)
            print(publish_summary(feeds_out, contributions, boards))
            print('Feeds by system: ' + ', '.join(f'{system} {n}' for system, n in Counter(f['ats'] for f in feeds_out).most_common()))
            print('Market coverage (our index / jobs.ch): ' + ', '.join(f"{m['term']} {m['ours']}/{m['jobsch']}" for m in stats['market']))
            print(published_line(count, failed, feeds_out))
    from .ai import cost as ai_cost
    if ai_cost.SIDE:   # AI ideas, link picks and page reads of this scout run: logged like any AI step
        log['sources'] = dict(ai_cost.SIDE)
    report_ai_cost(ai_cost.SIDE)
    message = telegram_summary(summary, results)
    log['headline'] = run_headline(message)
    log['subject'] = cron_runs.counted(sum(1 for _, outcome in results if outcome['status'] == 'found'), 'new feed')
    if args.send and not disabled('telegram'):
        print(message)
        telegram.send(message, *telegram.credentials())
    else:
        telegram.to_app(message)  # no Telegram: the desktop app shows the summary
    if logged:
        run_log.log_run(stores, log)
    if scout_core.CENTRAL:
        scout_overrun.leave_if_stuck()


if __name__ == '__main__':
    main()
