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
# Why (1 Nov 2026, a8; owner: "take the AI out of the beta, in two steps", step 1): beta #7 (run 41333086670) made 0 live AI calls in the 7 of its 21 suites that have a relay, so the beta has no
# "AI key ready?" job any more. Its relay suites still start the relay and lib/context.mjs asks it one question before any step (asserted below): a refused token fails each of them by name.
# The night runs (e2e.yml, e2e-windows.yml) keep the one preflight (test_every_relay_matrix_checks_the_ai_once_first). The beta keeps its credit alert until step 2 (the review and judges still write ai-capped.json).
BETA_NO_PREFLIGHT = {('desktop.yml', 'test-mac'), ('desktop.yml', 'test-windows')}
ACTION = ROOT / '.github' / 'actions' / 'free-ai-relay' / 'action.yml'
RELAY_STEP = re.compile(r'uses: \./(?:\.ci-relay/)?\.github/actions/free-ai-relay')   # from the workflow's own commit (.ci-relay) or the workspace's

# Jobs that see E2E_ANTHROPIC_KEY but start no relay, each with its reason.
NO_RELAY = {
    ('e2e.yml', 'plan'): 'the one AI check before the suites (key-preflight.mjs, asserted below)',
    ('e2e-windows.yml', 'plan'): 'the one AI check before the suites (key-preflight.mjs, asserted below)',
    ('review-eval.yml', 'eval'): 'scores a review model on the judged issues, by hand; asks the model itself, runs no app',
    ('key-org-proof.yml', 'proof'): 'proves which organization each key belongs to; runs no suite',
    ('record-sites.yml', 'smoke'): 'the live pool on real sites: its own key and recordings; moves in its own PR',
    ('watch-live.yml', 'smoke'): 'the live pool\'s daily watch: moves with record-sites',
}


def jobs(text):
    """{job name: its text} under `jobs:` (two-space job keys)."""
    body = text.split('\njobs:\n', 1)[-1]
    parts = re.split(r'(?m)^  ([A-Za-z0-9_-]+):\s*$', body)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts) - 1, 2)}


def hands_key_to_ai(text):
    """Ignore credential-only artifact scans; every original AI consumer still requires its relay."""
    steps = re.split(r'(?m)^      - ', text)
    # Why (#2651, owner): an upload scanner compares credentials but never executes an AI call.
    consumers = [step for step in steps if not ('id: artifact_scan_' in step and 'run: python "$GITHUB_WORKSPACE/tools/scan-e2e-artifacts.py"' in step)]
    return 'E2E_ANTHROPIC_KEY: ${{' in ''.join(consumers)


class CiFreeAiTests(unittest.TestCase):
    def test_every_job_with_the_e2e_key_starts_the_relay_or_says_why_not(self):
        missing = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for name, text in jobs(path.read_text()).items():
                if not hands_key_to_ai(text) or (path.name, name) in NO_RELAY:
                    continue
                if not RELAY_STEP.search(text):
                    missing.append(f'{path.name} {name}')
        self.assertEqual(missing, [], 'start the Free AI relay in these jobs (or add them to NO_RELAY with the reason)')

    def test_a_scan_only_mapping_needs_no_relay_but_real_consumers_still_do(self):
        scan = """    steps:
      - name: scan
        id: artifact_scan_1
        env:
          E2E_ANTHROPIC_KEY: ${{ secrets.E2E_ANTHROPIC_KEY }}
        run: python "$GITHUB_WORKSPACE/tools/scan-e2e-artifacts.py"
"""
        self.assertFalse(hands_key_to_ai(scan))
        consumer = """      - name: app or judge
        env:
          E2E_ANTHROPIC_KEY: ${{ secrets.E2E_ANTHROPIC_KEY }}
        run: node suite.mjs settings
"""
        self.assertTrue(hands_key_to_ai(scan + consumer))
        self.assertTrue(hands_key_to_ai('    env:\n      E2E_ANTHROPIC_KEY: ${{ secrets.E2E_ANTHROPIC_KEY }}\n' + scan))
        self.assertTrue(hands_key_to_ai(scan.replace('run: python "$GITHUB_WORKSPACE/tools/scan-e2e-artifacts.py"', 'run: node suite.mjs settings')))

    def test_the_relay_starts_after_node_and_before_the_suites_run(self):
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for name, text in jobs(path.read_text()).items():
                relay = RELAY_STEP.search(text)
                if not relay:
                    continue
                node = text.find('actions/setup-node@')
                self.assertTrue(0 <= node < relay.start(), f'{path.name} {name}: Node 22 first (the relay uses node:sqlite)')
                self.assertIn('secrets.CI_FREE_AI_CF_TOKEN', text, f'{path.name} {name}')

    def test_the_beta_has_no_ai_preflight_but_its_relay_suites_still_fail_by_name(self):
        beta = jobs((WORKFLOWS / 'desktop.yml').read_text())
        self.assertNotIn('ai-ready', beta, 'the beta makes no live AI calls (step 1, 1 Nov 2026): no preflight job before the matrices')
        # Owner, 1 Nov 2026, on beta 10's graph: "We're still showing AI Credit health", and Gitar on #2904: the beta has no credit box, but the judge steps and the relay still write
        # ai-capped.json, so the one alert is a set of nonblocking steps of the run's last job.
        self.assertNotIn('ai-credit-health', beta)
        self.assertIn('node desktop/e2e/credit-alert.mjs --artifacts credit-artifacts', beta['prune'])
        self.assertEqual(beta['prune'].count('continue-on-error: true'), 5, 'neither the run page card nor the alert holds the run: card, setup, alert, scan and marker steps')
        for name in ('test-mac', 'test-windows'):
            self.assertRegex(re.search(r'(?m)^    needs: (\[[^\]]*\])', beta[name]).group(1), r'^\[changes, (build|windows)\]$', name)
            self.assertIn('Free AI relay', beta[name], f'{name} still starts the relay in its own step')
        context = (ROOT / 'desktop' / 'e2e' / 'lib' / 'context.mjs').read_text()
        self.assertIn("await checkRelay({url: process.env.E2E_FREE_AI_URL, key})", context, 'a refused token still fails the suite by name, before its first step')
        for night in ('e2e.yml', 'e2e-windows.yml'):
            self.assertIn('ai-credit-health', jobs((WORKFLOWS / night).read_text()), f'{night} keeps the credit alert')

    def test_every_job_that_runs_a_suite_carries_the_caps_account_and_token(self):
        # Why (28 Oct 2026, beta 3: failureschannels, focusdismiss and every AI step red): lib/ai-cap.mjs runs inside the suite's own process, and the two names it reads
        # were set only on the AI preflight step, so each suite read an "unreadable" count and a gate fails a capped step. Job-level env, so the retry and Edge steps get them too.
        names = ('CI_FREE_AI_CF_ACCOUNT_ID: ${{ secrets.CI_FREE_AI_CF_ACCOUNT_ID }}', 'CI_CF_ANALYTICS_TOKEN: ${{ secrets.CI_CF_ANALYTICS_TOKEN }}')

        def lacking(text):
            return [name.split(':')[0] for name in names if name not in text.split('\n    steps:', 1)[0]]
        checked, missing = 0, []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for name, text in jobs(path.read_text()).items():
                if 'node suite.mjs' not in text:
                    continue
                checked += 1
                missing += [f'{path.name} {name}: {lack}' for lack in lacking(text)]
        self.assertGreaterEqual(checked, 3, 'the jobs that run a suite were not found: this check would pass for nothing')
        self.assertEqual(missing, [], 'put these in the job-level env (not one step) of every job that runs a suite')
        # Why (1 Nov 2026, tg; review-eval runs 41328602438, 41328800166): the cap reads the token in ANY job that calls Workers AI, not only a suite's;
        # review-eval.yml passed the AI token without it, so every judge call was capped and the eval printed 0/39 as a score.
        callers = [f'{path.name} {name}' for path in sorted(WORKFLOWS.glob('*.yml')) for name, text in jobs(path.read_text()).items()
                   if 'CI_FREE_AI_CF_TOKEN:' in text and 'CI_CF_ANALYTICS_TOKEN:' not in text]
        self.assertEqual(callers, [], 'a job that passes CI_FREE_AI_CF_TOKEN also needs CI_CF_ANALYTICS_TOKEN, or the cap refuses every call')
        suite = jobs((WORKFLOWS / 'e2e.yml').read_text())['suite']
        stripped = suite.replace(names[1], '')
        self.assertEqual(lacking(stripped), ['CI_CF_ANALYTICS_TOKEN'], 'positive control: a job without the token is flagged')

    def test_every_relay_matrix_checks_the_ai_once_first(self):
        # Owner, 27 Oct 2026 ("let's close the gaps", part 4): the relay starts without checking CI's token, so a refused token was a red suite each.
        # Every matrix job that starts the relay needs a job that runs key-preflight.mjs with the Free AI token.
        missing = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            found = jobs(path.read_text())
            for name, text in found.items():
                if not RELAY_STEP.search(text) or 'matrix:' not in text:
                    continue
                if (path.name, name) in BETA_NO_PREFLIGHT:
                    continue
                need = re.search(r'(?m)^    needs: *\[?([^\]\n]*)', text)
                needed = [n.strip() for n in need.group(1).split(',')] if need else []
                if not any('node desktop/e2e/key-preflight.mjs' in found.get(n, '') and 'CI_FREE_AI_CF_TOKEN: ${{ secrets.CI_FREE_AI_CF_TOKEN }}' in found.get(n, '')
                           for n in needed):
                    missing.append(f'{path.name} {name}')
        self.assertEqual(missing, [], 'a job these need must run node desktop/e2e/key-preflight.mjs with CI_FREE_AI_CF_TOKEN')

    def test_the_relay_never_reaches_production(self):
        action = ACTION.read_text()
        for production in ('jobpilotto.top', 'jobadabra.top', 'workers.dev', 'WEB_SEARCH_ANTHROPIC_KEY'):
            self.assertNotIn(production, action)
        self.assertIn('FREE_AI_LOCAL_CF_AI_TOKEN: ${{ inputs.cf-token }}', action)
        self.assertIn('::add-mask::', action, 'the throwaway key is masked in the log')
        self.assertIn('rm -rf "$GITHUB_WORKSPACE/.free-ai-site"', action, 'nothing private stays in the workspace')

    def test_the_screenshot_review_runs_on_claude_by_batch_with_its_lessons(self):
        """The review (desktop/e2e/review-ui.mjs) runs once per lane after the suites, on Claude Sonnet by batch (owner, 26 Oct 2026: "cut the costs in half,
        but close to the same quality as Claude"; Free AI's best setup saw 71-79% of Claude's bugs and Workers AI bills past 10,000 neurons a day), and reads the
        by-design lessons from the closed issues."""
        review = (ROOT / '.github' / 'actions' / 'e2e-review' / 'action.yml').read_text()
        for needed in ('E2E_REVIEW_ENGINE: claude', "E2E_REVIEW_BATCH_MIN: '1'", 'GITHUB_TOKEN: ${{ inputs.github-token }}'):
            self.assertIn(needed, review)
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for name, text in jobs(path.read_text()).items():
                self.assertNotIn('node review-ui.mjs', text, f'{path.name} {name}: the review runs only in .github/actions/e2e-review, after the suites (all pages in one batch)')

    def test_no_job_loads_a_local_action_from_another_commit(self):
        """A job that checks out the commit under test (a bisect, a soak, a gate tag) must load its local actions from the workflow's own commit.

        26 Oct 2026: every "Bisect a red main suite" run failed at "Free AI relay" ("Can't find 'action.yml'"): the bisect checked out a commit older than
        the relay, and `uses: ./.github/actions/free-ai-relay` reads the action from that checkout."""
        own = {'', '${{ github.sha }}', '${{ github.workflow_sha }}'}
        # Reusable workflows run from a user's private repo: there github.sha is the caller's commit, and the action ships with the code version the user runs.
        same_version_on_purpose = {('daily.yml', 'run'), ('scout.yml', 'scout')}
        wrong = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            for name, text in jobs(path.read_text()).items():
                if (path.name, name) in same_version_on_purpose:
                    continue
                refs = {}   # checkout path ('' = the workspace root) -> its ref
                for step in text.split('\n      - '):
                    if 'uses: actions/checkout@' in step:
                        where = re.search(r'(?m)^\s+path:\s*(\S+)', step)
                        ref = re.search(r'(?m)^\s+ref:\s*(\$\{\{[^}]*\}\}|\S+)', step)
                        refs[where.group(1).removeprefix('./').rstrip('/') if where else ''] = ref.group(1) if ref else ''
                    for local in re.findall(r'(?m)uses:\s*\./(\S+)/action\.yml|uses:\s*\./(\S+)', step):
                        target = (local[0] or local[1]).strip('/')
                        if target.startswith('.github/workflows/'):
                            continue   # a reusable workflow is read from the workflow's own commit by GitHub itself
                        root = next((p for p in sorted(refs, key=len, reverse=True) if p and target.startswith(p + '/')), '')
                        if refs.get(root, '') not in own:
                            wrong.append(f'{path.name} {name}: ./{target} comes from a checkout of {refs.get(root)}')
        self.assertEqual(wrong, [], 'check out the workflow\'s own commit (ref: ${{ github.sha }}) into a side path and use the action from there')

    def test_no_tar_is_handed_a_path_where_windows_runs_it(self):
        """Git Bash's tar on a Windows runner reads "D:\\a\\_temp\\x" as a remote host "D": unpack inside a `cd` instead of `tar -C <path>` / `tar -f <path>`.

        26 Oct 2026: beta 40261885119, all 19 Windows e2e suites red at "Free AI relay": `tar: D\\:\\a\\\\_temp/free-ai-tree: Cannot open`.
        A local action runs on every runner, so every action counts; in a workflow, the jobs that run on Windows."""
        texts = [(str(path.relative_to(ROOT)), path.read_text()) for path in sorted((ROOT / '.github' / 'actions').glob('*/action.yml'))]
        for path in sorted(WORKFLOWS.glob('*.yml')):
            texts += [(f'{path.name} {name}', text) for name, text in jobs(path.read_text()).items() if re.search(r'(?mi)^    runs-on:.*windows|matrix\.os|windows-', text)]
        wrong = [f'{where}: {line.strip()}' for where, text in texts for line in text.splitlines()
                 if re.search(r'(^|[\s|(;&])tar\s+(-\S*\s+)*(-C|--directory|-f|-\w*f)\s*"?\$', line)]
        self.assertEqual(wrong, [], 'cd into the folder first, e.g. `... | (cd "$tree" && tar -x)`')

    def test_every_job_left_out_still_exists(self):
        for (workflow, name), why in NO_RELAY.items():
            self.assertIn(name, jobs((WORKFLOWS / workflow).read_text()), f'{workflow} {name} is gone: drop it from NO_RELAY ({why})')


if __name__ == '__main__':
    unittest.main()
