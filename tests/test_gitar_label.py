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

    def test_a_comment_never_cancels_the_run_a_push_started(self):
        # Why (28 Oct 2026, #2393, #2400): one group for both events let Gitar's comment cancel the push's run; that run is the PR head's "label" check, so the PR list showed a red ✗ (8/9) on a green PR.
        text = (ROOT / '.github' / 'workflows' / 'gitar-label.yml').read_text()
        group = next(line for line in text.splitlines() if line.strip().startswith('group:'))
        self.assertIn('github.event_name', group, 'key the concurrency group by the event: a comment run must not cancel the head commit\'s check')


if __name__ == '__main__':
    unittest.main()
