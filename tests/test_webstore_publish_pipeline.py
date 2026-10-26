"""Every stable release sends its extension to the Chrome Web Store (owner, 26 Oct 2026: "when we do the beta/stable release we should publish the newest
extension version in Chrome Web Store"; stable only). The class: every path that makes a release stable goes through tools/release-stable.sh, which starts
extension-store-publish.yml; each job that runs it may start a workflow. The publisher itself: desktop/test/webstore-publish.test.js."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / '.github' / 'workflows'
CALL = re.compile(r'(?m)^\s+(?:[A-Z0-9_]+=\S+ )*(?:tools/release-stable\.sh |(?:\w+=\$\()?python3 tools/canary_promote\.py )')   # canary_promote.py runs release-stable.sh itself


class StorePublishOnStable(unittest.TestCase):
    def test_release_stable_starts_the_store_publish_after_promoting_and_never_in_a_dry_run(self):
        script = (ROOT / 'tools' / 'release-stable.sh').read_text()
        promote = script.index('--prerelease=false --latest')
        start = script.index('gh workflow run extension-store-publish.yml')
        self.assertGreater(start, promote, 'started after the release is stable')
        self.assertLess(script.index('DRY_RUN'), promote, 'a dry run ends before it')

    def test_every_job_that_promotes_may_start_a_workflow(self):
        callers = {}
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = path.read_text()
            for match in CALL.finditer(text):
                before = text[:match.start()]
                callers.setdefault(path.name, []).append(before[before.rindex('permissions:'):])
        self.assertGreaterEqual(len(callers), 3, f'positive control: {sorted(callers)}')
        for name, blocks in callers.items():
            for perms in blocks:
                with self.subTest(workflow=name):
                    self.assertIn('actions: write', perms, f'{name}: the job running release-stable.sh needs actions: write to start the store publish')

    def test_only_a_stable_tag_publishes_and_the_pr_only_reads(self):
        flow = (WORKFLOWS / 'extension-store-publish.yml').read_text()
        publish = flow[flow.index('\n  publish:'):]
        check = flow[flow.index('\n  check:'):flow.index('\n  publish:')]
        self.assertIn("if: inputs.tag != ''", publish)
        self.assertIn('isPrerelease', publish, 'refuses a beta tag')
        self.assertIn('webstore-publish.mjs publish', publish)
        self.assertNotIn('webstore-publish.mjs publish', check)
        self.assertNotIn('secrets.', flow, 'keyless: GitHub OIDC to Google, no stored key')


if __name__ == '__main__':
    unittest.main()
