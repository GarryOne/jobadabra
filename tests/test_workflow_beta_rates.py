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
            job = text.split(f'\n  release-{platform}:\n')[1].split('\n  # RELEASE:')[0].split('\n  # Keep the release')[0]
            steps = job.split('      - ')
            rate = next(s for s in steps if 'tools/beta_rate_gate.py' in s and '--e2e-only' not in s)
            self.assertIn("if: needs.changes.outputs.gate == 'true'", rate)
            self.assertIn('--run "$GITHUB_RUN_ID"', rate)
            self.assertIn(f'--platform {platform}', rate)
            self.assertLess(job.index('an E2E suite failed'), job.index(rate))
            self.assertLess(job.index(rate), job.index('tools/beta-approve.sh'))
            failure = next(s for s in steps if 'an E2E suite failed' in s)
            # Owner, 30 Oct 2026: a red on either lane holds both platforms (Windows dropped its duplicates of the Mac + Linux suites).
            self.assertIn('needs: [changes, test-mac, test-windows]', job)
            self.assertIn("if: needs.test-mac.result != 'success' || needs.test-windows.result != 'success'", failure)
            self.assertRegex(failure, r'--e2e-only\n')
            self.assertNotIn('exit 1', failure, 'a tolerant red alone must reach the rate decision')


if __name__ == '__main__':
    unittest.main()
