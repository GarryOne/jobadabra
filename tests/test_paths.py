import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import paths


class DotenvTests(unittest.TestCase):
    def setUp(self):
        self.saved_root = paths.ROOT
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: paths.__setattr__('ROOT', self.saved_root))
        self.addCleanup(os.environ.pop, 'JOBADABRA_TEST_VAR', None)
        self.addCleanup(os.environ.pop, 'JOBADABRA_TEST_EXISTING', None)

    def test_loads_unset_vars_without_overriding_existing_ones(self):
        (self.tmp / '.env').write_text(
            '# a comment\n'
            '\n'
            'JOBADABRA_TEST_VAR=hello world\n'
            'JOBADABRA_TEST_EXISTING=from-dotenv\n'
            'export JOBADABRA_TEST_QUOTED="quoted value"\n'
        )
        os.environ['JOBADABRA_TEST_EXISTING'] = 'from-shell'
        paths.ROOT = self.tmp
        paths._load_dotenv()
        self.assertEqual(os.environ['JOBADABRA_TEST_VAR'], 'hello world')
        self.assertEqual(os.environ['JOBADABRA_TEST_EXISTING'], 'from-shell')
        self.assertEqual(os.environ.pop('JOBADABRA_TEST_QUOTED'), 'quoted value')

    def test_missing_env_file_is_a_no_op(self):
        paths.ROOT = self.tmp  # no .env written here
        paths._load_dotenv()  # must not raise


if __name__ == '__main__':
    unittest.main()


class WorkspaceRepoTests(unittest.TestCase):
    """Which repository holds the workspace: the schedules and Gmail checks run there, never in the engine
    checkout that happens to be on disk (1 Oct 2026: the watcher dispatched mail.yml in the engine repo, which
    has no NOTION_* variables, so every submitted application queued a run that could only fail)."""

    def setUp(self):
        self.saved = os.environ.pop('JOBADABRA_CLOUD_REPO', None)
        self.addCleanup(lambda: os.environ.pop('JOBADABRA_CLOUD_REPO', None))
        if self.saved:
            self.addCleanup(os.environ.__setitem__, 'JOBADABRA_CLOUD_REPO', self.saved)
        self.tmp = Path(tempfile.mkdtemp())

    def test_from_the_environment_first(self):
        os.environ['JOBADABRA_CLOUD_REPO'] = 'someone/workspace'
        self.assertEqual(paths.workspace_repo(self.tmp), 'someone/workspace')  # even with no settings file

    def test_from_the_desktop_apps_settings(self):
        (self.tmp / 'settings.json').write_text('{"setupDone": true, "cloud": {"repo": "GarryOne/job-pilotto-private"}}')
        self.assertEqual(paths.workspace_repo(self.tmp), 'GarryOne/job-pilotto-private')

    def test_empty_without_a_workspace_or_settings(self):
        self.assertEqual(paths.workspace_repo(self.tmp), '')
        (self.tmp / 'settings.json').write_text('{"setupDone": true}')
        self.assertEqual(paths.workspace_repo(self.tmp), '')
        (self.tmp / 'settings.json').write_text('not json')
        self.assertEqual(paths.workspace_repo(self.tmp), '')
