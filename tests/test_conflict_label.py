"""Guard for tools/conflict-label.mjs (the orange "Merge conflict" PR label): runs the node cases in tests/conflict_label_cases.mjs and checks the workflow's triggers."""
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class ConflictLabelTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'node missing')
    def test_node_cases_pass(self):
        done = subprocess.run(['node', '--test', str(ROOT / 'tests/conflict_label_cases.mjs')], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)

    def test_runs_when_main_or_a_pr_moves_and_never_runs_a_prs_code(self):
        # Owner, 30 Oct 2026: "let's add a GH label when the PR has conflicts". A conflict appears when main moves and goes when the PR is pushed.
        flow = (ROOT / '.github/workflows/conflict-label.yml').read_text()
        on = flow.split('\non:\n', 1)[1].split('\n\n', 1)[0]
        self.assertIn('push:\n    branches: [main]', on)
        self.assertIn('pull_request_target:\n    types: [opened, synchronize, reopened]', on)
        self.assertIn('ref: ${{ github.event.repository.default_branch }}', flow, "main's copy of the script, never the PR's")
        self.assertNotIn('concurrency:', flow, 'a cancelled run is drawn as a failed check')


if __name__ == '__main__':
    unittest.main()
