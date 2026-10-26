"""The scheduled search on the active store (src/stores), end to end: no Notion, no network, no AI.

A person on this Mac's store gets the run's row, the crawl's employers, the budget, the insight and the health alert from that
store; a Notion token beside another store never brings a second copy into Notion (only the Pipeline page stays Notion's).
Guards src/daily.py, src/daily_search.py and the run_stores / url_stages / profile_source helpers in src/store_access.py.
"""
import contextlib
import json
import dataclasses
import io
import pathlib
import socket
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from unittest import mock

from src import daily, daily_helpers, daily_search, run_log, store_access
from src.stores import memory

JOB = {'url': 'https://jobs.example/sre-1', 'title': 'SRE', 'company': 'Example', 'location': 'Zurich', 'description': 'Kubernetes on call.'}


class ScheduledRunOnTheStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.stores = memory.open_store()
        self.stores.applications.set_stage({'url': 'https://jobs.example/applied-1', 'title': 'Old', 'company': 'Was'}, 'Applied')
        self.calls = []
        record = lambda name, result=None: (lambda *a, **k: self.calls.append((name, a, k)) or result)  # noqa: E731
        no_network = mock.patch.object(socket.socket, 'connect', side_effect=AssertionError('the run reached the network'))
        patches = [
            no_network,
            mock.patch.object(daily.notion.Tracker, 'from_env', return_value=None),
            mock.patch.object(store_access, 'open_stores', lambda tracker=None: self.stores),
            mock.patch.object(daily_search, 'DATA', self.tmp), mock.patch.object(daily_search, 'REPORTS', self.tmp),
            mock.patch.object(daily_helpers, 'REPORTS', self.tmp),
            mock.patch.object(daily_search, 'downloaded_index', return_value=[]),
            mock.patch.object(daily_search.feeds, 'scan', return_value={'jobs': [JOB], 'sources': []}),
            mock.patch('src.sources.aggregators.scan', return_value={'jobs': [], 'sources': []}),
            mock.patch.object(daily_search.describe, 'backfill', return_value=''),
            mock.patch.object(daily_search.google_jobs, 'api_key', return_value=''),
            mock.patch.object(daily_search.coverage, 'save'),
            mock.patch.object(daily_search.telegram, 'to_app'),
            mock.patch.object(daily_search.telegram, 'credentials', return_value=('token', 'chat')),
            mock.patch.object(daily_search.telegram, 'send', side_effect=record('telegram')),
            mock.patch.object(daily_search.scout, 'active_sources', side_effect=record('scout', [])),
            mock.patch.object(daily_search.contribute, 'maybe_send', side_effect=record('contribute')),
            mock.patch.object(daily_search.budget, 'status', side_effect=record('budget', {'usd': 0})),
            mock.patch.object(daily_search.budget, 'describe', return_value='$0'), mock.patch.object(daily_search.budget, 'alert_once'),
            mock.patch.object(daily_search.budget, 'apply_caps'),
            mock.patch.object(daily_search.insights, 'run', side_effect=record('insight', 'Insight: none today')),
            mock.patch.object(daily_search.doctor, 'alert', side_effect=record('doctor', 'Health: all good')),
            mock.patch.object(daily_search.doctor, 'HEALTH_HOUR_UTC', datetime.now(timezone.utc).hour),
            mock.patch.object(daily_search.ledger_store, 'sync', side_effect=record('ledger', 'Ledger sync: 1 applications')),
            mock.patch.object(daily_search.ledger_store, 'close_gone', side_effect=record('gone', ('Taken-down postings: 0', []))),
            mock.patch.object(daily_search.funnel, 'write', side_effect=AssertionError('the Pipeline page is Notion only')),
            mock.patch.object(daily_search.interviews, 'sweep', side_effect=record('sweep', 'Interviews: none to move on')),
            mock.patch.object(run_log, '_install', lambda: None), mock.patch.object(run_log, '_heartbeat', lambda run: None),
            mock.patch.object(run_log, 'capture', lambda: None),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(run_log._auto.clear)
        self.addCleanup(run_log._open.clear)

    def run_daily(self, *extra, env=None):
        argv = ['daily', '--mode', 'scheduled', '--log-run', '--insight', '--db', str(self.tmp / 'jobs.sqlite'), *extra]
        out = io.StringIO()
        with mock.patch.object(sys, 'argv', argv), mock.patch.dict('os.environ', env or {'JOB_PILOTTO_STORE': 'memory', 'JOB_PILOTTO_DISABLE': 'mail,notion,google_jobs'}), \
                contextlib.redirect_stdout(out):
            code = daily.main()
        return code, out.getvalue()

    def test_a_scheduled_run_on_this_macs_store_logs_its_row_and_uses_the_store_everywhere(self):
        code, out = self.run_daily('--send')   # the sending run: the insight and the health alert come after the digest
        self.assertEqual(code, 0, out)
        runs = self.stores.cron_runs.list()
        self.assertEqual(len(runs), 1, out)                     # the run's row, in the store
        self.assertEqual(runs[0]['mode'], 'scheduled')
        by_name = {name: (a, k) for name, a, k in self.calls}
        self.assertIs(by_name['scout'][0][1], self.stores)      # the crawl's employers: this store's
        self.assertIn('Job Matches:', out)                      # the search's matches: synced into this store
        self.assertIs(by_name['contribute'][0][2], self.stores)
        self.assertIs(by_name['budget'][0][0], self.stores)     # the AI budget: this store's run rows
        self.assertIs(by_name['insight'][0][1], self.stores)   # the daily insight runs on this store alone, without Notion
        self.assertIs(by_name['doctor'][0][0], self.stores)     # the daily health alert: this store's checks
        self.assertIs(by_name['ledger'][0][0], self.stores)     # the ledger sync and the taken-down check: this store's applications
        self.assertIs(by_name['gone'][0][0], self.stores)
        self.assertIs(by_name['sweep'][1]['stores'], self.stores)   # recorded interviews move their job on, on any store
        stages = by_name['contribute'][1]['stages']
        self.assertEqual(stages, {'https://jobs.example/applied-1': 'Applied'})   # the store's applications, by their own URL

    def test_a_notion_token_beside_another_store_writes_nothing_to_notion(self):
        tracker = mock.Mock(side_effect=AssertionError)
        tracker.url_stages.side_effect = AssertionError('Notion read on this Mac\'s store')
        tracker.page_text.side_effect = AssertionError('Notion Profile read on this Mac\'s store')
        with mock.patch.object(daily.notion.Tracker, 'from_env', return_value=tracker), \
                mock.patch.object(store_access, 'open_stores', lambda tracker=None: self.stores):
            code, out = self.run_daily('--score-max', '0')
        self.assertEqual(code, 0, out)
        self.assertEqual(len(self.stores.cron_runs.list()), 1)
        self.assertEqual(tracker.method_calls, [])               # the tracker was never asked anything

    def test_the_run_stores_and_the_notion_only_tracker(self):
        notion_like = dataclasses.replace(memory.open_store(), name='notion')
        tracker = object()
        with mock.patch.object(store_access, 'open_stores', lambda tracker=None: notion_like):
            self.assertEqual(daily_helpers.run_stores(tracker), (notion_like, tracker))
        with mock.patch.object(store_access, 'open_stores', lambda tracker=None: self.stores):
            self.assertEqual(daily_helpers.run_stores(tracker), (self.stores, None))

    def test_the_modes_get_notions_client_exactly_when_the_engine_had_a_tracker(self):
        """open_run + notion_of (src/store_access.py): the engine's own client on Notion, None on this Mac's store and when
        Tracker.from_env gave none (no token, Notion switched off), even if the store is Notion anyway."""
        tracker = object()
        notion_like = lambda tracker=None: dataclasses.replace(memory.open_store(), name='notion',  # noqa: E731
                                                               applications=mock.Mock(tracker=tracker or object()))
        with mock.patch.object(daily.notion.Tracker, 'from_env', return_value=tracker), \
                mock.patch.object(store_access, 'open_stores', notion_like):
            self.assertIs(store_access.notion_of(store_access.open_run()), tracker)
        with mock.patch.object(daily.notion.Tracker, 'from_env', return_value=None), \
                mock.patch.object(store_access, 'open_stores', notion_like):
            self.assertIsNone(store_access.notion_of(store_access.open_run()))   # a Notion store, but no engine tracker
        with mock.patch.object(daily.notion.Tracker, 'from_env', return_value=tracker), \
                mock.patch.object(store_access, 'open_stores', lambda tracker=None: self.stores):
            self.assertIsNone(store_access.notion_of(store_access.open_run()))   # this Mac's store
        self.assertIsNone(store_access.notion_of(None))

    def test_the_profile_for_scoring_comes_from_the_store_without_notion(self):
        with mock.patch.object(store_access, 'local_profile', return_value=''):
            self.assertIsNone(daily_helpers.profile_source(self.stores))           # nothing to score with: the warning says so
            self.stores.texts.set('profile', '# Me\nSRE in Zurich')
            self.assertIn('SRE in Zurich', daily_helpers.profile_source(self.stores)())
            with mock.patch.object(self.stores.texts, 'plain', lambda name: 'as the page reads'):
                self.assertEqual(daily_helpers.profile_source(self.stores)(), 'as the page reads')   # texts.plain: Notion's page text

    def test_a_scheduled_run_never_reads_job_alert_emails_while_they_are_parked(self):
        """Owner, 26 Oct 2026: job alerts parked (src/features.py PARKED). Gmail and the AI ready: no scan, unless JOB_PILOTTO_ENABLE names it."""
        from src.ai import engine
        from src.sources import google as google_api, job_alerts
        env = {'JOB_PILOTTO_STORE': 'memory', 'GOOGLE_REFRESH_TOKEN': 't', 'JOB_PILOTTO_AI_ENGINE': 'cli',
               'JOB_PILOTTO_DISABLE': 'mail,notion,google_jobs,page_reader,scout_ai,title_triage,place_triage,found_boards,role_ideas'}
        for extra, read in (({}, False), ({'JOB_PILOTTO_ENABLE': 'job_alerts'}, True)):   # the second: proof the run reaches the switch
            with self.subTest(extra=extra), mock.patch.object(engine, 'ready', return_value=True), \
                    mock.patch.object(engine, 'client', return_value=object()), \
                    mock.patch.object(google_api.Google, 'from_env', return_value=mock.Mock(scopes=None)), \
                    mock.patch.object(job_alerts, 'scan', return_value={'jobs': [], 'sources': []}) as scan:
                code, out = self.run_daily('--score-max', '0', env={**env, **extra})
                self.assertEqual(code, 0, out)
                self.assertEqual(scan.called, read, out)



class ModesOnTheStoreTests(unittest.TestCase):
    """The modes a button or the app runs (src/daily_modes.py): on this Mac's store without Notion where they have moved, and a
    clear "only with Notion for now" where they haven't; a Notion store that can't be read keeps today's message."""

    def test_the_gates(self):
        from src import daily_modes
        sqlite_like = dataclasses.replace(memory.open_store(), name='sqlite')
        notion_like = dataclasses.replace(memory.open_store(), name='notion')
        with mock.patch.object(daily_modes, 'notion_ready', lambda stores: True):
            daily_modes._gate(notion_like, 'x requires NOTION_TOKEN', on_store=False)          # Notion readable: every mode
        daily_modes._gate(sqlite_like, 'x requires NOTION_TOKEN', on_store=True)               # moved: runs on this Mac's store
        with self.assertRaisesRegex(SystemExit, '^--mode add works only with Notion for now'):
            daily_modes._gate(sqlite_like, '--mode add requires NOTION_TOKEN', on_store=False)
        for unreadable in (None, notion_like):                                                # as before (no engine client)
            with self.assertRaisesRegex(SystemExit, '^--mode kits requires NOTION_TOKEN$'):
                daily_modes._gate(unreadable, '--mode kits requires NOTION_TOKEN', on_store=True)

    def test_an_applied_tap_marks_the_job_in_this_macs_store_with_its_event(self):
        stores = memory.open_store()
        stores.applications.set_stage({'url': 'https://jobs.example/sre', 'title': 'SRE', 'company': 'Acme'}, 'Kit ready')
        db = mock.Mock()
        with mock.patch.object(daily_helpers, 'find_job', return_value=None), \
                mock.patch.object(daily_helpers.ats, 'posting', return_value=None), \
                mock.patch('src.ledger_store.record', return_value=(None, 'recorded')) as recorded, \
                mock.patch.object(daily_helpers, 'queue_mail_check'):
            reply = daily_helpers.apply_message(db, 'https://jobs.example/sre', stores, 'applied')
        self.assertIn('Marked applied', reply)
        self.assertIn('Track the stage in the app', reply)                      # no Notion link to give
        self.assertEqual(stores.applications.stages(), {'https://jobs.example/sre': 'Applied'})
        app = stores.applications.list()[0]
        self.assertEqual([e['kind'] for e in stores.events.list(app['id'])], ['Applied'])
        recorded.assert_called_once()

    def test_an_application_made_elsewhere_is_tracked_in_this_macs_store(self):
        """/add <job URL> (or the app's "Add a job" as applied) without Notion: Applied, its event, and the run linked to the job."""
        stores = memory.open_store()
        url = 'https://jobs.example/platform-7'
        out = io.StringIO()
        argv = ['daily', '--mode', 'add', '--job', url, '--note', '', '--log-run', '--job-title', 'Platform Engineer',
                '--job-company', 'Acme', '--db', str(pathlib.Path(tempfile.mkdtemp()) / 'jobs.sqlite')]
        with mock.patch.object(sys, 'argv', argv), mock.patch.dict('os.environ', {'JOB_PILOTTO_STORE': 'memory'}), \
                mock.patch.object(socket.socket, 'connect', side_effect=AssertionError('the run reached the network')), \
                mock.patch.object(daily.notion.Tracker, 'from_env', return_value=None), \
                mock.patch.object(store_access, 'open_stores', lambda tracker=None: stores), \
                mock.patch('src.notion.ledger.page_meta', return_value={}), \
                mock.patch('src.ai.added.process', return_value=None), \
                mock.patch('src.ledger_store.record', return_value=(None, 'recorded')), \
                mock.patch.object(daily_helpers, 'queue_mail_check'), mock.patch('src.daily_modes.queue_mail_check'), \
                mock.patch.object(run_log, '_install', lambda: None), mock.patch.object(run_log, 'capture', lambda: None), \
                mock.patch.object(run_log, '_heartbeat', lambda run: None), contextlib.redirect_stdout(out):
            self.addCleanup(run_log._auto.clear)
            self.addCleanup(run_log._open.clear)
            code = daily.main()
        self.assertEqual(code, 0, out.getvalue())
        app = stores.applications.get(url)
        self.assertEqual((app['stage'], app['company'], app['title']), ('Applied', 'Acme', 'Platform Engineer'))
        self.assertEqual([e['kind'] for e in stores.events.list(app['id'])], ['Applied'])
        logged = [line for line in out.getvalue().splitlines() if line.startswith('Job logged: ')]
        self.assertEqual(json.loads(logged[0][len('Job logged: '):])['page_id'], app['id'])   # the app links the run to this job
        self.assertEqual(stores.cron_runs.list()[0]['mode'], 'add')

if __name__ == '__main__':
    unittest.main()
