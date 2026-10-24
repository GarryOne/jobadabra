"""Lab CI from the public repo (owner, 24 Oct 2026): the lab's tests run in a PUBLIC Action, so its log must show counts only and nothing of the lab may leave the runner.
One test per promise: the workflow's shape, the summary parser, the status text, and that the lab tests run without the token."""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import lab_ci  # noqa: E402

WORKFLOW = (ROOT / '.github/workflows/lab-ci.yml').read_text()
RUNNER = (ROOT / 'tools/lab_ci.py').read_text()
OUTPUT = """FAIL: test_x (test_discovery.DiscoveryTests.test_x)
Traceback ... secret prompt text
----------------------------------------------------------------------
Ran 25 tests in 3.089s

FAILED (failures=1)"""


class LabCiTest(unittest.TestCase):
    def test_the_workflow_leaks_no_lab_content(self):
        for banned in ('upload-artifact', 'set -x', 'cat ', 'ls '):
            self.assertNotIn(banned, WORKFLOW)
        self.assertIn('persist-credentials: false', WORKFLOW)
        self.assertIn('repositories: jobadabra-lab', WORKFLOW)   # the new name: the old one answers 422
        self.assertIn('permission-statuses: write', WORKFLOW)

    def test_every_trigger_is_there(self):
        self.assertIn('workflow_dispatch', WORKFLOW)
        self.assertEqual(len(re.findall(r"- cron: '", WORKFLOW)), 2)   # the 20-minute sweep and the daily main run
        self.assertNotIn('pull_request', WORKFLOW)   # a lab PR cannot start it; a public PR must not run the lab

    def test_the_public_log_has_no_test_names_or_output(self):
        prints = re.findall(r'(?m)^\s*print\((.*)\)', RUNNER)
        for p in prints:
            self.assertNotIn('names', p.replace('len(names)', ''), p)   # only counts
            self.assertNotIn('output', p)
        self.assertIn('stdout=f', RUNNER)   # the test output goes to a file on the runner

    def test_the_tests_do_not_see_the_token(self):
        self.assertIn('env=clean', RUNNER)
        self.assertNotIn('LAB_TOKEN', RUNNER.split('SAFE_ENV')[1].split('\n')[0])

    def test_the_runner_has_what_the_lab_tests_need(self):
        """The first run (24 Oct 2026) ran 19 of 25: no `cryptography` (test_license failed to import) and no engine next to the lab (8 skipped)."""
        self.assertIn('cryptography==', WORKFLOW)
        self.assertIn('JOB_PILOTTO_PUBLIC: ${{ github.workspace }}', WORKFLOW)
        self.assertIn("'JOB_PILOTTO_PUBLIC'", RUNNER)

    def test_summary_and_status_text(self):
        ran, names = lab_ci.parse_summary(OUTPUT)
        self.assertEqual((ran, names), (25, ['test_x']))
        self.assertEqual(lab_ci.describe(ran, names, 1), ('failure', '1 of 25 failed: test_x'))
        self.assertEqual(lab_ci.describe(25, [], 0), ('success', '25 tests passed'))
        self.assertEqual(lab_ci.describe(0, [], 1)[0], 'failure')   # nothing ran is never green
        self.assertLessEqual(len(lab_ci.describe(25, ['t' * 60] * 5, 1)[1]), 140)

    def test_a_lab_pr_description_is_checked_here_and_reported_on_the_pr(self):
        """Owner, 24 Oct 2026: the lab's own workflow cannot start until 1 Nov (a red X on every lab PR), so lab-ci posts the `pr-description` status."""
        self.assertEqual(lab_ci.description_gap('[b9] Do it', 'Served why\n\nSome text.\n') != '', True)
        self.assertIn('session tag', lab_ci.description_gap('No tag here', '## x\n\n---\n\n### y\n'))
        self.assertEqual(lab_ci.description_gap('[b9] Do it', '## 🟢 x\n\n---\n\n### y\n'), '')
        self.assertEqual(lab_ci.DESCRIPTION, 'pr-description')

    def test_ship_asks_for_the_run_only_for_the_lab(self):
        ship = (ROOT / 'tools/ship-pr.sh').read_text()
        self.assertIn('lab-ci-dispatch.sh', ship)
        script = (ROOT / 'tools/lab-ci-dispatch.sh').read_text()
        self.assertIn('*/jobadabra-lab', script)
        self.assertIn('lab-ci.yml -R GarryOne/jobadabra', script)


if __name__ == '__main__':
    unittest.main()
