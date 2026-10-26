"""CI on Free AI: every job that hands the e2e test key to its suites also starts the Free AI relay, never production's AI.

Owner, 26 Oct 2026, when CI's Anthropic credit ran out: "Let's just switch to Free AI (CloudFlare workers AI). I don't want to top up anymore". The relay
(.github/actions/free-ai-relay) runs the site's own Free AI handler on the runner with CI's own Workers AI token (docs/rules/why.md); desktop/e2e/lib/engine.mjs
then runs the app under test and the judges on it. A new suite job that forgets the relay would fail on the dead Claude key, so this test names every such job.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / '.github' / 'workflows'
ACTION = ROOT / '.github' / 'actions' / 'free-ai-relay' / 'action.yml'
RELAY_STEP = 'uses: ./.github/actions/free-ai-relay'

# Jobs that see E2E_ANTHROPIC_KEY but start no relay, each with its reason.
NO_RELAY = {
    ('desktop.yml', 'ai-ready'): 'the gate\'s preflight: it checks CI_FREE_AI_CF_TOKEN instead (asserted below)',
    ('key-org-proof.yml', 'proof'): 'proves which organization each key belongs to; runs no suite',
    ('record-sites.yml', 'smoke'): 'the live pool on real sites: its own key and recordings; moves in its own PR',
    ('watch-live.yml', 'smoke'): 'the live pool\'s daily watch: moves with record-sites',
}


def jobs(text):
    """{job name: its text} under `jobs:` (two-space job keys)."""
    body = text.split('\njobs:\n', 1)[-1]
    parts = re.split(r'(?m)^  ([A-Za-z0-9_-]+):\s*$', body)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts) - 1, 2)}


class CiFreeAiTests(unittest.TestCase):
    def test_every_job_with_the_e2e_key_starts_the_relay_or_says_why_not(self):
        missing = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for name, text in jobs(path.read_text()).items():
                if 'E2E_ANTHROPIC_KEY: ${{' not in text or (path.name, name) in NO_RELAY:
                    continue
                if RELAY_STEP not in text:
                    missing.append(f'{path.name} {name}')
        self.assertEqual(missing, [], 'start the Free AI relay in these jobs (or add them to NO_RELAY with the reason)')

    def test_the_relay_starts_after_node_and_before_the_suites_run(self):
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for name, text in jobs(path.read_text()).items():
                if RELAY_STEP not in text:
                    continue
                node = text.find('actions/setup-node@')
                self.assertTrue(0 <= node < text.find(RELAY_STEP), f'{path.name} {name}: Node 22 first (the relay uses node:sqlite)')
                self.assertIn('secrets.CI_FREE_AI_CF_TOKEN', text, f'{path.name} {name}')

    def test_the_gate_checks_the_free_ai_token(self):
        gate = jobs((WORKFLOWS / 'desktop.yml').read_text())['ai-ready']
        self.assertIn('CI_FREE_AI_CF_TOKEN: ${{ secrets.CI_FREE_AI_CF_TOKEN }}', gate)

    def test_the_relay_never_reaches_production(self):
        action = ACTION.read_text()
        for production in ('jobpilotto.top', 'jobadabra.top', 'workers.dev', 'WEB_SEARCH_ANTHROPIC_KEY'):
            self.assertNotIn(production, action)
        self.assertIn('FREE_AI_LOCAL_CF_AI_TOKEN: ${{ inputs.cf-token }}', action)
        self.assertIn('::add-mask::', action, 'the throwaway key is masked in the log')
        self.assertIn('rm -rf "$GITHUB_WORKSPACE/.free-ai-site"', action, 'nothing private stays in the workspace')

    def test_every_screenshot_review_runs_on_free_ai_with_its_lessons(self):
        """The review (desktop/e2e/review-ui.mjs) asks Workers AI with CI's token and reads the by-design lessons from the closed issues."""
        reviews = 0
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for name, text in jobs(path.read_text()).items():
                for step in (part for part in text.split('\n      - ') if 'run: node review-ui.mjs' in part):
                    reviews += 1
                    for needed in ('CI_FREE_AI_CF_TOKEN: ${{ secrets.CI_FREE_AI_CF_TOKEN }}', 'CI_FREE_AI_CF_ACCOUNT_ID: ${{ secrets.CI_FREE_AI_CF_ACCOUNT_ID }}', 'GITHUB_TOKEN: ${{ github.token }}'):
                        self.assertIn(needed, step, f'{path.name} {name}: the screenshot review step')
                    self.assertRegex(text, r'(?m)^      issues: read', f'{path.name} {name}: the lessons are read from the issues')
        self.assertGreaterEqual(reviews, 4)

    def test_every_job_left_out_still_exists(self):
        for (workflow, name), why in NO_RELAY.items():
            self.assertIn(name, jobs((WORKFLOWS / workflow).read_text()), f'{workflow} {name} is gone: drop it from NO_RELAY ({why})')


if __name__ == '__main__':
    unittest.main()
