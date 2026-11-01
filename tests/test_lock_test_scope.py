"""The lock tests run on a PR only when it touches the lock or what they test (owner, 12 Oct 2026: ~150 s of every PR's python check and the day's top flake, on PRs that never touched the lock).
tools/py-shards.py leaves the lock family out when JOBADABRA_PY_CHANGED_FILE lists the PR's changed files and none is a lock path; a push to main (no list) runs everything.
The guard: every tools/ file a lock test names is a lock path, so a change to it always runs them."""
import importlib.util
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('py_shards', ROOT / 'tools/py-shards.py')
shards = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shards)


class LockTestScope(unittest.TestCase):
    def test_the_family_is_every_heavy_lock_module_and_the_queue_and_slot_tests(self):
        family = [m for m in shards.all_modules() if shards.is_lock_module(m)]
        for name in ('test_heavy_lock', 'test_heavy_lock_budget', 'test_red_fix_first', 'test_landing_lock', 'test_check_slot'):
            self.assertIn(name, family)
        self.assertNotIn('test_ship', family, 'the landing tool\'s own tests always run')

    def test_a_change_to_the_lock_or_its_tests_runs_them_and_any_other_change_does_not(self):
        for path in ('tools/heavy-lock.sh', 'tools/heavy-lock-memory.sh', 'tools/check-slot.sh', 'tools/landing-lock.sh', 'tools/ship.sh', 'desktop/e2e/lib/heavy.mjs',
                     'tests/test_heavy_lock_yield.py', 'tests/heavy_wait.py', 'tools/py-shards.py'):
            self.assertTrue(shards.lock_tests_needed([path]), path)
        for path in ('src/daily.py', 'desktop/renderer/pages/activity.js', 'tests/test_daily.py', '.github/workflows/build.yml'):
            self.assertFalse(shards.lock_tests_needed([path]), path)
        self.assertTrue(shards.lock_tests_needed(['src/daily.py', 'tools/heavy-lock.sh']))

    def test_every_tools_file_a_lock_test_names_is_a_lock_path(self):
        # a lock test that starts using another tool: changing that tool must run it (this fails until the tool is in LOCK_PATHS)
        files = [ROOT / 'tests' / f'{m}.py' for m in shards.all_modules() if shards.is_lock_module(m)]
        files += [ROOT / 'tests' / n for n in ('heavy_wait.py', 'heavy_lock_fixture.py', 'ship_fixture.py')]
        named = set()
        for path in files:
            for name in re.findall(r'[\'"/]([\w.-]+\.(?:sh|py|mjs))[\'"]', path.read_text()):
                if (ROOT / 'tools' / name).is_file():
                    named.add(f'tools/{name}')
        self.assertTrue(named)
        self.assertEqual(sorted(p for p in named if not shards.lock_tests_needed([p])), [])

    def run_shards(self, changed):
        with tempfile.TemporaryDirectory() as d:
            listing = Path(d) / 'changed.txt'
            listing.write_text(''.join(f'{p}\n' for p in changed))
            env = {**os.environ, 'JOBADABRA_PY_CHANGED_FILE': listing.as_posix(), 'JOBADABRA_PY_DRY_RUN': '1'}
            return subprocess.run([sys.executable, str(ROOT / 'tools/py-shards.py')], env=env, capture_output=True, text=True, timeout=60).stdout

    def test_a_pr_that_touches_no_lock_path_leaves_the_family_out_and_says_so(self):
        out = self.run_shards(['src/daily.py'])
        self.assertIn('lock tests left out: this change touches no lock path', out)
        self.assertNotIn('test_heavy_lock_budget', out.split('modules:')[-1])
        self.assertIn('test_heavy_lock_budget', self.run_shards(['tools/heavy-lock.sh']))

    def test_no_list_or_an_empty_one_runs_everything(self):
        self.assertTrue(shards.lock_tests_needed(None))
        self.assertTrue(shards.lock_tests_needed([]))   # a diff that could not be read is never a reason to skip

    def test_the_pr_job_passes_the_changed_files(self):
        python = (ROOT / '.github/workflows/tests-python.yml').read_text()   # the PR's python suite (14 Oct 2026: build.yml runs on main and calls it)
        self.assertIn('JOBADABRA_PY_CHANGED_FILE', python)
        self.assertIn('github.event.pull_request.base.sha', python)
        self.assertIn('fetch-depth: 0', python)


if __name__ == '__main__':
    unittest.main()
