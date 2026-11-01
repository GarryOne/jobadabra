# A failed build in either lane blocks the beta by name, and a spent GitHub budget is said, not hidden (beta 41226261602).
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT = (ROOT / '.github/workflows/desktop.yml').read_text()


def job(name):
    return TEXT.split(f'\n  {name}:\n')[1].split('\n  # ')[0].split('\n  prune:')[0]


class FailedLane(unittest.TestCase):
    def test_gate_ran_also_fires_on_a_failed_build_and_names_it(self):
        gate = job('gate-ran')
        condition = re.search(r'    if: (.+)', gate).group(1)
        self.assertIn("needs.build.result == 'failure'", condition)
        self.assertIn("needs.windows.result == 'failure'", condition)
        self.assertIn('tools/beta_lane_gate.py --mac "${{ needs.build.result }}" --windows "${{ needs.windows.result }}"', gate)
        self.assertIn('uses: actions/checkout@v5', gate)   # the tool is in the repo
        self.assertIn('did not run: no build was tested', gate)   # the old case still reports itself

    def test_each_release_job_checks_both_builds_before_anything_else_runs(self):
        for lane in ('release-mac', 'release-windows'):
            release = job(lane)
            check = release.index('tools/beta_lane_gate.py')
            self.assertIn('--mac "${{ needs.build.result }}" --windows "${{ needs.windows.result }}"', release, lane)
            self.assertLess(check, release.index('beta_rate_gate.py'), lane)
            self.assertLess(check, release.index('npm ci'), lane)
            self.assertIn('needs: [changes, build, windows, test-mac, test-windows]', release, lane)


class RateLimitIsSaid(unittest.TestCase):
    def test_both_release_uploads_say_a_spent_budget(self):
        uploads = re.findall(r'^ +gh release upload .*$', TEXT, re.M)
        self.assertEqual(len(uploads), 5)   # Mac, Windows, their two unit-<lane>.json outcomes (4/5a, --clobber so a re-run replaces it), and the last working Windows installer carried forward
        carried = [line for line in uploads if '--clobber' in line]
        for line in uploads:
            if line not in carried:
                self.assertIn('github_limit.py" explain "gh release upload"', line)

    def test_a_rate_limited_403_does_not_start_a_new_build_of_main(self):
        # a new build would only spend more of the budget that is gone
        self.assertIn("grep -q 'HTTP 403' release-error.txt && ! grep -qi 'rate limit' release-error.txt", TEXT)


if __name__ == '__main__':
    unittest.main()
