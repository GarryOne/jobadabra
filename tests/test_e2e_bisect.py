"""A red main suite gets an owner (tools/e2e_bisect.py, gate G2b, 26 Oct 2026): bisect to the first red commit, one red-main issue per suite, closed when green again."""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from tools import e2e_bisect as b  # noqa: E402

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
        b.jobs_of = lambda rid: [{'name': 'cardstates', 'conclusion': 'success'}, {'name': 'settings', 'conclusion': 'failure'},
                                 {'name': 'interactions', 'conclusion': 'failure'}, {'name': 'recorded-2of5', 'conclusion': 'failure'},
                                 {'name': 'Telegram alert', 'conclusion': 'failure'}, {'name': 'jobs', 'conclusion': 'skipped'}]

    def tearDown(self):
        b.gh, b.gh_json, b.open_issues, b.jobs_of = self.saved

    def test_closes_green_again_and_bisects_only_new_reds(self):
        b.after_run('9')
        closes = [c for c in self.calls if c[:2] == ('issue', 'close')]
        starts = [c for c in self.calls if c[:2] == ('workflow', 'run')]
        self.assertEqual([c[2] for c in closes], ['70'], 'cardstates passed: its issue closes; settings stays open')
        started = sorted(next(a for a in c if a.startswith('suite=')) for c in starts)
        self.assertEqual(started, ['suite=interactions', 'suite=recorded'], 'settings already has an issue; the alert job is no suite')


class Workflows(unittest.TestCase):
    def test_bisect_runs_are_never_main_checks_nor_filed(self):
        e2e = (ROOT / '.github/workflows/e2e.yml').read_text()
        self.assertIn("inputs.bisect && format('Bisect {0} {1}', inputs.suite, inputs.target_ref)", e2e)
        self.assertIn('!inputs.bisect', e2e, 'a bisect step runs no paid judge')
        self.assertIn('python3 tools/e2e_bisect.py after-run "$GITHUB_RUN_ID"', e2e)
        self.assertIn("'Bisect '", (ROOT / '.github/workflows/ui-findings.yml').read_text())
        self.assertIn('Bisect', (ROOT / 'tools/main_e2e_state.py').read_text())
        self.assertRegex((ROOT / 'desktop/e2e/plan-run.mjs').read_text(), r'otherCode = run => /\^\([^)]*Bisect')


if __name__ == '__main__':
    unittest.main()
