from datetime import datetime, timezone
import unittest
from unittest import mock

from src import doctor
from src.doctor import FAIL, INFO, OK, WARN, Check
from src.stores import memory

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)


class FakeTracker:
    database_id = 'apps'

    def __init__(self, rows=None, fail=False):
        self.rows, self.fail = rows or {}, fail

    def _request(self, method, path, body=None):
        if self.fail:
            raise RuntimeError('401')
        return {}

    def query_database(self, database_id, filter_=None):
        return self.rows.get(database_id, [])


_patches = []


def setUpModule():
    # Never reach the real Google account or Anthropic Admin API from these tests.
    for target in (mock.patch('src.sources.google.credentials', return_value=None),
                   mock.patch('src.ai.budget.admin_key', return_value=None)):
        _patches.append(target)
        target.start()


def tearDownModule():
    for target in _patches:
        target.stop()


class NextStepTest(unittest.TestCase):
    def test_first_failure_wins_over_earlier_warning(self):
        checks = [Check('Setup', 'Answers', WARN, 'empty', 'fill answers'),
                  Check('Data', 'Last crawl', FAIL, 'none', 'run a crawl')]
        self.assertEqual(doctor.next_step(checks), 'Last crawl: run a crawl')

    def test_warning_when_nothing_fails(self):
        checks = [Check('Setup', 'Notion', OK, 'ok'), Check('Apply', 'Kits ready', WARN, 'none', 'prepare-top')]
        self.assertEqual(doctor.next_step(checks), 'Kits ready: prepare-top')

    def test_all_set_suggests_applying(self):
        self.assertIn('apply-batch-claude.sh', doctor.next_step([Check('Setup', 'Notion', OK, 'ok')]))

    def test_render_groups_by_area(self):
        text = doctor.render([Check('Setup', 'Notion', OK, 'connected'), Check('Data', 'Sources', INFO, '3')])
        self.assertTrue(text.startswith('Setup\n  ✅ Notion: connected'))
        self.assertIn('\nData\n', text)
        self.assertIn('👉 Next step', text)


class ChecksTest(unittest.TestCase):
    def test_fresh_setup_is_not_a_failure(self):
        # A new developer with no keys: Notion and the extras are optional, so nothing fails.
        with mock.patch.object(doctor, 'gh', return_value=None), \
             mock.patch.object(doctor.apply_batch, 'DEFAULT_CV', '/nonexistent/cv.pdf'), \
             mock.patch.dict(doctor.os.environ, {}, clear=True):
            checks = doctor.run_checks(None, NOW)
        names = {c.name: c.state for c in checks}
        self.assertEqual(names['Notion'], INFO)
        self.assertEqual(names['CV file'], INFO)
        self.assertNotIn('Profile', names)
        self.assertNotIn(FAIL, names.values())
        self.assertIn('python3 -m src daily', doctor.next_step(checks))

    def test_rejected_token(self):
        self.assertEqual(doctor.check_notion(FakeTracker(fail=True)).state, FAIL)
        self.assertEqual(doctor.check_notion(FakeTracker(fail=True), 'notion').state, FAIL)

    def test_notion_is_checked_only_when_it_holds_the_data(self):
        # A token left from before a move to this Mac: Notion is not asked, and its state never fails the checklist.
        line = doctor.check_notion(FakeTracker(fail=True), 'sqlite')
        self.assertEqual((line.state, line.fix), (INFO, ''))
        self.assertIn('this Mac', line.detail)
        with mock.patch.dict(doctor.os.environ, {'JOB_PILOTTO_STORE': 'sqlite', 'NOTION_TOKEN': 'secret_x'}), \
                mock.patch.object(doctor.notion, 'Tracker', side_effect=AssertionError('no Notion client on this Mac\'s store')), \
                mock.patch.object(doctor, 'active_store', return_value=memory.open_store()) as opened, \
                mock.patch.object(doctor, 'run_checks', return_value=[]) as ran, mock.patch('sys.argv', ['doctor', '--json']), \
                mock.patch('builtins.print'):
            doctor.main()
        self.assertEqual((opened.call_args.args, ran.call_args.args), ((None,), (None,)))
        with mock.patch.dict(doctor.os.environ, {'NOTION_TOKEN': 'secret_x'}), mock.patch.object(doctor.notion, 'Tracker') as made, \
                mock.patch.object(doctor, 'active_store', return_value=memory.open_store()), \
                mock.patch.object(doctor, 'run_checks', return_value=[]) as ran, mock.patch('sys.argv', ['doctor', '--json']), \
                mock.patch('builtins.print'):
            doctor.main()
        self.assertIs(ran.call_args.args[0], made.return_value, 'Notion holds the data: checked as today')

    def test_last_crawl_states(self):
        stores = memory.open_store()
        cases = [([], FAIL), ([{'status': 'completed', 'conclusion': 'failure', 'createdAt': '2026-09-26T10:00:00Z'}], FAIL),
                 ([{'status': 'completed', 'conclusion': 'success', 'createdAt': '2026-09-25T20:00:00Z'}], WARN),
                 ([{'status': 'completed', 'conclusion': 'success', 'createdAt': '2026-09-26T10:00:00Z'}], OK)]
        for runs, state in cases:
            with mock.patch.object(doctor, 'gh', return_value=runs):
                self.assertEqual(doctor.check_last_crawl(stores, NOW).state, state, runs)
        with mock.patch.object(doctor, 'gh', return_value=None):
            self.assertEqual(doctor.check_last_crawl(stores, NOW).state, INFO)

    def test_last_crawl_shows_latest_run_summary(self):
        stores = memory.open_store()
        for started, summary in (('2026-09-26T08:00:00+00:00', 'older'), ('2026-09-26T10:00:00+00:00', '3 new jobs')):
            stores.cron_runs.put({'kind': 'search', 'where': 'github', 'status': 'Done', 'started_at': started, 'summary': summary})
        with mock.patch.object(doctor, 'gh', return_value=[
                {'status': 'completed', 'conclusion': 'success', 'createdAt': '2026-09-26T10:00:00Z'}]):
            self.assertEqual(doctor.check_last_crawl(stores, NOW).detail, '2.0 h ago — 3 new jobs')

    def test_features_line_lists_on_off_and_switched_off(self):
        env = {'NOTION_TOKEN': 'set', 'TELEGRAM_BOT_TOKEN': 'set', 'TELEGRAM_CHAT_ID': 'set',
               'SERPAPI_API_KEY': 'set', 'JOB_PILOTTO_DISABLE': 'google_jobs'}
        check = doctor.check_features(env)
        self.assertEqual(check.state, OK)
        self.assertIn('on: discover, telegram, notion, scout', check.detail)
        self.assertIn('not set up: enrich', check.detail)
        self.assertIn('switched off: google_jobs', check.detail)
        self.assertIn('parked: job_alerts', doctor.check_features({'GOOGLE_REFRESH_TOKEN': 'set', 'ANTHROPIC_API_KEY': 'set'}).detail)
        self.assertEqual(doctor.check_features({'JOB_PILOTTO_DISABLE': 'all'}).state, INFO)

    def test_no_kits_points_to_prepare_top(self):
        with mock.patch.object(doctor.apply_batch, 'ready_jobs', return_value=[]):
            check = doctor.check_kits(memory.open_store())
        self.assertEqual(check.state, WARN)
        self.assertIn('prepare-top.sh', check.fix)

    def test_no_open_matches_fails(self):
        self.assertEqual(doctor.check_matches(memory.open_store()).state, FAIL)

    def test_a_crashing_check_becomes_a_warning(self):
        def boom():
            raise ValueError('bad json')
        check = doctor._safe(boom)
        self.assertEqual(check.state, WARN)
        self.assertIn('bad json', check.detail)


if __name__ == '__main__':
    unittest.main()


class WorkspaceRepoCheckTests(unittest.TestCase):
    """The GitHub checks ask about the repository that runs the pipeline — the user's private workspace repo — not
    the engine checkout. Otherwise a healthy cloud setup reads as "no scheduled crawl has finished yet" and "last
    mail check failure", while the real failures elsewhere stay invisible (1 Oct 2026)."""

    def calls(self, fn, *args):
        seen = []
        with mock.patch.object(doctor, 'gh', side_effect=lambda *a: seen.append(a) or []), \
                mock.patch.object(doctor, 'repo_args', lambda: ['-R', 'GarryOne/job-pilotto-private']):
            fn(*args)
        return seen

    def test_every_github_check_names_the_workspace_repo(self):
        from src.sources import google
        for fn, args in ((doctor.check_workflow, ()), (doctor.check_last_crawl, (memory.open_store(), NOW)),
                         (doctor.check_mail_workflow, (NOW,))):
            with mock.patch.object(google.Google, 'from_env', return_value=object()):  # Gmail connected
                seen = self.calls(fn, *args)
            self.assertTrue(seen, fn.__name__)
            self.assertIn('-R', seen[0], fn.__name__)
            self.assertIn('GarryOne/job-pilotto-private', seen[0], fn.__name__)

    def test_no_repo_configured_asks_about_this_checkout(self):
        seen = []
        with mock.patch.object(doctor, 'gh', side_effect=lambda *a: seen.append(a) or []), \
                mock.patch.object(doctor, 'repo_args', lambda: []):
            doctor.check_workflow()
            doctor.check_last_crawl(memory.open_store(), NOW)
        self.assertTrue(all('-R' not in call for call in seen), seen)
