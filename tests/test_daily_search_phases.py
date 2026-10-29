# Characterize search ordering, stored jobs, reports and delivery without network or AI.
import contextlib
import io
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest import mock

from src import daily_helpers, daily_search, store, time_budget
from src.ai import engine, score
from src.daily_args import build_parser
from src.sources import aggregators, board_web, boards_ahead, boards_first, eures, feed_facts, feeds, found_boards
from src.stores import memory


JOB = {'id': 'one', 'url': 'https://example.test/jobs/one', 'title': 'SRE', 'company': 'Example',
       'location': 'Zurich', 'description': 'A fictional job.'}
SOURCE = {'company': 'Example', 'ats': 'lever', 'slug': 'example'}


class SearchCharacterization(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.calls, self.runs = [], []
        self.jobs, self.sources = [dict(JOB)], [dict(SOURCE)]
        self.failed = self.expire = self.late_jobs = False
        self.stores = memory.open_store()
        self.stores.texts.set('profile', 'Fictional SRE in Zurich')
        self.db = store.connect(':memory:')
        self.addCleanup(self.db.close)
        self.addCleanup(time_budget.start, 0)
        time_budget.start(0)
        self.args = build_parser('test').parse_args(['--mode', 'run', '--score-max', '4', '--enrich-max', '4',
            '--seed', '7', '--db', ':memory:', '--company-report', str(self.root / 'missing.json')])
        self.matches_sync = self.stores.matches.sync
        self.import_report = store.import_watch_report
        self.enrich_error = self.score_error = None
        patches = [
            mock.patch.dict(os.environ, {'JOB_PILOTTO_DATA_DIR': str(self.root), 'JOB_PILOTTO_CONFIG_DIR': str(self.root),
                                        'JOB_PILOTTO_DISABLE': 'mail,notion,google_jobs,job_alerts'}),
            mock.patch.object(socket.socket, 'connect', side_effect=AssertionError('network forbidden')),
            mock.patch.object(engine, 'client', side_effect=AssertionError('AI forbidden')),
            mock.patch.object(engine, 'ready', return_value=True),
            mock.patch.object(daily_search, 'open_run', return_value=self.stores),
            mock.patch.object(daily_search, 'DATA', self.root), mock.patch.object(daily_search, 'REPORTS', self.root),
            mock.patch.object(daily_helpers, 'REPORTS', self.root),
            mock.patch.object(daily_search, 'load_search_config', return_value={}),
            mock.patch.object(daily_search, 'scoring_plan', side_effect=self.plan),
            mock.patch.object(daily_search, 'starter_sources', return_value=[]),
            mock.patch.object(daily_search, 'downloaded_index', return_value=[]),
            mock.patch.object(daily_search.employer_index, 'problem', ''),
            mock.patch.object(daily_search.scout, 'active_sources', side_effect=lambda *a: self.event('sources', self.sources)),
            mock.patch.object(board_web, 'early', side_effect=lambda *a: self.event('web')),
            mock.patch.object(eures, 'start_early', side_effect=lambda *a: self.event('eures')),
            mock.patch.object(boards_first, 'run', side_effect=lambda *a: self.event('boards first', [])),
            mock.patch.object(daily_search.first_jobs, 'propose_early', side_effect=lambda: self.event('proposal')),
            mock.patch.object(daily_search.first_jobs, 'run', side_effect=lambda *a, **k: self.event('slice')),
            mock.patch.object(boards_ahead, 'scan_beside', side_effect=self.gather),
            mock.patch.object(aggregators, 'scan', side_effect=lambda *a, **k: self.event('apis', {'jobs': [], 'sources': []})),
            mock.patch.object(daily_search.google_jobs, 'api_key', return_value=''),
            mock.patch.object(daily_search.coverage, 'save', side_effect=lambda *a: self.event('coverage')),
            mock.patch.object(daily_search.contribute, 'maybe_send', side_effect=lambda *a, **k: self.event('contribute')),
            mock.patch.object(feed_facts, 'keep_seen', side_effect=lambda *a: self.event('keep seen')),
            mock.patch.object(store, 'connect', side_effect=lambda *a: contextlib.nullcontext(self.db)),
            mock.patch.object(store, 'import_watch_report', side_effect=self.import_jobs),
            mock.patch.object(store, 'close_stale', side_effect=lambda *a, **k: self.event('stale', 0)),
            mock.patch.object(store, 'close_dropped', side_effect=lambda *a: self.event('dropped', 0)),
            mock.patch.object(feeds, 'place_open_jobs', side_effect=lambda *a: self.event('places')),
            mock.patch.object(store, 'close_elsewhere', side_effect=lambda *a, **k: self.event('elsewhere', 0)),
            mock.patch.object(store, 'prune_gone', side_effect=lambda *a: self.event('prune', 0)),
            mock.patch.object(daily_search.describe, 'backfill', side_effect=lambda *a: self.event('descriptions', 'Backfilled')),
            mock.patch.object(daily_search.enrich, 'run', side_effect=self.enrich),
            mock.patch.object(score, 'run', side_effect=self.score),
            mock.patch.object(daily_search.digest, 'eligible_jobs', side_effect=lambda db, *a, **k: (store.digest_jobs(db, only_new=False), [])),
            mock.patch.object(feeds, 'place_of', return_value='top'),
            mock.patch.object(self.stores.matches, 'sync', side_effect=self.sync),
            mock.patch.object(daily_search.source_yield, 'run', side_effect=lambda *a, **k: self.event('yield')),
            mock.patch.object(found_boards, 'read_since', return_value=[]),
            mock.patch.object(daily_search.digest, 'build_digest', side_effect=self.digest),
            mock.patch.object(daily_search.telegram, 'to_app', side_effect=lambda text: self.event('app')),
            mock.patch.object(daily_search.telegram, 'credentials', return_value=('token', 'chat')),
            mock.patch.object(daily_search.telegram, 'send', side_effect=lambda *a, **k: self.event('send')),
            mock.patch.object(daily_search.notify, 'wants_email', return_value=False),
            mock.patch.object(daily_search.digest, 'mark_shown', side_effect=lambda *a: self.event('shown')),
            mock.patch.object(daily_search, 'save_run', side_effect=lambda run: self.event('save', self.runs.append(dict(run)))),
            mock.patch.object(daily_search, 'log_crawl', side_effect=lambda stores, run: self.event('log', stores.cron_runs.put({'mode': run['mode']}))),
            mock.patch.object(daily_search.budget, 'status', return_value=None),
            mock.patch.object(daily_search.budget, 'describe', return_value='test budget'),
            mock.patch.object(daily_search.budget, 'apply_caps'),
            mock.patch.object(daily_search.ledger_store, 'sync', side_effect=lambda *a: self.event('ledger', 'Ledger')),
            mock.patch.object(daily_search.ledger_store, 'close_gone', side_effect=lambda *a: self.event('gone', ('Gone', []))),
            mock.patch.object(daily_search.interviews, 'sweep', side_effect=lambda **k: self.event('interviews', 'Interviews')),
            mock.patch.object(daily_search.doctor, 'alert', return_value='Health'),
            mock.patch.object(daily_search.insights, 'run', return_value='Insight'),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def event(self, name, result=None):
        self.calls.append(name)
        return result

    def plan(self, args, stores):
        self.event('plan')
        return (lambda: 'Fictional profile') if args.score_max else None

    def gather(self, sources, db, search, so_far, due):
        self.event('gather')
        jobs = [dict(j) for j in self.jobs] if sources else []
        if self.expire:
            jobs = jobs[:1]
            time_budget.start(180, now=0)
        source_rows = [{'company': s['company'], 'ok': not self.failed, 'total': len(jobs), 'matches': len(jobs)} for s in sources]
        if self.failed:
            jobs = []
        if not self.late_jobs:
            so_far.add(jobs, 'employer sites')
        return {'jobs': jobs, 'sources': source_rows}, None

    def import_jobs(self, db, report):
        self.event('import')
        return self.import_report(db, report)

    def enrich(self, db, model, maximum, stats, only_ids=None):
        self.event('enrich')
        if self.enrich_error:
            raise self.enrich_error
        stats.update(done=0, pending=0)
        return 'Enriched'

    def score(self, db, candidates, profile, model, maximum, stats, on_scored, only_ids):
        self.event('score')
        if self.score_error:
            raise self.score_error
        picked = [j for j in candidates if only_ids is None or j['id'] in only_ids]
        for job in picked:
            score.save(db, job, model, {'score': 81, 'reason': 'Fixture fit'}, profile)
            on_scored()
        stats.update(done=len(picked), pending=len(candidates))
        return f'Scored {len(picked)}'

    def sync(self, *a, **k):
        self.event('partial' if k.get('partial') else 'matches')
        return self.matches_sync(*a, **k)

    def digest(self, db, limit, shown_ids, **kwargs):
        self.event('digest')
        rows = store.digest_jobs(db, only_new=False)
        shown_ids.extend(j['id'] for j in rows)
        return [f'Digest: {len(rows)} jobs'], len(rows), [None]

    def run_search(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self.args, key, value)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = daily_search.search(self.args, self.stores)
        self.assertEqual(result, 0)
        self.assertEqual((self.root / 'daily-latest.txt').read_text(), f'Digest: {self.db.execute("SELECT count(*) FROM jobs").fetchone()[0]} jobs\n')
        self.report = json.loads((self.root / 'daily-latest.json').read_text())
        return output.getvalue()

    def assert_order(self, *names):
        for name in names:
            self.assertIn(name, self.calls)
        positions = [self.calls.index(name) for name in names]
        self.assertEqual(positions, sorted(positions), self.calls)

    def test_new_jobs_score_sync_save_and_report_in_order(self):
        out = self.run_search(log_run=True)
        self.assertIn('Added 1 new job(s): Zurich 1', out)
        self.assertIn('New job: SRE | Example | https://example.test/jobs/one', out)
        self.assertIn('Scored 1', out)
        self.assertEqual([r['fit'] for r in self.stores.matches.list()], [81])
        self.assertEqual(self.report['jobs'], [JOB])
        self.assertEqual(len(self.stores.cron_runs.list()), 1)
        self.assert_order('plan', 'web', 'eures', 'sources', 'boards first', 'gather', 'import', 'coverage', 'apis',
                          'keep seen', 'contribute', 'stale', 'dropped', 'places', 'elsewhere', 'prune', 'descriptions',
                          'enrich', 'score', 'partial', 'matches', 'yield', 'digest', 'app', 'save', 'log')

    def test_jobs_only_returned_at_gather_end_are_imported_too(self):
        self.late_jobs = True
        self.run_search()
        self.assertEqual(len(self.stores.matches.list()), 1)
        self.assertEqual(self.runs[0]['new'], 1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM jobs').fetchone()[0], 1)

    def test_timed_batches_score_before_reading_and_continue_in_order(self):
        self.jobs.append({**JOB, 'id': 'two', 'url': 'https://example.test/two', 'title': 'Second SRE'})
        time_budget.start(180)
        deadline = time_budget.DEADLINE
        with mock.patch.object(time_budget, 'batch', side_effect=[1, 1]), \
                mock.patch.object(time_budget, 'over', return_value=False), mock.patch.object(time_budget, 'record'):
            out = self.run_search()
        self.assertEqual(time_budget.DEADLINE, deadline)
        self.assertEqual(len(self.stores.matches.list()), 2)
        self.assertEqual(self.calls.count('score'), 2)
        self.assertEqual(out.count('Scored 1'), 2)
        self.assert_order('descriptions', 'score', 'partial', 'enrich', 'matches', 'digest')

    def test_no_sources_still_reports_and_saves_empty_search(self):
        self.sources = []
        out = self.run_search()
        self.assertEqual(self.report, {'jobs': [], 'sources': []})
        self.assertEqual(self.stores.matches.list(), [])
        self.assertNotIn('Added ', out)
        self.assertEqual(self.runs[0]['new'], 0)
        self.assert_order('gather', 'score', 'matches', 'digest', 'save')

    def test_failed_source_is_counted_without_blocking_report(self):
        self.failed = True
        out = self.run_search()
        self.assertFalse(self.report['sources'][0]['ok'])
        self.assertEqual(len(self.runs[0]['failing_feeds']), 1)
        self.assertEqual(self.stores.matches.list(), [])
        self.assertIn('Scored 0', out)

    def test_deadline_hit_during_gather_keeps_partial_jobs_and_clock(self):
        self.jobs.append({**JOB, 'id': 'two', 'url': 'https://example.test/two', 'title': 'Second SRE'})
        self.expire = True
        # Why (29 Oct 2026): now=0 sets deadline 180; a fresh Linux runner's monotonic clock can still be below it.
        with mock.patch.object(time_budget.time, 'monotonic', return_value=181):
            out = self.run_search()
        self.assertEqual(len(self.report['jobs']), 1)
        self.assertEqual(time_budget.DEADLINE, 180)
        self.assertEqual(self.stores.matches.list(), [])
        self.assertIn('Scored 0', out)
        self.assert_order('gather', 'descriptions', 'score', 'enrich', 'digest', 'save')

    def test_nothing_new_does_not_send_or_mark_shown(self):
        self.jobs = []
        out = self.run_search(mode='scheduled', send=True)
        self.assertIn('No new jobs since the last run; nothing sent.', out)
        self.assertNotIn('send', self.calls)
        self.assertNotIn('shown', self.calls)
        self.assertEqual(self.runs[0]['telegram'], 'nothing new; not sent')
        self.assert_order('matches', 'ledger', 'gone', 'interviews', 'digest', 'save', 'log')

    def test_more_preview_never_imports_syncs_or_saves(self):
        self.import_report(self.db, {'jobs': [JOB]})
        out = self.run_search(mode='more')
        self.assertEqual(self.report, {'jobs': [], 'sources': []})
        for name in ('gather', 'import', 'matches', 'save', 'log', 'shown'):
            self.assertNotIn(name, self.calls)
        self.assertIn('Scored 1', out)
        self.assertEqual(self.stores.matches.list(), [])
        self.assert_order('descriptions', 'enrich', 'score', 'digest', 'app')

    def test_first_slice_precedes_boards_and_full_gather(self):
        self.run_search(first_jobs=True)
        self.assert_order('plan', 'proposal', 'web', 'sources', 'slice', 'boards first', 'gather')

    def test_only_visits_does_not_start_web_or_close_jobs(self):
        self.sources.append({'company': 'Browser', 'ats': 'visit', 'slug': 'browser'})
        out = self.run_search(mode='today', only_visits=True)
        self.assertIn('Reading only the 1 page(s) read in Chrome on this Mac', out)
        for name in ('web', 'boards first', 'apis', 'stale', 'dropped', 'places'):
            self.assertNotIn(name, self.calls)
        self.assertEqual([s['company'] for s in self.report['sources']], ['Browser'])

    def test_enrichment_and_scoring_errors_are_warned_and_reported(self):
        self.enrich_error = ValueError('facts fixture')
        self.score_error = ValueError('score fixture')
        out = self.run_search()
        self.assertIn('Warning: enrichment skipped: ValueError: facts fixture', out)
        self.assertIn('Warning: scoring skipped: ValueError: score fixture', out)
        self.assertIn('enrichment skipped: ValueError', self.runs[0]['warnings'])
        self.assertIn('scoring skipped: ValueError', self.runs[0]['warnings'])
        self.assert_order('enrich', 'score', 'matches', 'digest', 'save')

    def test_sent_digest_marks_shown_before_save(self):
        out = self.run_search(send=True)
        self.assertIn('Sent 1 Telegram message(s); imported 1 jobs.', out)
        self.assertEqual(self.runs[0]['telegram'], 'sent 1 message(s), 1 new')
        self.assert_order('digest', 'send', 'shown', 'save', 'log')

    def test_refused_delivery_leaves_jobs_unshown(self):
        with mock.patch.object(daily_search.telegram, 'send', side_effect=ValueError('refused')), \
                mock.patch.object(daily_search.telegram, 'failure_words', return_value='Delivery refused'):
            out = self.run_search(send=True)
        self.assertIn('Warning: Delivery refused', out)
        self.assertNotIn('shown', self.calls)
        self.assertEqual(self.runs[0]['telegram'], 'not sent: Telegram refused it')
        self.assertEqual(len(self.stores.matches.list()), 1)


if __name__ == '__main__':
    unittest.main()
