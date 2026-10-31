"""A new python test that reads the real clock fails here, in the python workflow (tools/unpinned-clock.mjs; owner, 31 Oct 2026: "No test reads the real date/clock unpinned").
The same check runs in desktop/test/unpinned-clock.test.js; this one exists because a PR that only changes tests/*.py does not start the desktop workflow (Gitar on #2734)."""
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class UnpinnedClockTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'node is needed to run the guard')
    def test_no_test_file_reads_the_real_clock_more_often_than_its_recorded_debt(self):
        done = subprocess.run(['node', 'tools/unpinned-clock.mjs', '--check'], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)


if __name__ == '__main__':
    unittest.main()
