"""Every test that runs the heavy lock starts from an environment without the CI runner's JOBADABRA_HEAVY=0 (build.yml sets it on main): with it the lock runs the command at once and logs nothing
(16 Oct 2026: test_ship_timeline's heavy-line test failed only on the first main run that finished, 1589e67 had added the variable a day earlier)."""
import re
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
STRIPS = re.compile(r"startswith\(\('JOBADABRA_HEAVY', 'JP_HEAVY'|heavy_lock_fixture")   # the strip itself, or the shared fixture that does it


class HeavyEnvPinnedTest(unittest.TestCase):
    def test_every_test_that_points_the_lock_at_its_own_dir_strips_the_runner_variables(self):
        users = [path for path in sorted(TESTS.glob('*.py')) if "'JOBADABRA_HEAVY_DIR'" in path.read_text() and path.name != Path(__file__).name]
        self.assertTrue(users, 'the scan found no lock test: the pattern is stale')
        for path in users:
            self.assertRegex(path.read_text(), STRIPS, f'{path.name} builds the lock\'s environment from os.environ without dropping JOBADABRA_HEAVY* / JP_HEAVY*')


if __name__ == '__main__':
    unittest.main()
