"""Guard for the PR checks the whole org shares (owner, 2 Nov 2026: "they should have the same PR Body, the same GH labels... the same workflow").
.github/workflows/pr-body-check.yml is the ONE reusable PR-description check; templates/org-repo/pr-checks.yml is the caller every repo gets.
Why (2 Nov 2026, web#307): a workflow that checks out a few files from this repo and runs one of them failed on every web PR because a file it imports was not in the list, and no PR run
could show it (those workflows run from main). So the test runs the script on ONLY the files the workflow fetches, and rejects a sparse entry that is not a plain path."""
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REUSABLE = (ROOT / '.github/workflows/pr-body-check.yml').read_text()
CALLER = (ROOT / 'templates/org-repo/pr-checks.yml').read_text()

GOOD_BODY = """## 🟢 A change

---

### Impact
| Area | Impact |
|---|---|
| Users | none |
"""


def sparse_list(flow):
    block = flow.split('sparse-checkout: |\n', 1)[1].split('\n          sparse-checkout-cone-mode', 1)[0]
    return [line.strip() for line in block.split('\n') if line.strip()]


class ReusableBodyCheck(unittest.TestCase):
    def test_it_is_callable_and_reads_the_script_from_mains_files_never_the_prs_code(self):
        self.assertIn('on:\n  workflow_call:', REUSABLE)
        self.assertIn('repository: jobadabra/jobadabra\n', REUSABLE)
        self.assertRegex(REUSABLE, r'\n {10}ref: main\n')
        self.assertIn('sparse-checkout-cone-mode: false', REUSABLE, 'file patterns: cone mode reads every entry as a folder')
        self.assertNotRegex(REUSABLE, r'head\.(sha|ref)|github\.head_ref', "a PR's code is never checked out")
        self.assertIn('BODY: ${{ github.event.pull_request.body }}', REUSABLE)

    def test_every_sparse_entry_is_a_plain_path(self):
        for entry in sparse_list(REUSABLE):
            self.assertNotRegex(entry, r'[#\s]', f'{entry}: a YAML block scalar has no comments, so a # or a space would be part of the pattern (web#307)')

    def test_the_check_runs_on_exactly_the_files_the_workflow_fetches(self):
        files = sparse_list(REUSABLE)
        self.assertIn('tools/pr-body-check.py', files)
        with tempfile.TemporaryDirectory() as folder:
            for name in files:
                (Path(folder) / name).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(ROOT / name, Path(folder) / name)
            run = lambda body, title='[go] A thing': subprocess.run(['python3', '-I', 'tools/pr-body-check.py'], input=body, capture_output=True, text=True, cwd=folder,
                                                                    env={'PR_TITLE': title, 'PATH': '/usr/bin:/bin'})
            good = run(GOOD_BODY)
            self.assertEqual(good.returncode, 0, good.stdout + good.stderr)
            bad = run('just a summary')
            self.assertEqual(bad.returncode, 1, 'a raw body is refused (and the script did not crash on a missing import)')
            self.assertIn('pr-description:', bad.stderr)
            self.assertNotIn('Traceback', bad.stderr)


class CallerTemplate(unittest.TestCase):
    def test_it_calls_the_shared_check_and_ends_in_the_one_required_status(self):
        self.assertIn('uses: jobadabra/jobadabra/.github/workflows/pr-body-check.yml@main', CALLER)
        self.assertIn('name: All checks passed', CALLER, 'the one status a ruleset requires')
        needs = re.search(r'\n {4}needs: \[([^\]]*)\]', CALLER)
        self.assertIsNotNone(needs)
        self.assertIn('body', needs.group(1))
        self.assertNotIn('concurrency:', CALLER, 'a cancelled run is drawn as a red ✗ (jobadabra#2400)')
        self.assertIn('types: [opened, synchronize, reopened, edited]', CALLER, 'fixing the description re-runs the check')
        self.assertIn('if: ${{ always() }}', CALLER, 'a failed need must make the verdict red, never skipped (a skipped required job reads as green)')


if __name__ == '__main__':
    unittest.main()
