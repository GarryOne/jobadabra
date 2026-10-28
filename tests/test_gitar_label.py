"""Guard for tools/gitar-label.mjs (the PR-list label from Gitar's verdict): runs the node cases in tests/gitar_label_cases.mjs."""
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class GitarLabelTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'node missing')
    def test_node_cases_pass(self):
        done = subprocess.run(['node', '--test', str(ROOT / 'tests/gitar_label_cases.mjs')], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)


if __name__ == '__main__':
    unittest.main()
