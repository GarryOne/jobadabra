"""Fake Notion IDs for the whole suite. The code has no built-in IDs (each user's come from their
environment: the Desktop App, .env or repository variables), and modules copy them at import, so
they're set here: unittest discovery loads this file first (sorted names), before anything imports src."""
import os
import sys
import tempfile
import unittest

if sys.platform == 'win32':
    # Windows cannot delete a file something still holds open, and many tests leave a SQLite connection open inside their temp folder (`with tempfile.TemporaryDirectory()
    # as tmp, connect(tmp / 'jobs.sqlite') as db:` commits at the end of the with but never closes): 122 PermissionError [WinError 32] on the first Windows run (10 Oct 2026).
    # A leftover temp folder on a throwaway runner is harmless, so cleanup errors are ignored there; every shard loads this file first.
    _init = tempfile.TemporaryDirectory.__init__

    def _lenient_init(self, suffix=None, prefix=None, dir=None, ignore_cleanup_errors=True, **kwargs):
        _init(self, suffix, prefix, dir, ignore_cleanup_errors, **kwargs)
    tempfile.TemporaryDirectory.__init__ = _lenient_init

if os.environ.get('JOB_PILOTTO_AUDIT_CHECKOUT_DATA'):   # set by tools/py-shards.py: the test that writes into the checkout's data/ fails by name
    import checkout_data_audit
    checkout_data_audit.install(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

IDS = {name: f'test-{name.lower().replace("_", "-")}' for name in (
    'NOTION_APPLICATIONS_DB', 'NOTION_MATCHES_DB', 'NOTION_EVENTS_DB', 'NOTION_INSIGHTS_DB',
    'NOTION_INTERVIEWS_DB', 'NOTION_EMPLOYERS_DB', 'NOTION_AGENT_RUNS_DB', 'NOTION_CRON_RUNS_DB',
    'NOTION_PROFILE_PAGE_ID', 'NOTION_ANSWERS_PAGE_ID', 'NOTION_PIPELINE_PAGE')}
for name, value in IDS.items():
    os.environ[name] = value
# The employer index download must never leave the machine in tests: a refused connection means "use the starter list".
os.environ.setdefault('JOB_PILOTTO_INDEX_URL', 'http://127.0.0.1:9/api/index')


class NotionIdTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'win32', 'Windows only')
    def test_windows_ignores_temp_folder_cleanup_errors(self):
        with tempfile.TemporaryDirectory() as folder:
            pass
        self.assertTrue(tempfile.TemporaryDirectory()._ignore_cleanup_errors)


    def test_every_database_and_page_has_its_own_id(self):
        from src.notion import client, ledger
        self.assertEqual(len(set(IDS.values())), len(IDS))
        self.assertNotEqual(client.PROFILE_PAGE_ID, ledger.EVENTS_DATABASE_ID)
