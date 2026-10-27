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


if __name__ == '__main__':
    unittest.main()
