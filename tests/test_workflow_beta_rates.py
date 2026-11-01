# Guard beta rate checks in both release lanes before any platform approval.
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class BetaRates(unittest.TestCase):
    def test_each_beta_lane_checks_rates_after_e2e_before_approval(self):
        text = (ROOT / '.github/workflows/desktop.yml').read_text()
        self.assertEqual(re.findall(r'^# Job: (.+)$', text, re.M), ['run the backbone'])
        for platform in ('mac', 'windows'):
            # 1 Nov 2026 (a8; Gitar on #2871): the Release job ends where its offer job's comment starts; the approval is the offer job's, which runs only after this job succeeded
            # (its `needs` + `if` are held by test_desktop_workflow.py test_neither_platform_is_offered_unless_both_lanes_pass), so the order is no longer a text order.
            job = text.split(f'\n  release-{platform}:\n')[1].split(f'\n  release-{platform}-offer:\n')[0]
            offer = text.split(f'\n  release-{platform}-offer:\n')[1].split('\n\n  # ')[0]
            steps = job.split('      - ')
            rate = next(s for s in steps if 'tools/beta_rate_gate.py' in s and '--e2e-only' not in s)
            self.assertIn("if: needs.changes.outputs.gate == 'true'", rate)
            self.assertIn('--run "$GITHUB_RUN_ID"', rate)
            self.assertIn(f'--platform {platform}', rate)
            self.assertLess(job.index('an E2E suite failed'), job.index(rate))
            self.assertNotIn('tools/beta-approve.sh', job)
            self.assertIn(f"if: needs.release-{platform}.result == 'success'", offer)
            failure = next(s for s in steps if 'an E2E suite failed' in s)
            # Owner, 30 Oct 2026: a red on either lane holds both platforms (Windows dropped its duplicates of the Mac + Linux suites).
            self.assertIn('needs: [changes, build, windows, test-mac, test-windows, main-ci]', job)   # + the Build boxes' unit outcome (owner, 31 Oct 2026); + main-ci (1 Nov 2026)
            # Owner, 31 Oct 2026 (a suite past its budget is our bug): the gate's own exit code holds the beta; no grey hold, held output or continue-on-error.
            self.assertNotIn('if: needs.test-', failure, 'every lane job is read')
            self.assertNotIn('continue-on-error', failure)
            self.assertNotIn('id: backbone_gate', failure)
            approval = next(s for s in offer.split('      - ') if 'name: Release it to ' in s)
            self.assertNotIn('held', approval)
            self.assertIn(f'--e2e-only --platform {platform}', failure)


if __name__ == '__main__':
    unittest.main()
