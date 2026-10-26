"""Every lane of e2e suites is followed by ONE screenshot review of all its pages (.github/actions/e2e-review), never a review inside a suite job.

Owner, 26 Oct 2026: "I want to cut the costs in half, but to be close to the same quality as Claude". Claude's Message Batches are half the price for the same
model, but a batch needs 20+ pages, and each suite job reviewed only its own 1-10 pages: "0 by batch" in every run. A new lane (or a new suite job) that uploads
screenshots without the review job after it would leave its pages unreviewed; one that reviews inside the suite would pay full price again.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / '.github' / 'workflows'
ACTION = ROOT / '.github' / 'actions' / 'e2e-review' / 'action.yml'


def jobs(text):
    """{job name: its text} under `jobs:` (two-space job keys)."""
    body = text.split('\njobs:\n', 1)[-1]
    parts = re.split(r'(?m)^  ([A-Za-z0-9_-]+):\s*$', body)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts) - 1, 2)}


def needs(job):
    found = re.search(r'(?m)^    needs: \[?([^\]\n]+)\]?', job)
    return [item.strip() for item in found.group(1).split(',')] if found else []


class EveryLaneHasTheBatchReview(unittest.TestCase):
    def test_every_suite_job_that_uploads_screenshots_is_reviewed_after_by_its_lane(self):
        lanes = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            all_jobs = jobs(path.read_text())
            reviews = {name: job for name, job in all_jobs.items() if 'uses: ./.github/actions/e2e-review' in job}
            for name, job in all_jobs.items():
                uploads = re.findall(r'name: (e2e-artifacts-(?:windows-)?)\$\{\{ matrix\.key \}\}', job)
                if not uploads:
                    continue
                lane = 'windows' if uploads[0].endswith('windows-') else 'mac'
                lanes.append(f'{path.name}:{name}:{lane}')
                after = [review for review in reviews.values() if name in needs(review) and re.search(rf'(?m)^          lane: {lane}$', review)]
                self.assertEqual(len(after), 1, f'{path.name}: suite job {name} uploads screenshots; add a job that needs it and runs `uses: ./.github/actions/e2e-review` with lane: {lane}')
                self.assertIn('anthropic-key: ${{ secrets.E2E_ANTHROPIC_KEY }}', after[0], f'{path.name}: the review needs the Anthropic key')
                self.assertRegex(after[0], r'(?m)^      issues: (read|write)', f'{path.name}: the lessons are read from the issues')
                self.assertRegex(after[0], r'(?m)^      actions: (read|write)', f'{path.name}: the suites\' artifacts are downloaded')
                self.assertRegex(after[0], r'if: always\(\)', f'{path.name}: a red suite\'s pages are reviewed too')
        self.assertEqual(sorted(lanes), ['desktop.yml:test-mac:mac', 'desktop.yml:test-windows:windows', 'e2e-windows.yml:suite:windows', 'e2e.yml:suite:mac'])

    def test_the_review_reads_each_lane_and_its_findings_reach_the_issue_filer(self):
        review = ACTION.read_text()
        self.assertIn("inputs.lane == 'windows' && 'e2e-artifacts-windows-' || 'e2e-artifacts-'", review)
        self.assertIn('name: ${{ env.REVIEW_PREFIX }}review', review, 'its findings go up as an e2e-artifacts-* artifact')
        # Owner, 26 Oct 2026: Haiku 5.5 by batch (~$1 a month), not Sonnet (~$18) or Free AI (~$31 in Workers AI neurons).
        for needed in ('E2E_REVIEW_ENGINE: claude', 'E2E_REVIEW_MODEL: claude-haiku-5-5', "E2E_REVIEW_BATCH_MIN: '1'", 'run: timeout 900 node review-ui.mjs', '--job e2e-screenshot-review'):
            self.assertIn(needed, review)
        # The release's block check reads the findings: the review comes before it, and before the step that stops a red lane (so a red lane's pages are reviewed too).
        desktop = (WORKFLOWS / 'desktop.yml').read_text()
        for lane, platform in (('mac', 'Mac'), ('windows', 'Windows')):
            release = jobs(desktop)[f'release-{lane}']
            at = release.index('uses: ./.github/actions/e2e-review')
            self.assertLess(at, release.index(f'name: Not released on {platform}, an E2E suite failed'))
            self.assertLess(at, release.index(f'name: No real high-severity finding in the {platform} suites'))
        self.assertIn("--pattern 'e2e-artifacts-*'", (WORKFLOWS / 'ui-findings.yml').read_text(), 'the issue filer reads every e2e-artifacts-* artifact, the review\'s among them')


if __name__ == '__main__':
    unittest.main()
