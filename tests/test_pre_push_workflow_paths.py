"""Every workflow that runs `tools/replay-files.mjs --check <name>` has the same check in the push hook, so a new file the workflow loads cannot open a red PR (20 Oct 2026, #1638)."""
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
listed = lambda: subprocess.run(['node', 'tools/replay-files.mjs', '--workflows'], cwd=ROOT, capture_output=True, text=True, check=True, timeout=60).stdout.split()


class PushHookWorkflowPaths(unittest.TestCase):
    def test_the_hook_checks_every_workflow_that_checks_its_own_paths(self):
        names = set()
        for workflow in (ROOT / '.github' / 'workflows').glob('*.yml'):
            names.update(re.findall(r'replay-files\.mjs --check ([\w.-]+\.yml)', workflow.read_text(encoding='utf8')))
        self.assertTrue(names, 'no workflow runs the paths check any more: update this test')
        hook = (ROOT / 'tools' / 'pre-push-check.sh').read_text(encoding='utf8')
        # The hook loops over replay-files.mjs --workflows (WORKFLOW_JOB), never a list of its own (26 Oct 2026: its own list kept control-tests.yml after it left PRs)
        self.assertIn('for wf in $(cd "$repo" && node tools/replay-files.mjs --workflows); do', hook)
        self.assertNotRegex(hook, r'for wf in [\w.-]+\.yml')
        self.assertEqual(set(listed()), names, 'WORKFLOW_JOB must hold exactly the workflows that run the paths check')

    def test_the_checks_pass_on_this_checkout(self):
        for name in listed():
            done = subprocess.run(['node', 'tools/replay-files.mjs', '--check', name], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(done.returncode, 0, done.stdout + done.stderr)


if __name__ == '__main__':
    unittest.main()
