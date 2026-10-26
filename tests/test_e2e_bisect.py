"""A red main suite gets an owner (tools/e2e_bisect.py, gate G2b, 26 Oct 2026): bisect to the first red commit, one red-main issue per suite, closed when green again."""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from tools import e2e_bisect as b  # noqa: E402

CREDIT = '✗ the interactions suite stopped: E2E_ANTHROPIC_KEY: the API refused model claude-haiku-5-5 (400): "Your credit balance is too low"'
COMMITS = [f'{i:02x}'.ljust(40, '0') for i in range(12)]   # [0] green, [11] red


class Bisect(unittest.TestCase):
    def test_finds_the_first_red_commit_in_log2_steps(self):
        for first_red in range(1, 12):
            calls = []

            def test(sha, first_red=first_red, calls=calls):
                calls.append(sha)
                return 'failure' if COMMITS.index(sha) >= first_red else 'success'
            found, _, tested = b.bisect(COMMITS, test)
            self.assertEqual(found, COMMITS[first_red])
            self.assertLessEqual(len(calls), 4, '11 commits: at most ceil(log2 11) = 4 runs')
            self.assertEqual([sha for sha, _ in tested], calls)

    def test_one_commit_in_range_needs_no_run(self):
        found, _, tested = b.bisect(COMMITS[:2], lambda sha: self.fail('no run needed'))
        self.assertEqual((found, tested), (COMMITS[1], []))

    def test_a_step_that_cannot_tell_stops_and_keeps_the_range(self):
        found, (lo, hi), _ = b.bisect(COMMITS, lambda sha: None)
        self.assertIsNone(found)
        self.assertEqual((lo, hi), (0, 11))


class IssueContract(unittest.TestCase):
    def test_the_body_names_the_pr_and_branch_the_way_the_session_hook_reads_it(self):
        body = b.issue_body('cardstates', 'f' * 40, 'https://run', found=COMMITS[5], pr={'number': 1914, 'branch': 'compact-run-banner', 'title': '[5c] Show each run'},
                            good=COMMITS[0], tested=[(COMMITS[5], 'failure'), (COMMITS[2], 'success')])
        # tools/pr-red-check.sh: capture("Breaking PR: #(?<pr>[0-9]+) \\(branch `(?<br>[^`]+)`\\)")
        match = re.search(r'Breaking PR: #([0-9]+) \(branch `([^`]+)`\)', body)
        self.assertEqual(match.groups(), ('1914', 'compact-run-banner'))
        self.assertIn('Breaking PR: #(?<pr>[0-9]+) \\\\(branch `(?<br>[^`]+)`\\\\)', (ROOT / 'tools/pr-red-check.sh').read_text())
        self.assertIn('green at 0000000', body)
        self.assertEqual(b.issue_title('cardstates'), 'Red main: cardstates')

    def test_no_pr_found_lists_the_range(self):
        body = b.issue_body('settings', 'f' * 40, 'u', candidates=COMMITS[3:5])
        self.assertNotRegex(body, r'Breaking PR: #\d')
        self.assertIn('0300000', body)


class AfterRun(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.saved = (b.gh, b.gh_json, b.open_issues, b.jobs_of)
        b.gh = lambda *args, check=True: self.calls.append(args) or ''
        b.gh_json = lambda *args: {'html_url': 'https://run/9', 'head_sha': 'a' * 40}
        b.open_issues = lambda: [{'number': 70, 'title': 'Red main: cardstates'}, {'number': 71, 'title': 'Red main: settings'}]
        self.saved += (b.log_of,)
        self.logs = {2: '✗ the icon rail: a marker covers the icon', 3: '✗ recorded: the panel says "Filled 3"', 4: '', 5: CREDIT}
        b.log_of = lambda job_id: self.logs.get(job_id, '')
        b.jobs_of = lambda rid: [{'id': 1, 'name': 'cardstates', 'conclusion': 'success'}, {'id': 6, 'name': 'settings', 'conclusion': 'failure'},
                                 {'id': 2, 'name': 'interactions', 'conclusion': 'failure'}, {'id': 3, 'name': 'recorded-2of5', 'conclusion': 'failure'},
                                 {'id': 4, 'name': 'Telegram alert', 'conclusion': 'failure'}, {'id': 7, 'name': 'jobs', 'conclusion': 'skipped'}]

    def tearDown(self):
        b.gh, b.gh_json, b.open_issues, b.jobs_of, b.log_of = self.saved

    def started(self):
        return [next(a for a in c if a.startswith('suite=')) for c in self.calls if c[:2] == ('workflow', 'run')]

    def test_closes_green_again_and_bisects_one_new_red(self):
        b.after_run('9')
        closes = [c for c in self.calls if c[:2] == ('issue', 'close')]
        self.assertEqual([c[2] for c in closes], ['70'], 'cardstates passed: its issue closes; settings stays open')
        # 26 Oct 2026: 10 red suites started 10 bisects at once and filled the job queue. One per main check; the next check starts the next.
        self.assertEqual(self.started(), ['suite=interactions'], 'settings already has an issue; the alert job is no suite; one bisect per run')

    def test_an_environment_red_is_never_bisected(self):
        # 26 Oct 2026: the dead Claude key turned every suite red; bisecting it finds no PR and only fills the queue.
        self.logs[2] = CREDIT
        b.after_run('9')
        self.assertEqual(self.started(), ['suite=recorded'], 'interactions is red on the key: skipped, recorded is a product red')
        self.logs[3] = "✗ x: Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"
        self.calls.clear()
        b.after_run('9')
        self.assertEqual(self.started(), [], 'every red is the environment: no bisect')


class AfterMerge(AfterRun):
    """The steps run after a merge (PR 4, owner's yes 26 Oct 2026): a red already names its commit, so no bisect; a green of a few steps closes nothing."""
    def setUp(self):
        super().setUp()
        self.saved_pr = (b.pr_of, b.report)
        self.reports = []
        b.pr_of = lambda sha: {'number': 2057, 'branch': 'ci-steps', 'title': 'Run only the steps'} if sha == 'a' * 40 else None
        b.report = lambda suite, body, pr: self.reports.append((suite, body, pr))

    def tearDown(self):
        b.pr_of, b.report = self.saved_pr
        super().tearDown()

    def test_a_red_names_the_merged_pr_without_a_bisect_and_a_green_closes_nothing(self):
        b.after_merge('9')
        self.assertEqual(self.started(), [], 'no bisect: the merge is the only commit in range')
        self.assertEqual([c for c in self.calls if c[:2] == ('issue', 'close')], [], 'cardstates green on a few steps: its issue stays open')
        self.assertEqual([suite for suite, _, _ in self.reports], ['interactions', 'recorded'], 'settings already has an issue')
        suite, body, pr = self.reports[0]
        self.assertEqual(pr['number'], 2057)
        self.assertRegex(body, r'Breaking PR: #2057 \(branch `ci-steps`\)')

    def test_an_environment_red_is_not_filed(self):
        self.logs[2] = CREDIT
        b.after_merge('9')
        self.assertEqual([suite for suite, _, _ in self.reports], ['recorded'])

    def test_its_green_is_never_the_bisect_s_last_green(self):
        runs = [{'id': 5, 'head_sha': '5' * 40, 'head_branch': 'main', 'conclusion': 'success', 'display_title': 'E2E after merge · 5555555 · interactions'},
                {'id': 4, 'head_sha': '4' * 40, 'head_branch': 'main', 'conclusion': 'success', 'display_title': 'E2E check · on time (Worker cron)'}]
        b.gh_json = lambda *args: runs if 'runs?' in args[1] else None
        b.jobs_of = lambda rid: [{'name': 'interactions', 'conclusion': 'success'}]
        self.assertEqual(b.last_green('interactions', 'f' * 40, lambda a, c: True), '4' * 40)


class Workflows(unittest.TestCase):
    def test_bisect_runs_are_never_main_checks_nor_filed(self):
        e2e = (ROOT / '.github/workflows/e2e.yml').read_text()
        self.assertIn("inputs.bisect && format('Bisect {0} {1}', inputs.suite, inputs.target_ref)", e2e)
        self.assertIn('!inputs.bisect', e2e, 'a bisect step runs no paid judge')
        self.assertIn('python3 tools/e2e_bisect.py after-run "$GITHUB_RUN_ID"', e2e)
        self.assertIn("'Bisect '", (ROOT / '.github/workflows/ui-findings.yml').read_text())
        self.assertIn('Bisect', (ROOT / 'tools/main_e2e_state.py').read_text())
        self.assertRegex((ROOT / 'desktop/e2e/plan-run.mjs').read_text(), r'otherCode = run => /\^\([^)]*Bisect')

    def test_one_bisect_at_a_time(self):
        # 26 Oct 2026: `group: e2e-bisect-${{ inputs.suite }}` let 10 bisects run at once; one group: one runs, the newest waits.
        flow = (ROOT / '.github/workflows/e2e-bisect.yml').read_text()
        block = re.search(r'(?ms)^concurrency:[^\n]*\n(.*?)(?=^\S)', flow).group(1)
        self.assertRegex(block, r'group: e2e-bisect\s*(#|\n)')
        self.assertIn('cancel-in-progress: false', block)


if __name__ == '__main__':
    unittest.main()
