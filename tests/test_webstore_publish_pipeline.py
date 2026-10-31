"""Every stable release goes to the stores: its extension to the Chrome Web Store, its Windows app to the Microsoft Store (#2134 made the Store copy update only from there), (owner, 26 Oct 2026: "when we do the beta/stable release we should publish the newest
extension version in Chrome Web Store"; stable only). The class: every path that makes a release stable goes through tools/release-stable.sh, which starts
extension-store-publish.yml; each job that runs it may start a workflow. The publisher itself: desktop/test/webstore-publish.test.js."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / '.github' / 'workflows'
CALL = re.compile(r'(?m)^\s+(?:[A-Z0-9_]+=\S+ )*(?:tools/release-stable\.sh |(?:\w+=\$\()?python3 tools/canary_promote\.py )')   # canary_promote.py runs release-stable.sh itself


class StorePublishOnStable(unittest.TestCase):
    def test_release_stable_starts_each_store_publish_after_promoting_and_never_in_a_dry_run(self):
        script = (ROOT / 'tools' / 'release-stable.sh').read_text()
        promote = script.index('--prerelease=false --latest')
        self.assertLess(script.index('DRY_RUN'), promote, 'a dry run ends before it')
        for flow in ('extension-store-publish.yml', 'msix-store.yml'):
            with self.subTest(flow=flow):
                self.assertGreater(script.index(f' {flow} "'), promote, 'started (start_store) after the release is stable')

    def test_no_switch_sits_between_the_promotion_and_the_store_starts(self):
        # 31 Oct 2026, owner: "We should have this always, even if we go on the hot path". SKIP_E2E, E2E_NO_START, E2E_ALREADY_GREEN and FRESH_E2E only decide the end-to-end gate,
        # which is before the promotion; only DRY_RUN may end the script early, and it does so before the promotion too (tests/test_release_stable_guard.py plays every route).
        script = (ROOT / 'tools' / 'release-stable.sh').read_text()
        after = '\n'.join(line for line in script[script.index('--prerelease=false --latest'):].splitlines() if not line.lstrip().startswith('#'))   # code, not the comment that names the switches
        self.assertRegex(after, r'start_store "Chrome Web Store" extension-store-publish\.yml')
        self.assertRegex(after, r'start_store "Microsoft Store" msix-store\.yml')
        self.assertNotRegex(after, r'SKIP_E2E|E2E_NO_START|E2E_ALREADY_GREEN|FRESH_E2E|DRY_RUN', 'a switch after the promotion could skip a store')

    def test_the_hot_path_promotes_through_release_stable_and_keeps_its_exit_status(self):
        flow = (WORKFLOWS / 'canary-promote.yml').read_text()
        step = flow[flow.index('- name: HOT PATH'):flow.index('- name: End-to-end top-up')]
        self.assertIn('SKIP_E2E=1 tools/release-stable.sh "$FORCE_TAG"', step, 'the hot path is the one promotion script, so it reaches both stores')
        self.assertNotIn('--prerelease=false', step, 'a hand-rolled promotion would skip the store starts')

    def steps_that_promote(self):
        """(workflow, step text) of every step that runs tools/release-stable.sh or the canary's auto-promote (not the --candidate lookups)."""
        found = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = path.read_text()
            for match in CALL.finditer(text):
                if '--candidate' in text[match.start():text.index('\n', match.start())]:
                    continue
                begin = text.rfind('\n      - ', 0, match.start())
                end = text.find('\n      - ', match.end())
                found.append((path.name, text[begin:end if end != -1 else len(text)], text[match.start():text.index('\n', match.start())]))
        return found

    def test_no_route_swallows_a_failed_store_start(self):
        # The script now exits 4 after promoting when a store start failed. A caller that ignores the exit status would put the old green run back.
        found = self.steps_that_promote()
        self.assertTrue({name for name, _, _ in found} >= {'beta-approve.yml', 'canary-promote.yml', 'desktop.yml'}, f'positive control: {[n for n, _, _ in found]}')
        for name, step, line in found:
            with self.subTest(workflow=name, line=line.strip()):
                self.assertNotRegex(line, r'\|\|\s*(true|:|echo|exit 0)', 'the exit status of the promotion is kept')
                self.assertNotIn('continue-on-error', step)

    def test_every_route_that_promotes_can_send_the_alert(self):
        # release-stable.sh sends one Telegram alert (desktop/e2e/ci-alert.mjs send) when a store start fails; it needs the bot's token and chat from the calling step.
        for name, step, line in self.steps_that_promote():
            if name == 'promote-dry-run.yml':
                continue   # the dry run stops before the promotion and starts no store
            with self.subTest(workflow=name, line=line.strip()):
                self.assertIn('CI_ALERTS_TELEGRAM_BOT_TOKEN: ${{ secrets.CI_ALERTS_TELEGRAM_BOT_TOKEN }}', step)
                self.assertIn('CI_ALERTS_TELEGRAM_CHAT_ID: ${{ secrets.CI_ALERTS_TELEGRAM_CHAT_ID }}', step)

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


class MicrosoftStoreOnStable(unittest.TestCase):
    FLOW = (WORKFLOWS / 'msix-store.yml').read_text()

    def job(self, name):
        return self.FLOW[self.FLOW.index(f'\n  {name}:'):]

    def test_the_package_is_built_from_the_stable_tag_and_a_beta_is_refused(self):
        build = self.FLOW[self.FLOW.index('\n  msix:'):self.FLOW.index('\n  submit:')]
        self.assertIn('ref: ${{ inputs.tag', build, 'the app exactly as that release ships it')
        self.assertIn('isPrerelease', build, 'betas never go to the Store (owner, 26 Oct 2026: stable only)')

    def test_submit_runs_only_for_a_release_and_waits_for_the_owners_credentials(self):
        submit = self.job('submit')
        self.assertIn("if: inputs.tag != ''", submit)
        self.assertRegex(submit, r'MS_STORE_CLIENT_SECRET[^\n]*\n(?:.*\n)*?.*not connected', 'without the Entra app it says so and ends green')
        self.assertIn('msstore publish', submit)
        self.assertIn('--appId 9NW1JJ7Z90MP', submit)

    def test_a_version_still_in_review_waits_for_the_next_release(self):
        # A Store update is certified in hours to days; a nightly stable can come first. publish would fail on the submission in flight.
        submit = self.job('submit')
        self.assertIn('msstore submission status 9NW1JJ7Z90MP', submit)
        for state in ('CommitStarted', 'PreProcessing', 'Certification', 'Release', 'Publishing'):
            self.assertIn(state, submit)

    def test_sign_in_runs_where_msstore_can_keep_its_secret_and_prints_why_it_failed(self):
        # 26 Oct 2026, 0.8.41: "Sign in to Partner Center" ended in "Ops, something doesn't seem to be right!" on ubuntu-24.04. The token was fine:
        # msstore reconfigure then stores the client secret in the OS keyring (libsecret on Linux, none unlocked on a runner) and that write failed.
        # The reason went to > /dev/null. Microsoft's own example runs it on windows-latest (Credential Manager).
        submit = self.job('submit')
        self.assertRegex(submit, r'runs-on: windows-', 'msstore keeps its secret in the OS keyring; a Linux runner has none unlocked')
        self.assertRegex(submit, r'defaults:\s*\n\s*run:\s*\n\s*shell: bash', 'the steps are bash; Windows runs pwsh by default')
        signin = next(line for line in submit.splitlines() if 'run: msstore reconfigure' in line)
        self.assertNotIn('/dev/null', signin, 'a failed sign-in prints its reason (GitHub masks the secrets)')
        self.assertIn('--verbose', signin, 'without it msstore hides the exception behind "Ops"')

    def test_publish_gets_an_msix_path_it_accepts(self):
        # 0.8.41's second try: "Unrecognized command or argument '--inputFile'". msstore publish takes the package path as its argument and only
        # .msix/.msixbundle/.msixupload (exact case); the build makes .appx, the same format under the old name, so the step copies it to .msix.
        submit = self.job('submit')
        publish = next(line for line in submit.splitlines() if 'msstore publish' in line and not line.strip().startswith('#'))
        self.assertNotIn('--inputFile', publish, 'not an msstore option')
        self.assertRegex(publish, r'msstore publish "\$msix"', 'the .msix file is the argument')
        self.assertRegex(submit, r'msix="\$\{file%\.appx\}\.msix"', 'msstore refuses an .appx: copy it to .msix')

    def test_the_package_targets_a_windows_the_store_accepts_as_msix(self):
        # 0.8.41's third try: "You cannot upload msix/msixbundle/msixupload packages that targets Windows MinVersion <= 10.0.17134.0";
        # electron-builder's x64 default is 10.0.14316.0.
        build = self.FLOW[self.FLOW.index('\n  msix:'):self.FLOW.index('\n  submit:')]
        found = re.search(r'-c\.appx\.minVersion=10\.0\.(\d+)\.0', build)
        self.assertTrue(found, 'set appx.minVersion: the default is below the Store floor for .msix')
        self.assertGreater(int(found.group(1)), 17134)

    def test_the_credentials_are_only_secrets_never_echoed(self):
        self.assertNotRegex(self.FLOW, r'echo[^\n]*\$\{\{ *secrets\.')
        self.assertNotRegex(self.FLOW, r'echo[^\n]*\$MS_STORE_CLIENT_SECRET')


if __name__ == '__main__':
    unittest.main()
