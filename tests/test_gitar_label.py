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


    def test_no_label_run_is_ever_cancelled(self):
        # 28 Oct 2026, owner's PR list: #2400 showed a red ✗ from a label run that a Gitar comment's run cancelled on the same head (cancel-in-progress).
        # Every run reads the live state, so overlapping runs agree; a cancelled one is drawn as a failed check.
        flow = (ROOT / '.github/workflows/gitar-label.yml').read_text()
        self.assertNotIn('concurrency:', flow, 'no group on the workflow or the label job: a group cancels a run, and the script converges instead')

if __name__ == '__main__':
    unittest.main()
