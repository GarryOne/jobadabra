"""worker.yml: the Worker has its own deploy pipeline, triggered only when the Worker changes, tested first, and separate from the desktop release run (owner, 10 Oct 2026)."""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKER = (ROOT / '.github/workflows/worker.yml').read_text()
DESKTOP = (ROOT / '.github/workflows/desktop.yml').read_text()


class WorkerWorkflowTests(unittest.TestCase):
    def test_it_runs_only_when_the_worker_changes_and_not_for_its_own_file(self):
        triggers = WORKER.split('permissions:')[0]
        paths = re.findall(r"^\s+- '([^']+)'", triggers, re.M)
        self.assertTrue(paths and all(path.startswith(('app-core/', 'worker/')) for path in paths), paths)
        self.assertNotIn('.github/workflows/worker.yml', paths)   # changing the pipeline must not deploy
        self.assertIn('workflow_dispatch:', triggers)

    def test_it_tests_before_it_deploys(self):
        self.assertLess(WORKER.index('npm test'), WORKER.index('npm run deploy'))

    def test_the_desktop_release_run_neither_deploys_nor_tests_the_worker_or_the_site(self):
        code = re.sub(r'#.*', '', DESKTOP)   # (it still WATCHES app-core/src for "anything new": the app bundles that code for each user's own bot)
        for word in ('wrangler', '--area worker', '--area site', 'cd worker', 'cd app-core', 'cd site'):
            self.assertNotIn(word, code, f'desktop.yml uses {word}')


if __name__ == '__main__':
    unittest.main()
