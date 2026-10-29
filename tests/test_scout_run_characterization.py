# Pin the scout crawl's writes, logs, deadlines and ordered results offline.
import io
import json
import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import Future
from contextlib import ExitStack, redirect_stdout
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

from src import scout, scout_candidates, scout_core, scout_index, scout_notion
from src.sources import visits

STAMP = datetime(2026, 10, 29, 12, tzinfo=timezone.utc)
STATS = dict(jobs=1, preferred=1, relevant=1, swiss=1, places=['Zurich'], stack_share=1, salary_published=False)
SEEDS = {'excluded': []}
READING = 'Scout: reading the employer lists…'
LISTS = 'Scout: 1 new candidate(s) from the lists; asking the AI for ideas…'


# Defer each check until wait, choosing the last submitted to pin completion order.
class Checks:
    def __init__(self, max_workers):
        self.max_workers = max_workers
        self.calls = {}
        self.shutdown_args = None

    def submit(self, fn, candidate):
        future = Future()
        self.calls[future] = (fn, candidate)
        return future

    def wait(self, futures, **kwargs):
        future = futures[-1]
        fn, candidate = self.calls[future]
        future.set_result(fn(candidate))
        return {future}, set(futures[:-1])

    def shutdown(self, **kwargs):
        self.shutdown_args = kwargs


class CrawlCharacterization(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        folder = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.stack.enter_context(mock.patch.dict(os.environ, {
            'JOB_PILOTTO_DATA_DIR': folder, 'JOB_PILOTTO_CONFIG_DIR': folder,
            'JOB_PILOTTO_NO_DOTENV': '1', 'JOB_PILOTTO_FIXTURE_DIR': '', 'JOB_PILOTTO_SEARCH_TAPE': '',
        }))
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.events, self.clock = [], [0]
        self.pool = None
        self.sources = []
        self.dead = set()
        self.stores = SimpleNamespace(name='memory', employers=SimpleNamespace(list=lambda **_: [], upsert=self.upsert))
        self.harvest_real = scout.harvest
        self.patch(scout, 'harvest', self.harvest)
        self.patch(scout, 'harvest_met', return_value=0)
        self.patch(scout, 'ai_ideas', return_value=None)
        self.patch(scout.scout_role_search, 'guarded', return_value=None)
        self.patch(scout.scout_need, 'covered', return_value=None)
        self.patch(scout.employer_index, 'central_nofeed', side_effect=lambda: self.dead)
        self.patch(scout.scout_core, 'CENTRAL', False)
        self.patch(scout, 'load_search_config', return_value={'role_keywords': []})
        self.patch(scout, 'skipped_origins', return_value=())
        self.patch(scout, 'starter_list', return_value=[])
        self.patch(scout, 'now', return_value=STAMP)
        self.patch(scout_candidates, 'now', return_value=STAMP)
        self.patch(scout_index, 'now', return_value=STAMP)
        self.patch(scout_notion, 'now', return_value=STAMP)
        self.patch(scout, 'time', SimpleNamespace(monotonic=lambda: self.clock[0]))
        self.patch(scout_candidates, 'time', scout.time)
        self.patch(scout.run_exit, 'until')
        self.patch(scout.budget_tape, 'until', side_effect=lambda name, end: lambda: end is None or self.clock[0] < end)
        self.patch(scout, 'find_feed', side_effect=self.find)
        self.patch(scout, 'quality', side_effect=lambda jobs: (80, dict(STATS, **jobs[0])))
        self.patch(scout, 'ThreadPoolExecutor', side_effect=self.executor)
        self.patch(scout, 'wait', side_effect=lambda *a, **kw: self.pool.wait(*a, **kw))
        self.patch(scout.contribute, 'share_now', side_effect=self.share)
        self.patch(scout.contribute, 'enabled', return_value=True)
        self.patch(visits, 'refused')
        self.patch(scout.careers, 'REFUSALS', {})
        self.patch(scout, 'mark_synced', wraps=scout.mark_synced)

    def patch(self, obj, name, *args, **kwargs):
        return self.stack.enter_context(mock.patch.object(obj, name, *args, **kwargs))

    def executor(self, max_workers):
        self.pool = Checks(max_workers)
        return self.pool

    def harvest(self, db, seeds, sources=None, skip=(), until=None):
        return self.harvest_real(db, seeds, self.sources if sources is None else sources, skip, until)

    def find(self, candidate, probe, note, **kwargs):
        self.events.append(('probe', candidate['name']))
        return probe(candidate['ats'], candidate['slug'])

    def share(self, **kwargs):
        # A share observes the candidate and feed already written and committed.
        self.assertFalse(self.db.in_transaction)
        self.events.append(('share', kwargs))
        return True

    def upsert(self, record):
        self.assertFalse(self.db.in_transaction)
        self.events.append(('store', record))

    def candidate(self, name='Alpha', **extra):
        return dict(name=name, origin='AI idea', priority=90, ats='lever', slug=name.lower(), **extra)

    def crawl(self, names=(), probe=lambda *_: None, workers=1, **kwargs):
        out = io.StringIO()
        sources = kwargs.pop('harvest_sources', [lambda: names])
        with redirect_stdout(out):
            result = scout.run(self.db, batch=10, stores=self.stores, seeds=SEEDS, probe=probe,
                               harvest_sources=sources, workers=workers, **kwargs)
        self.assertEqual(self.pool.max_workers, workers * 4)
        self.assertEqual(self.pool.shutdown_args, {'wait': False, 'cancel_futures': True})
        return result, out.getvalue().splitlines()

    def summary(self, checked=1, harvested=1, queued=0, total_feeds=0, left=0, **extra):
        return dict(checked=checked, first_time=checked, left=left, harvested=harvested, queued=queued,
                    total_feeds=total_feeds, ideas=None, **extra)

    def row(self, name, outcome):
        row = dict(self.db.execute('SELECT * FROM scout_candidates WHERE name=?', (name,)).fetchone())
        status = 'found' if outcome['status'] == 'duplicate' else outcome['status']
        days = scout.RECHECK_DAYS.get(status)
        self.assertEqual(row, dict(key=name.lower(), name=name, origin='AI idea', priority=90, tier='Standard',
                                  ats='lever', slug=name.lower(), careers=None, website=None, status=status,
                                  quality=outcome.get('quality'), stats_json=json.dumps(outcome['stats']) if outcome.get('stats') else None,
                                  added_at=STAMP.isoformat(timespec='seconds'), checked_at=STAMP.isoformat(timespec='seconds'),
                                  next_check=(STAMP + timedelta(days=days)).isoformat(timespec='seconds') if days else None,
                                  checked_with=scout.READERS, outcome=outcome.get('outcome')))

    def test_no_seeds_yields_an_empty_run(self):
        result, lines = self.crawl()
        self.assertEqual(result, (self.summary(checked=0, harvested=0), []))
        self.assertEqual(lines, [READING, LISTS.replace('1 new', '0 new'), 'Scout: checking 0 employer(s)…'])
        self.assertEqual(self.events, [])
        self.assertEqual(list(self.db.execute('SELECT * FROM scout_candidates')), [])
        self.assertEqual(list(self.db.execute('SELECT * FROM feed_sources')), [])

    def test_a_failed_probe_is_saved_shared_and_logged(self):
        def broken(*_):
            raise TypeError('odd site')
        (summary, results), lines = self.crawl([self.candidate()], probe=broken)
        outcome = {'status': 'none', 'outcome': 'unreachable'}
        self.assertEqual(summary, self.summary())
        self.assertEqual([o for _, o in results], [outcome])
        self.row('Alpha', outcome)
        self.assertEqual(self.events, [('probe', 'Alpha'), ('share', {'dead': {'company': 'Alpha', 'host': None, 'outcome': 'unreachable'}})])
        self.assertEqual(lines, [READING, LISTS, 'Scout: checking 1 employer(s)…',
            'Warning: Alpha could not be checked: TypeError: odd site; counted as no job site we can read, and checked again when the readers change',
            'Scout: checked 1 of 1: Alpha', 'Pool: shared 0 new employers (none) and 1 dead ends (Alpha) as they were found'])
        self.assertEqual([tuple(r) for r in self.db.execute('SELECT * FROM notion_synced')], [('memory', 'alpha')])

    def test_a_found_feed_is_committed_before_sharing_then_written_to_the_store(self):
        (summary, results), lines = self.crawl([self.candidate()], probe=lambda *_: ('lever', 'alpha', [{}]))
        outcome = dict(status='found', ats='lever', slug='alpha', quality=80, stats=STATS)
        self.assertEqual(summary, self.summary(total_feeds=1))
        self.assertEqual([o for _, o in results], [outcome])
        self.row('Alpha', outcome)
        self.assertEqual([tuple(r) for r in self.db.execute('SELECT * FROM feed_sources')],
                         [('lever', 'alpha', 'Alpha', 'Standard', 80, 1, STAMP.isoformat(timespec='seconds'))])
        record = dict(name='Alpha', kind='Employer', tier='Standard', feed_status='Feed found', active=True, origin='AI idea',
                      glassdoor='https://www.glassdoor.com/Search/results.htm?keyword=Alpha',
                      levels_fyi='https://www.levels.fyi/companies/alpha/salaries', checked=STAMP.date().isoformat(), quality=80,
                      ats='lever', slug='alpha', feed='https://jobs.lever.co/alpha', careers_url='https://jobs.lever.co/alpha',
                      cities='Zurich', relevant_roles=1, in_preferred_places=1,
                      notes='1 postings; 1 matching; 1 in preferred places (1 in your countries or cities); stack overlap 100%',
                      integration='Working', added=STAMP.date().isoformat())
        self.assertEqual(self.events, [('probe', 'Alpha'), ('share', {'feed': dict(ats='lever', slug='alpha', company='Alpha', how='ai_idea', site=None, jobs=1)}), ('store', record)])
        self.assertEqual(lines, [READING, LISTS, 'Scout: checking 1 employer(s)…', 'Scout: checked 1 of 1: Alpha',
                                'Pool: shared 1 new employers (Alpha) and 0 dead ends (none) as they were found'])

    def test_static_feed_is_duplicate_without_store_or_pool_writes(self):
        (summary, results), lines = self.crawl([self.candidate()], probe=lambda *_: ('lever', 'alpha', [{}]),
                                             static=[dict(company='Existing', ats='lever', slug='alpha')])
        outcome = dict(status='duplicate', ats='lever', slug='alpha', quality=80, stats=STATS)
        self.assertEqual(summary, self.summary())
        self.assertEqual([o for _, o in results], [outcome])
        self.row('Alpha', outcome)
        self.assertEqual(self.events, [('probe', 'Alpha')])
        self.assertEqual(lines, [READING, LISTS, 'Scout: checking 1 employer(s)…', 'Scout: checked 1 of 1: Alpha'])
        self.assertEqual(list(self.db.execute('SELECT * FROM feed_sources')), [])
        self.assertEqual(scout.mark_synced.call_count, 0)

    def test_budget_reached_after_one_check_leaves_the_rest_pending(self):
        def probe(*_):
            self.clock[0] = 20
            return None
        (summary, results), lines = self.crawl([self.candidate(), self.candidate('Beta')], probe=probe, budget=20)
        self.assertEqual(summary, self.summary(harvested=2, queued=1))
        self.assertEqual([c['name'] for c, _ in results], ['Alpha'])
        self.row('Alpha', {'status': 'none', 'outcome': 'no_feed'})
        beta = self.db.execute("SELECT status, checked_at FROM scout_candidates WHERE name='Beta'").fetchone()
        self.assertEqual(tuple(beta), ('pending', None))
        self.assertEqual(lines, [READING, LISTS.replace('1 new', '2 new'), 'Scout: checking 2 employer(s)…', 'Scout: checked 1 of 2: Alpha',
            'Scout: its 20 s are up: 1 of 2 checked; the other 1 wait for the next run.',
            'Pool: shared 0 new employers (none) and 1 dead ends (Alpha) as they were found'])
        scout.run_exit.until.assert_called_once_with(20)

    def test_given_harvest_sources_skip_met_employers_and_lookups(self):
        with self.patch(scout, 'harvest_met', side_effect=AssertionError('met should not run')):
            (summary, _), _ = self.crawl([self.candidate()])
        self.assertEqual(summary, self.summary())
        self.assertIsNone(scout.find_feed.call_args.kwargs['search'])
        self.assertIsNone(scout.find_feed.call_args.kwargs['jobsch_lookup'])

    def test_workers_keep_result_order_and_save_in_completion_order(self):
        for workers, order in [(1, ['Alpha', 'Beta', 'Gamma']), (3, ['Gamma', 'Beta', 'Alpha'])]:
            with self.subTest(workers=workers):
                self.db.executescript('DROP TABLE IF EXISTS scout_candidates; DROP TABLE IF EXISTS feed_sources; DROP TABLE IF EXISTS notion_synced;')
                self.events.clear()
                (summary, results), lines = self.crawl([self.candidate(n) for n in ['Alpha', 'Beta', 'Gamma']], workers=workers,
                                                      probe=lambda _, slug: ('lever', slug, [{}]))
                self.assertEqual(summary, self.summary(checked=3, harvested=3, total_feeds=3))
                self.assertEqual([c['name'] for c, _ in results], ['Alpha', 'Beta', 'Gamma'])
                self.assertEqual([e[1]['name'] for e in self.events if e[0] == 'store'], order)
                self.assertEqual([e[0] for e in self.events], ['probe', 'share', 'store'] * 3)
                self.assertEqual(lines[3:6], [f'Scout: checked {i} of 3: {name}' for i, name in enumerate(order, 1)])

    def test_watch_low_manual_and_no_feed_branches(self):
        for status, found, extra in [('watch', ('lever', 'alpha', []), {}),
                                     ('low', ('lever', 'alpha', [dict(preferred=0, relevant=0)]), {}),
                                     ('manual', None, {'status': 'manual'}), ('none', None, {})]:
            with self.subTest(status=status):
                self.db.executescript('DROP TABLE IF EXISTS scout_candidates; DROP TABLE IF EXISTS feed_sources; DROP TABLE IF EXISTS notion_synced;')
                self.events.clear()
                (summary, results), _ = self.crawl([self.candidate(**extra)], probe=lambda *_: found)
                self.assertEqual(results[0][1]['status'], status)
                self.assertEqual(summary, self.summary())
                self.assertEqual(self.db.execute('SELECT status FROM scout_candidates').fetchone()[0], status)


if __name__ == '__main__':
    unittest.main()
