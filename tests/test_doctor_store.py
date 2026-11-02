"""The readiness check reads the active store (src/stores), so its data checks work on Notion and on this Mac alike: "Your data"
says whether the store can be read, and "Kits ready" finds a drafted kit in the store (9 Oct 2026: it handed a Notion client to
apply_batch.ready_jobs, which reads stores since 6a5baf2, so the line said "could not check" for every user)."""
from datetime import datetime, timezone
import tempfile
import unittest
from unittest import mock

from src import doctor
from src.doctor import FAIL, OK
from src.stores import base, memory, sqlite

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
KIT = '## 📝 Application kit\n\nCover letter…\n\n### Machine-readable kit\n\n```json\n{"cover_letter": "Dear team"}\n```\n'


def store_with_a_kit():
    stores = memory.open_store()
    job = stores.applications.create({'url': 'https://jobs.example.com/1', 'title': 'SRE', 'company': 'Acme'}, 'Kit ready')
    stores.applications.set_section(job['id'], base.KIT_SECTION, KIT)
    return stores


class StoreChecks(unittest.TestCase):
    def setUp(self):
        for target in (mock.patch('src.sources.google.credentials', return_value=None), mock.patch('src.ai.budget.admin_key', return_value=None)):
            target.start()
            self.addCleanup(target.stop)

    def test_kits_ready_counts_the_kits_in_the_store(self):
        check = doctor.check_kits(store_with_a_kit())
        self.assertEqual((check.state, check.detail), (OK, '1 job(s) ready to apply'))

    def test_your_data_is_read_or_named_as_unreadable(self):
        stores = memory.open_store()
        self.assertEqual(doctor.check_store(stores).state, OK)
        with mock.patch.object(stores.matches, 'list', side_effect=OSError('disk')):
            check = doctor.check_store(stores)
        self.assertEqual((check.state, check.detail), (FAIL, 'memory: matches could not be read (OSError)'))

    def test_without_notion_the_data_checks_run_on_this_macs_store(self):
        with mock.patch.object(doctor, 'gh', return_value=None):
            checks = {c.name: c for c in doctor.run_checks(None, NOW, stores=store_with_a_kit())}
        self.assertEqual(checks['Notion'].state, 'info')
        self.assertEqual(checks['Your data'].state, OK)
        self.assertEqual(checks['Kits ready'].state, OK)
        self.assertEqual(checks['Scored jobs'].state, FAIL)   # none yet: a real answer, not "could not check"
        self.assertNotIn('could not check', ' '.join(c.detail for c in checks.values()))

    def test_a_store_on_this_mac_is_read_from_the_thread_that_opened_it(self):
        """9 Oct 2026, the first real run: the data checks ran in a thread pool and SQLite refused every one ("could not check")."""
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(doctor, 'gh', return_value=None):
            checks = doctor.run_checks(None, NOW, stores=sqlite.open_store({'JOBADABRA_DATA_DIR': folder}))
        self.assertEqual([c.detail for c in checks if 'could not check' in c.detail], [])
        self.assertIn('Kits ready', {c.name for c in checks})

    def test_without_any_store_only_the_local_checks_run(self):
        with mock.patch.object(doctor, 'gh', return_value=None):
            names = {c.name for c in doctor.run_checks(None, NOW)}
        self.assertNotIn('Your data', names)
        self.assertNotIn('Kits ready', names)


if __name__ == '__main__':
    unittest.main()
