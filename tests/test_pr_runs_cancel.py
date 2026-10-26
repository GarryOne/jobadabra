"""A newer push to a pull request cancels its older runs, so the superseded jobs free their runners (owner, 15 Oct 2026: a flow PR started ~25 jobs, GitHub runs ~20 at once,
8 PRs are often open, and ship.sh re-pushes up to 5 times). Every workflow a PR starts has a concurrency group per PR with cancel-in-progress on the PR only; main's runs never cancel
(tests/test_main_runs_finish.py). By-hand and comment-driven workflows are listed with the reason."""
import json
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github' / 'workflows'
PR_ONLY = "${{ github.event_name == 'pull_request' }}"
NEWEST_WINS = "${{ github.event_name != 'workflow_dispatch' }}"   # a PR and main cancel their older run, a by-hand run never (tests/test_main_runs_finish.py)
NOT_CANCELLED = {}   # workflow -> why a newer push must not cancel it


def on_block(text):
    return text.split('\njobs:')[0]


def pr_workflows():
    return sorted(p for p in WORKFLOWS.glob('*.yml') if re.search(r'(?m)^  pull_request:', on_block(p.read_text(encoding='utf-8'))))


class PrRunsCancel(unittest.TestCase):
    def test_every_pr_workflow_cancels_its_superseded_run(self):
        found = pr_workflows()
        self.assertGreater(len(found), 8, 'positive control: the PR workflows are read')
        offenders = []
        for path in found:
            if path.name in NOT_CANCELLED: continue
            text = path.read_text(encoding='utf-8')
            top = re.search(r'(?ms)^concurrency:[^\n]*\n(.*?)(?=^\S)', text)
            if not top: offenders.append(f'{path.name}: no concurrency'); continue
            block = top.group(1)
            group = re.search(r'group:\s*([^\n#]+)', block)
            cancel = re.search(r'cancel-in-progress:\s*([^\n#]+)', block)
            if not group or not re.search(r'head_ref|pull_request\.number|github\.ref', group.group(1)): offenders.append(f'{path.name}: the group is not per PR')
            elif not cancel or cancel.group(1).strip() not in ('true', PR_ONLY, NEWEST_WINS): offenders.append(f'{path.name}: cancel-in-progress {cancel.group(1).strip() if cancel else "missing"}')
            
        self.assertEqual(offenders, [])

    def test_a_run_started_for_a_pr_cancels_that_pr_s_older_run_too(self):
        # pr-suites.yml starts e2e.yml and e2e-windows.yml for a PR (workflow_dispatch, so the check above never read them). 26 Oct 2026: the Windows smoke shared ONE
        # group with every Windows run and never cancelled: a PR's newer push queued behind betas, and GitHub dropped a second waiter in that group.
        dispatched = set(re.findall(r'(?:gh workflow run|dispatch) ([\w.-]+\.yml)', (WORKFLOWS / 'pr-suites.yml').read_text(encoding='utf-8')))
        self.assertTrue({'e2e.yml', 'e2e-windows.yml'} <= dispatched, dispatched)
        for name in sorted(dispatched):
            text = (WORKFLOWS / name).read_text(encoding='utf-8')
            groups, cancels = re.findall(r'group:\s*([^\n#]+)', text), re.findall(r'cancel-in-progress:\s*([^\n#]+)', text)
            pr = lambda value: 'inputs.pr_suites' in value or 'inputs.pr_steps' in value
            self.assertTrue(any(pr(g) and 'github.ref' in g for g in groups), f'{name}: no group per PR branch for a PR run')
            self.assertTrue(any(pr(c) for c in cancels), f'{name}: a PR run never cancels its older one')

    def test_the_called_suites_keep_a_group_per_commit_inside_the_caller(self):
        # build.yml (CI · Tests) is the one group on main (ci-tests-main, a started run finishes; only the waiting one is replaced); the suites it calls only need a group of their own
        for name in ('tests-python.yml', 'tests-worker.yml', 'tests-desktop.yml', 'tests-desktop-windows.yml'):
            text = (WORKFLOWS / name).read_text(encoding='utf-8')
            self.assertIn('github.sha', re.search(r'(?ms)^concurrency:[^\n]*\n(.*?)(?=^\S)', text).group(1), name)

    def test_the_big_matrices_are_capped_at_four(self):
        # owner, 15 Oct 2026: verdicts + refills held 23 queued jobs of the 20 runners; the replay matrices run at most 4 at a time
        for name in ('fix-verdicts.yml', 'replay-refill.yml', 'site-replays.yml'):
            text = (WORKFLOWS / name).read_text(encoding='utf-8')
            self.assertRegex(text, r'max-parallel: [1-4]\b', name)

    def test_a_closed_pr_cancels_its_remaining_runs(self):
        # 15 Oct 2026: the runs of a merged branch kept holding runners (five leftovers of #878)
        text = (WORKFLOWS / 'pr-closed-cancel.yml').read_text(encoding='utf-8')
        self.assertIn('pull_request_target:\n    types: [closed]', text)
        self.assertNotIn('actions/checkout', text, 'main\'s copy runs; the PR\'s code is never checked out')
        self.assertIn('actions: write', text)
        self.assertIn('github.event.pull_request.head.repo.full_name == github.repository', text, 'a fork\'s PR is skipped')
        for status in ('queued', 'in_progress'): self.assertIn(status, text)

    def test_a_closed_pr_never_cancels_the_runs_of_a_new_pr_on_the_same_branch_name(self):
        # 16 Oct 2026: #1048 merged, a new PR #1056 reused the branch name and pushed 10 s before the cancel job started: every run of #1056 was cancelled.
        # Only runs created up to the close belong to the closed PR; later ones belong to whatever PR uses the name now.
        text = (WORKFLOWS / 'pr-closed-cancel.yml').read_text(encoding='utf-8')
        self.assertIn('CLOSED_AT: ${{ github.event.pull_request.closed_at }}', text)
        match = re.search(r"-q '([^']*select\(\.createdAt <= env\.CLOSED_AT[^']*)'", text)
        self.assertTrue(match, 'the listing keeps only runs created up to the close')
        if not shutil.which('jq'): self.skipTest('jq is not installed')
        runs = [{'databaseId': 1, 'createdAt': '2026-10-16T18:20:30Z'}, {'databaseId': 2, 'createdAt': '2026-10-16T18:58:57Z'},
                {'databaseId': 3, 'createdAt': '2026-10-16T19:00:09Z'}]   # the last one is a new PR's, after the close at 18:58:57Z
        out = subprocess.run(['jq', '-r', match.group(1)], input=json.dumps(runs), capture_output=True, text=True, check=True,
                             env={'CLOSED_AT': '2026-10-16T18:58:57Z', 'PATH': os.environ['PATH']}).stdout
        self.assertEqual(out.split(), ['1', '2'])

    def test_the_by_hand_exceptions_still_exist(self):
        for name in NOT_CANCELLED: self.assertTrue((WORKFLOWS / name).exists(), name)


if __name__ == '__main__':
    unittest.main()
