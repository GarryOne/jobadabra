"""Guard for tools/area-circles.mjs (the circle counter behind .gitar/review/root-cause.md): runs the node cases in tests/area_circles_cases.mjs."""
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class AreaCirclesTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'node missing')
    def test_node_cases_pass(self):
        done = subprocess.run(['node', '--test', str(ROOT / 'tests/area_circles_cases.mjs')], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)


    @unittest.skipUnless(shutil.which('node') and shutil.which('git'), 'node or git missing')
    def test_a_count_that_could_not_run_says_skipped_never_zero(self):
        """Gitar on #2287: a failed count written as 7d=0 30d=0 would let a PR in a circle pass without its Design: block."""
        done = subprocess.run(['node', str(ROOT / 'tools/area-circles.mjs'), 'no-such-base-ref'], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(done.returncode, 0, 'never blocks a ship')
        self.assertRegex(done.stdout.strip().splitlines()[-1], r'^AREA-CIRCLES skipped \(')

if __name__ == '__main__':
    unittest.main()
