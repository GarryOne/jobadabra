"""The PR's one required status, "All checks passed", is written by tools/pr-verdict.py when a PR workflow ends: no job holds a runner to poll for it.
Why (owner, 26 Oct 2026: "How could you design such a slow and inefficient method of checking PRs?"): on #1992 two jobs only waited (pr-gate's
"Other workflows passed" and pr-suites' wait), 43 of 206 runner-minutes of one push, while its suite jobs queued up to 17.5 min for a runner.
Also the 10-min budget: a CI change whose own checks take longer goes red (history: 781637a, bc585e3, a7a6a9f, 7083bb7 each slowed PRs, none said by how much)."""
import importlib.util
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / '.github' / 'workflows'
spec = importlib.util.spec_from_file_location('pr_verdict', ROOT / 'tools' / 'pr-verdict.py')
pv = importlib.util.module_from_spec(spec); spec.loader.exec_module(pv)


def run(name, status='completed', conclusion='success', event='pull_request', at='2026-10-26T03:00:00Z', end='2026-10-26T03:04:00Z', title='', id=1):
    return {'databaseId': id, 'workflowName': name, 'status': status, 'conclusion': conclusion if status == 'completed' else '', 'event': event,
            'createdAt': at, 'updatedAt': end, 'displayTitle': title or name}


class Verdict(unittest.TestCase):
    def test_green_when_every_pr_workflow_ended_green(self):
        state, why, _ = pv.verdict([run('CI · Pull request'), run('CI · Tests · python', conclusion='skipped')])
        self.assertEqual(state, 'success', why)
        self.assertIn('4.0 min', why)

    def test_pending_while_one_runs_and_red_at_once_when_one_failed(self):
        self.assertEqual(pv.verdict([run('CI · Pull request'), run('CI · Tests · python', status='in_progress')])[0], 'pending')
        state, why, _ = pv.verdict([run('CI · Tests · python', conclusion='failure'), run('CI · Tests · desktop', status='in_progress')])
        self.assertEqual(state, 'failure')
        self.assertIn('CI · Tests · python', why)

    def test_the_e2e_run_a_pr_started_counts_and_other_e2e_runs_do_not(self):
        # the owner rejected report only (26 Oct 2026): a red suite of the PR's own e2e run blocks the merge
        e2e = run('CI · End-to-end on Mac + Linux', event='workflow_dispatch', conclusion='failure', title='E2E for PR · jobs,settings · live-updates')
        self.assertEqual(pv.verdict([run('CI · Pull request'), e2e])[0], 'failure')
        self.assertEqual(pv.verdict([run('CI · Pull request'), dict(e2e, status='in_progress')])[0], 'pending')
        other = dict(e2e, displayTitle='Bisect jobs abc123')
        self.assertEqual(pv.verdict([run('CI · Pull request'), other])[0], 'success')

    def test_the_newest_run_of_a_workflow_decides(self):
        # a description edit re-runs the gate; a cancelled older copy, or an older red fixed by a newer run, is not this commit's state
        old = run('CI · Pull request', conclusion='cancelled', at='2026-10-26T03:00:00Z', id=1)
        new = run('CI · Pull request', at='2026-10-26T03:02:00Z', id=2)
        self.assertEqual(pv.verdict([old, new])[0], 'success')
        self.assertEqual(pv.verdict([new, dict(old, createdAt='2026-10-26T03:05:00Z', conclusion='failure')])[0], 'failure')

    def test_nothing_from_a_pull_request_writes_nothing(self):
        self.assertIsNone(pv.verdict([run('CI · End-to-end on Mac + Linux', event='schedule')])[0])

    def test_a_ci_change_over_the_budget_goes_red_unless_its_commit_says_why(self):
        slow = [run('CI · Pull request', end='2026-10-26T03:14:00Z')]
        self.assertEqual(pv.verdict(slow, files=['desktop/renderer/app.js'])[0], 'success')
        state, why, _ = pv.verdict(slow, files=['.github/workflows/e2e.yml'])
        self.assertEqual(state, 'failure')
        self.assertIn('10-min budget', why)
        self.assertEqual(pv.verdict(slow, files=['tools/pr-suites.sh'], messages=['x\n\nCI-budget: one-off migration'])[0], 'success')
        for file in ['.github/workflows/x.yml', 'tools/pr-verdict.py', 'desktop/e2e/lib/plan.mjs', 'desktop/e2e/pr-suites.mjs', 'desktop/e2e/plan-run.mjs']:
            self.assertTrue(pv.ci_change([file]), file)
        self.assertFalse(pv.ci_change(['tools/ship.sh', 'desktop/e2e/suites/jobs.mjs']))

    def test_a_status_description_fits_github(self):
        many = [run(f'CI · workflow number {i}', conclusion='failure', id=i) for i in range(20)]
        self.assertLessEqual(len(pv.verdict(many)[1]), 140)


class Workflows(unittest.TestCase):
    def test_the_verdict_listens_to_every_workflow_a_pr_starts(self):
        # A new PR workflow missing from the list would be judged only when another one ends: its red could be missed.
        prs = set()
        for path in WORKFLOWS.glob('*.yml'):
            text = path.read_text(); trigger = text.split('\njobs:')[0]
            if re.search(r'(?m)^  pull_request:|^on:.*\bpull_request\b', trigger):
                prs.add(re.search(r'(?m)^name:\s*(.+?)\s*$', text).group(1).strip('\'"'))
        self.assertIn('CI · Pull request', prs, 'positive control')
        verdict = (WORKFLOWS / 'pr-verdict.yml').read_text()
        listed = set(re.findall(r"(?m)^      - '(.+)'$", verdict))
        self.assertEqual(prs - listed, set(), 'add it to pr-verdict.yml workflow_run.workflows')
        self.assertIn('CI · End-to-end on Mac + Linux', listed, "the e2e run a PR starts (pr-suites.yml) is judged when it ends")

    def test_no_pr_job_polls_for_other_workflows(self):
        gate = (WORKFLOWS / 'pr-gate.yml').read_text()
        suites = (WORKFLOWS / 'pr-suites.yml').read_text()
        self.assertNotIn('pr-suites-wait', suites, 'pr-suites starts the e2e run and ends; the e2e run reports itself')
        self.assertNotIn('all-checks-green', gate, 'the required status comes from pr-verdict.yml, not a job that waits')
        self.assertNotRegex(gate, r'(?m)^    name: All checks passed$', 'a job of that name would satisfy the required check before the e2e run ends')

    def test_the_pr_e2e_run_says_its_suites_in_its_title_and_turns_the_pr_red_at_its_first_red_suite(self):
        e2e = (WORKFLOWS / 'e2e.yml').read_text()
        self.assertIn("inputs.pr_suites && format('E2E for PR · {0} · {1}', inputs.pr_suites, github.ref_name)", e2e)
        self.assertEqual(pv.E2E_PR_TITLE, 'E2E for PR · ')
        self.assertRegex(e2e, r"if: failure\(\) && inputs\.pr_suites != ''\n\s+env:[\s\S]{0,400}tools/pr-verdict\.py[^\n]*--red")


if __name__ == '__main__':
    unittest.main()
