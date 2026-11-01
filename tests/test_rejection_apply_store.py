"""The rejection review, a mail's record and the Apply commands (src/ai/rejection.py, mail_record.py, apply_batch.py, apply_run.py) on the
store: each runs on this Mac's SQLite store with no Notion at all, and with a Notion token each opens the Notion store through open_stores
(no Notion client of its own). 9 Oct 2026, Notion optional."""
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

from src import run_log
from src.ai import apply_batch, apply_run, mail_record, rejection
from src.stores import base, open_stores

URL = 'https://jobs.test/acme/sre'
JOB = {'url': URL, 'title': 'SRE', 'company': 'Acme', 'applied_on': '2026-09-20'}
RESULT = {'verdict': 'Hard skills', 'confidence': 'medium', 'stage_reached': 'CV screen (no call)', 'summary': 'Wanted Kubernetes.',
          'evidence': ['The posting asks for Kubernetes'], 'improve': ['Show the Kubernetes work']}
KIT = {'url': URL, 'answers': [], 'check_before_sending': []}


class _Opened(Exception):
    """The Notion store was opened: the test stops there, before any request."""


def sqlite_env(folder):
    return {'JOBADABRA_STORE': 'sqlite', 'JOBADABRA_DATA_DIR': folder, 'PATH': os.environ.get('PATH', '')}


def opened_notion(test, run, env):
    """The token the Notion store was opened with when `run()` ran in `env` alone (no other environment)."""
    seen = []
    def open_store(store_env, tracker=None):
        seen.append((store_env.get('NOTION_TOKEN'), tracker))
        raise _Opened
    with mock.patch.dict(os.environ, env, clear=True), mock.patch('src.stores.notion.open_store', side_effect=open_store):
        with test.assertRaises(_Opened):
            run()
    test.assertEqual(len(seen), 1)
    return seen[0]


class RejectionOnTheStoreTests(unittest.TestCase):
    def test_a_review_runs_on_sqlite_and_writes_on_the_job(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict(os.environ, sqlite_env(folder), clear=True), \
                mock.patch.object(rejection, 'analyse', return_value=(dict(RESULT), None)), \
                mock.patch('src.ai.engine.client', return_value=object()), \
                mock.patch.object(rejection.cost, 'answered', return_value='claude-test'), redirect_stdout(io.StringIO()), \
                mock.patch.object(run_log, '_install', lambda: None), mock.patch.object(run_log, '_heartbeat', lambda run: None), \
                mock.patch.object(run_log, 'capture', lambda: None), mock.patch.dict(run_log._open), mock.patch.dict(run_log._auto):
            # run_log keeps the process's open run (_open, _auto): restored after, so later tests start clean
            open_stores().applications.create(JOB, 'Rejected')
            self.assertEqual(rejection.main(['--pending']), 0)
            stores = open_stores()
            app = stores.applications.get(URL)
            self.assertEqual(stores.name, 'sqlite')
            self.assertEqual(app['rejection'], 'Hard skills')
            self.assertIn('Wanted Kubernetes.', stores.applications.section(app['id'], rejection.HEADING))
            self.assertEqual(rejection.pending(stores), [])

    def test_a_notion_token_opens_the_notion_store(self):
        token, tracker = opened_notion(self, lambda: rejection.main(['--pending']), {'NOTION_TOKEN': 'secret-test'})
        self.assertEqual((token, tracker), ('secret-test', None))


class MailRecordOnTheStoreTests(unittest.TestCase):
    def test_a_rejection_email_moves_the_job_and_logs_its_event_on_sqlite(self):
        with tempfile.TemporaryDirectory() as folder:
            stores = open_stores(sqlite_env(folder))
            row, _ = stores.applications.set_stage(JOB, 'Applied')
            said = mail_record.record(stores, row, 'Rejected', '2026-10-01T09:00:00+00:00', 'Gmail', 'mail-1', 'Not moving forward',
                                      mail_record._events_index(stores))
            self.assertEqual(said, 'Rejected')
            self.assertEqual(stores.applications.get(URL)['stage'], 'Rejected')
            (event,) = stores.events.list(app_id=row['id'])
            self.assertEqual((event['kind'], event['source_id']), ('Rejected', 'mail-1'))
            self.assertEqual(event['changes']['fields']['Stage'], ['Applied', 'Rejected'])
            self.assertIsNone(mail_record.record(stores, row, 'Rejected', '2026-10-01T09:00:00+00:00', 'Gmail', 'mail-1', '',
                                                 mail_record._events_index(stores)))   # the same mail twice: known


class ApplyBatchOnTheStoreTests(unittest.TestCase):
    def run_main(self, *argv):
        out = io.StringIO()
        with mock.patch.object(sys, 'argv', ['apply_batch', *argv]), redirect_stdout(out):
            return apply_batch.main(), out.getvalue()

    def test_marks_and_the_kit_check_run_on_sqlite(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict(os.environ, sqlite_env(folder), clear=True):
            stores = open_stores()
            app = stores.applications.create(JOB, 'Kit ready')
            stores.applications.set_section(app['id'], base.KIT_SECTION, '### Machine-readable kit\n\n```json\n{"url": "%s"}\n```' % URL)
            self.assertEqual(self.run_main('--has-kit', URL)[0], 0)
            self.assertEqual(self.run_main('--mark-applying', URL), (0, f'{URL}: updated\n'))
            self.assertEqual(open_stores().applications.get(URL)['stage'], 'Applying')

    def test_a_notion_token_opens_the_notion_store(self):
        run = lambda: self.run_main('--has-kit', URL)
        self.assertEqual(opened_notion(self, run, {'NOTION_TOKEN': 'secret-test'}), ('secret-test', None))


class ApplyRunOnTheStoreTests(unittest.TestCase):
    def test_the_session_context_reads_the_kit_and_texts_on_sqlite(self):
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict(os.environ, sqlite_env(folder), clear=True), \
                mock.patch.object(apply_run, '_keychain_token', return_value='') as keychain, redirect_stdout(out):
            stores = open_stores()
            app = stores.applications.create(JOB, 'Kit ready')
            stores.applications.set_section(app['id'], base.KIT_SECTION, '### Machine-readable kit\n\n```json\n{"url": "%s"}\n```' % URL)
            stores.texts.set('profile', 'Site reliability engineer.')
            apply_run.main(['--context', URL])
        self.assertIn('Site reliability engineer.', out.getvalue())
        self.assertIn(f'"url": "{URL}"', out.getvalue())
        keychain.assert_called()

    def test_the_keychain_token_opens_the_notion_store_and_an_env_token_wins(self):
        with mock.patch.object(apply_run, '_keychain_token', return_value='keychain-test') as keychain:
            self.assertEqual(opened_notion(self, apply_run._stores, {}), ('keychain-test', None))
            self.assertEqual(opened_notion(self, apply_run._stores, {'NOTION_TOKEN': 'env-test'}), ('env-test', None))
        keychain.assert_called_once()   # only when the environment has none

    def test_a_test_run_never_reads_the_keychain(self):
        with mock.patch.object(sys, 'platform', 'darwin'), mock.patch.dict(os.environ, {'JOBADABRA_E2E': '1'}, clear=True), \
                mock.patch.object(apply_run.subprocess, 'run') as asked:
            self.assertEqual(apply_run._keychain_token(), '')
        asked.assert_not_called()


if __name__ == '__main__':
    unittest.main()
