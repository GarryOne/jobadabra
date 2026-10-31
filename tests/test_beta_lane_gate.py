# A beta never releases one lane alone, and a failed build says which lane and which step failed (beta 41226261602, recorded as job JSON).
import json
import unittest
from pathlib import Path

from tools import beta_lane_gate as gate
from tools import github_limit as limit

ROOT = Path(__file__).resolve().parents[1]
JOBS = json.loads((ROOT / 'tests/fixtures/beta_jobs_41226261602.json').read_text())['jobs']
MAC_STEP = 'Add to the release, and publish it (the first lane done publishes; the other adds its files to the published pre-release)'


class NamesTheFailedLane(unittest.TestCase):
    def test_the_recorded_beta_names_build_mac_and_its_step(self):
        # Mac failed at its last step, Windows built fine: the old run showed Release · Windows failing with "an E2E suite failed", and the Mac suites skipped without a word
        problems = gate.failed_builds(JOBS, {'Mac': 'failure', 'Windows': 'success'})
        self.assertEqual(problems, [f'Build · Mac failed at the step "{MAC_STEP}"'])

    def test_two_failed_builds_are_both_named(self):
        jobs = JOBS + [{'name': 'Build · Windows', 'conclusion': 'failure', 'steps': [{'name': 'Package', 'conclusion': 'failure', 'number': 9}]}]
        jobs = [job for job in jobs if not (job['name'] == 'Build · Windows' and job['conclusion'] == 'success')]
        problems = gate.failed_builds(jobs, {'Mac': 'failure', 'Windows': 'failure'})
        self.assertEqual(len(problems), 2)
        self.assertIn('Build · Windows failed at the step "Package"', problems[1])

    def test_a_cancelled_or_skipped_build_is_named_by_its_result(self):
        self.assertEqual(gate.failed_builds([], {'Mac': 'cancelled', 'Windows': 'success'}), ['Build · Mac ended cancelled'])

    def test_both_builds_green_is_no_problem(self):
        self.assertEqual(gate.failed_builds(JOBS, {'Mac': 'success', 'Windows': 'success'}), [])


class MainReadsJobsOnlyWhenABuildFailed(unittest.TestCase):
    def test_green_builds_cost_no_call_and_print_nothing(self):
        calls = []
        done = gate.main(['--mac', 'success', '--windows', 'success'], jobs=lambda: calls.append(1) or JOBS, out=calls.append)
        self.assertEqual((done, calls), (0, []))

    def test_a_failed_build_fails_the_job_with_the_named_step(self):
        lines = []
        done = gate.main(['--mac', 'failure', '--windows', 'success'], jobs=lambda: JOBS, out=lines.append)
        self.assertEqual(done, 1)
        text = '\n'.join(lines)
        self.assertIn('::error::The beta was not released: Build · Mac failed at the step "Add to the release', text)
        self.assertIn('Both platforms wait for both builds', text)
        self.assertNotIn('Windows failed', text)

    def test_a_limit_while_reading_the_jobs_is_said_not_hidden(self):
        def refused():
            raise limit.GitHubLimit('GitHub API rate limit (403 … for installation), reset at 18:30:12 UTC')
        lines = []
        done = gate.main(['--mac', 'failure', '--windows', 'success'], jobs=refused, out=lines.append)
        self.assertEqual(done, 1)
        self.assertIn('::error::The beta was not released: Build · Mac ended failure', '\n'.join(lines))
        self.assertIn('GitHub API rate limit (403 … for installation), reset at 18:30:12 UTC', '\n'.join(lines))


if __name__ == '__main__':
    unittest.main()
