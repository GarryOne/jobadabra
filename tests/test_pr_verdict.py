"""The PR's one required status, "All checks passed", is written by tools/pr-verdict.py as the last step of every PR job: no job holds or waits for a runner for it.
#2042/#2044 (owner, 26 Oct 2026: "it shows green, but I cannot merge" / "again, why I cannot merge this PR?"): a separate verdict job, and e2e's HTML report, sat
queued for a runner after every check was green.
Why (owner, 26 Oct 2026: "How could you design such a slow and inefficient method of checking PRs?"): on #1992 two jobs only waited (pr-gate's
"Other workflows passed" and pr-suites' wait), 43 of 206 runner-minutes of one push, while its suite jobs queued up to 17.5 min for a runner.
Also the 10-min budget: a CI change whose own checks take longer goes red (history: 781637a, bc585e3, a7a6a9f, 7083bb7 each slowed PRs, none said by how much)."""
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
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
        state, why, *_ = pv.verdict([run('CI · Pull request'), run('CI · Tests · python', conclusion='skipped')])
        self.assertEqual(state, 'success', why)
        self.assertIn('4.0 min', why)

    def test_pending_while_one_runs_and_red_at_once_when_one_failed(self):
        self.assertEqual(pv.verdict([run('CI · Pull request'), run('CI · Tests · python', status='in_progress')])[0], 'pending')
        state, why, *_ = pv.verdict([run('CI · Tests · python', conclusion='failure'), run('CI · Tests · desktop', status='in_progress')])
        self.assertEqual(state, 'failure')
        self.assertIn('Tests · python', why)

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
        state, why, *_ = pv.verdict(slow, files=['.github/workflows/e2e.yml'])
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

    def test_the_pr_e2e_run_says_its_suites_in_its_title(self):
        e2e = (WORKFLOWS / 'e2e.yml').read_text()
        self.assertIn("inputs.pr_suites && format('E2E for PR · {0} · {1}', inputs.pr_suites, github.ref_name)", e2e)
        self.assertEqual(pv.E2E_PR_TITLE, 'E2E for PR · ')

    def test_every_pr_job_writes_the_verdict_as_its_last_step(self):
        # The class: every job a PR can run. Exempt: report jobs (never decide), jobs only main runs, and e2e's plan (its suites need it: its step would see its
        # run as ended before the suite jobs exist).
        step_re = re.compile(r"      # The PR's one required status, written as this job ends[^\n]*\n      - name: " + re.escape(pv.STEP) + r"\n        if: always\(\) && (github\.event_name == 'pull_request'|inputs\.pr_suites != '')[^\n]*\n([\s\S]*?)\n(?=  [A-Za-z0-9_-]+:|\Z|\n)")
        seen, exempt = 0, set()
        for path in WORKFLOWS.glob('*.yml'):
            text = path.read_text(); trigger = text.split('\njobs:')[0]
            if not (re.search(r'(?m)^  pull_request:', trigger) or path.name == 'e2e.yml'):
                continue
            jobs = re.split(r'(?m)^(?=  [A-Za-z0-9_-]+:\s*(?:#.*)?$)', text.split('\njobs:\n', 1)[1])
            needed = set()   # jobs a deciding job needs
            for other in jobs:
                other_name = re.search(r'(?m)^    name:\s*(.+?)\s*$', other)
                other_if = re.search(r'(?m)^    if:\s*(.+)$', other)
                if (other_name and other_name.group(1).strip('\'"') in pv.REPORT_JOBS) or '\n    steps:' not in other: continue
                if other_if and ('refs/heads/main' in other_if.group(1) or "github.event_name == 'schedule'" in other_if.group(1)): continue   # main's jobs only
                for need in re.findall(r'(?m)^    needs:\s*\[?([^\]\n#]+)', other): needed |= {n.strip() for n in need.split(',')}
            for job in jobs:
                key = job.split(':', 1)[0].strip(); name = re.search(r'(?m)^    name:\s*(.+?)\s*$', job); cond = re.search(r'(?m)^    if:\s*(.+)$', job)
                if '\n    steps:' not in job or (name and name.group(1).strip('\'"') in pv.REPORT_JOBS) or key in needed:
                    self.assertNotIn(pv.STEP, job, f'{path.name} {key}: a report job, or one a deciding job needs (it would see its run ended before them)')
                    exempt.add((path.name, key)); continue
                if cond and ('refs/heads/main' in cond.group(1) or "github.event_name == 'schedule'" in cond.group(1)):
                    continue
                with self.subTest(workflow=path.name, job=key):
                    steps = re.findall(r'(?m)^      - (?:name|uses): *(.+)$', job)
                    self.assertTrue(steps and steps[-1] == pv.STEP, f'last step is {steps[-1:]}: add the "{pv.STEP}" step (copy it from tests-python.yml)')
                    self.assertIn('--job-status "$JOB_STATUS"', job)
                    for perm in ('actions: read', 'statuses: write', 'pull-requests: read'):
                        self.assertTrue(perm in job or perm in text.split('\njobs:')[0] or (perm == 'actions: read' and 'actions: write' in trigger), f'{perm} for the verdict')
                    seen += 1
        self.assertGreaterEqual(seen, 14, 'positive control: the PR jobs were found')
        self.assertIn(('e2e.yml', 'plan'), exempt, 'positive control: e2e\'s plan is needed by its suites')
        self.assertIn(('page-cases.yml', 'replay'), exempt, 'positive control: page-cases\' replays are needed by its report')
        self.assertNotIn('Turn the PR red now', (WORKFLOWS / 'e2e.yml').read_text(), 'the suite job\'s verdict step turns it red as it ends')

    def test_no_e2e_run_for_a_merged_or_closed_pr(self):
        # #2041: an override merge deleted the branch; pr-suites' dispatch then failed (HTTP 422 "No ref found") and the merged head went red.
        suites = (WORKFLOWS / 'pr-suites.yml').read_text()
        self.assertRegex(suites, r'gh pr view "\$PR"[^\n]*--json state[^\n]*!= OPEN[^\n]*skipped=1[^\n]*exit 0')
        self.assertIn("steps.start.outputs.skipped != '1'", suites)
        self.assertLess(suites.index('!= OPEN'), suites.index('gh workflow run e2e.yml'))


def job(id, name, status='completed', conclusion='success', steps=None, runner=''):
    return {'id': id, 'name': name, 'status': status, 'conclusion': conclusion if status == 'completed' else None, 'runner_name': runner,
            'steps': steps if steps is not None else [{'name': 'Run tests', 'status': 'completed', 'conclusion': 'success'}]}


def ending(id, name, conclusion='success'):
    """A job whose own work ended; only its verdict step and clean-up are left."""
    return job(id, name, status='in_progress', steps=[{'name': 'Run tests', 'status': 'completed', 'conclusion': conclusion},
                                                      {'name': pv.STEP, 'status': 'in_progress'}, {'name': 'Post Run actions/checkout@v5', 'status': 'queued'}])


NOW = pv._at('2026-10-26T03:10:00Z')
E2E = 'CI · End-to-end on Mac + Linux'


class JobByJob(unittest.TestCase):
    def test_the_job_writing_counts_itself_ended_with_its_status(self):
        runs = [run('CI · Pull request'), run('CI · Tests · python', status='in_progress', id=2)]
        jobs = {2: [job(20, 'python', status='in_progress', steps=[{'name': pv.STEP, 'status': 'in_progress'}], runner='r1')]}
        state, why, _, finishing, _ = pv.verdict(runs, jobs=jobs, me=20, my_status='success', now=NOW)
        self.assertEqual((state, finishing), ('success', []), why)
        self.assertEqual(pv.verdict(runs, jobs=jobs, me=20, my_status='failure', now=NOW)[0], 'failure')
        state, _, _, finishing, _ = pv.verdict(runs, jobs=jobs, now=NOW)
        self.assertTrue(pv.leave_it(finishing, None), 'the backstop leaves it to the job ending')
        jobs[2][0]['steps'] = [{'name': 'Run tests', 'status': 'in_progress'}, {'name': pv.STEP, 'status': 'queued'}]
        self.assertEqual(pv.verdict(runs, jobs=jobs, now=NOW)[0], 'pending', 'its tests still run')

    def test_44_a_report_job_queued_for_a_runner_never_holds_the_verdict(self):
        # #2044: settings green at 04:36, e2e's "HTML report" queued for a runner, the PR could not merge
        e2e = run(E2E, status='in_progress', event='workflow_dispatch', title='E2E for PR · settings · apply-split', id=3)
        jobs = {3: [job(30, 'plan'), job(31, 'settings', status='in_progress', steps=[{'name': 'Run', 'status': 'completed', 'conclusion': 'success'}, {'name': pv.STEP, 'status': 'in_progress'}], runner='r9'),
                    job(32, 'HTML report', status='queued', steps=[]), job(33, 'Telegram alert', conclusion='skipped')]}
        self.assertEqual(pv.verdict([run('CI · Pull request'), e2e], jobs=jobs, me=31, my_status='success', now=NOW)[0], 'success')
        jobs[3][3] = job(33, 'HTML report', conclusion='failure')
        self.assertEqual(pv.verdict([run('CI · Pull request'), e2e], jobs={3: jobs[3][:2] + jobs[3][3:]}, me=31, my_status='success', now=NOW)[0], 'success')

    def test_jobs_ending_together_the_highest_id_writes(self):
        runs = [run('CI · Tests · python', status='in_progress', id=2), run('CI · Tests · worker', status='in_progress', id=4)]
        jobs = {2: [ending(20, 'python')], 4: [ending(40, 'worker')]}
        state, _, _, finishing, _ = pv.verdict(runs, jobs=jobs, me=40, my_status='success', now=NOW)
        self.assertEqual((state, finishing), ('success', [20]))
        self.assertFalse(pv.leave_it(finishing, 40), 'the highest waits for 20 to end, then writes')
        self.assertTrue(pv.leave_it(pv.verdict(runs, jobs=jobs, me=20, my_status='success', now=NOW)[3], 20), '20 leaves it to 40')
        self.assertTrue(pv.leave_it([20], None), 'the backstop leaves it to the jobs ending')
        self.assertEqual(pv.verdict(runs, jobs={2: [ending(20, 'python', 'failure')], 4: jobs[4]}, me=40, my_status='success', now=NOW)[0], 'success',
                         'a step that failed is not the job\'s end: it is read once the job ended')

    def test_a_run_whose_jobs_ended_but_not_itself_is_waited_on(self):
        # e2e between its plan and the suite jobs the plan's outputs create: never green then
        e2e = run(E2E, status='in_progress', event='workflow_dispatch', title='E2E for PR · settings · b', id=3)
        runs = [run('CI · Tests · python', status='in_progress', id=2), e2e]
        jobs = {2: [job(20, 'python', status='in_progress', steps=[{'name': pv.STEP, 'status': 'in_progress'}], runner='r1')], 3: [job(30, 'plan')]}
        self.assertEqual(pv.verdict(runs, jobs=jobs, me=20, my_status='success', now=NOW)[0], 'settling')

    def test_pending_names_the_e2e_suites_running_and_links_that_run(self):
        e2e = run(E2E, status='in_progress', event='workflow_dispatch', title='E2E for PR · settings,apply · b', id=3, at='2026-10-26T03:02:00Z')
        jobs = {3: [job(30, 'plan'), job(31, 'settings', status='in_progress'), job(32, 'apply', status='queued', steps=[])]}
        state, why, _, _, target = pv.verdict([run('CI · Pull request'), e2e], jobs=jobs, now=NOW)
        self.assertEqual((state, target), ('pending', 3))
        self.assertEqual(why, 'waiting 10 min: e2e settings, apply')
        self.assertEqual(pv.verdict([run('CI · Pull request'), e2e], now=NOW)[1], 'waiting 10 min: e2e settings,apply')

    def test_a_merged_or_closed_pr_gets_nothing(self):
        # #2041: merged by override, then a late job wrote "All checks passed: failure" on the merged head
        self.assertEqual(pv.open_pr([{'number': 2041, 'state': 'closed', 'merged_at': '2026-10-26T04:00:00Z'}]), ('', False))
        self.assertEqual(pv.open_pr([{'number': 2044, 'state': 'open', 'merged_at': None}]), ('2044', True))
        self.assertEqual(pv.open_pr([]), ('', True))

FAKE_GH = r"""#!/usr/bin/env python3
import json, os, sys
a = sys.argv[1:]; d = os.environ['FAKE_DIR']
def out(name): sys.stdout.write(open(os.path.join(d, name)).read())
if a[:2] == ['run', 'list']: out('runs.json')
elif a[0] == 'api' and a[1].endswith('/pulls') and '/commits/' in a[1]: out('pulls.json')
elif a[0] == 'api' and '/pulls/' in ' '.join(a) and '/files' in ' '.join(a): print('desktop/renderer/app.js')
elif a[0] == 'api' and '/commits?' in a[1]: print('["Fix a thing"]')
elif a[0] == 'api' and '/jobs' in a[1]: out('jobs-' + a[1].split('/runs/')[1].split('/')[0] + '.json')
elif a[0] == 'api' and '/statuses/' in a[1]: open(os.path.join(d, 'written'), 'a').write(json.dumps(a[2:]) + chr(10))
else: sys.exit('fake gh: no answer for ' + repr(a))
"""


class TheScriptAsAJobRunsIt(unittest.TestCase):
    """The script end to end, as the step runs it (a file copied out of the repo, the real `gh` replaced): #2051 shipped with gh() deleted, every job's step
    crashed with NameError, continue-on-error hid it and only the backstop wrote the status. The unit tests above never ran main()."""

    def run_step(self, pulls, job_status='success'):
        d = tempfile.mkdtemp()
        bin_dir = os.path.join(d, 'bin'); os.mkdir(bin_dir)
        gh = os.path.join(bin_dir, 'gh'); open(gh, 'w').write(FAKE_GH.replace('/usr/bin/env python3', sys.executable)); os.chmod(gh, 0o755)
        runs = [run('CI · Pull request', id=1), run('CI · Tests · python', status='in_progress', id=2)]
        json.dump(runs, open(os.path.join(d, 'runs.json'), 'w')); json.dump(pulls, open(os.path.join(d, 'pulls.json'), 'w'))
        json.dump([{'id': 20, 'name': 'python', 'status': 'in_progress', 'conclusion': None, 'runner_name': 'r1',
                    'steps': [{'name': 'Run tests', 'status': 'completed', 'conclusion': 'success'}, {'name': pv.STEP, 'status': 'in_progress'}]}],
                  open(os.path.join(d, 'jobs-2.json'), 'w'))
        env = dict(os.environ, PATH=bin_dir + os.pathsep + os.environ['PATH'], FAKE_DIR=d, GITHUB_RUN_ID='2', RUNNER_NAME='r1', GITHUB_STEP_SUMMARY='')
        script = os.path.join(d, 'pr-verdict.py'); open(script, 'w').write((ROOT / 'tools' / 'pr-verdict.py').read_text())   # as the step does: a copy, no repo around it
        done = subprocess.run([sys.executable, script, '--repo', 'o/r', '--sha', 'abc1234', '--job-status', job_status], env=env, capture_output=True, text=True, timeout=60)
        written = open(os.path.join(d, 'written')).read() if os.path.exists(os.path.join(d, 'written')) else ''
        return done, written

    def test_the_last_job_writes_green_from_its_own_step(self):
        done, written = self.run_step([{'number': 7, 'state': 'open', 'merged_at': None}])
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn('"state=success"', written, done.stdout + done.stderr)
        self.assertIn('context=All checks passed', written)

    def test_its_own_red_is_written_at_once(self):
        done, written = self.run_step([{'number': 7, 'state': 'open', 'merged_at': None}], job_status='failure')
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn('"state=failure"', written)

    def test_a_merged_pr_gets_nothing(self):
        done, written = self.run_step([{'number': 7, 'state': 'closed', 'merged_at': '2026-10-26T04:59:23Z'}])
        self.assertEqual((done.returncode, written), (0, ''), done.stderr)


if __name__ == '__main__':
    unittest.main()
