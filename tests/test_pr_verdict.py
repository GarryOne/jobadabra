"""The PR's one required status, "All checks passed", is written by tools/pr-verdict.py as the last step of every PR job: no job holds or waits for a runner for it.
#2042/#2044 (owner, 26 Oct 2026: "it shows green, but I cannot merge" / "again, why I cannot merge this PR?"): a separate verdict job, and e2e's HTML report, sat
queued for a runner after every check was green.
Why (owner, 26 Oct 2026: "How could you design such a slow and inefficient method of checking PRs?"): on #1992 two jobs only waited (pr-gate's
"Other workflows passed" and pr-suites' wait), 43 of 206 runner-minutes of one push, while its suite jobs queued up to 17.5 min for a runner.
Also the 10-min budget: a CI change whose own checks take longer goes red (history: 781637a, bc585e3, a7a6a9f, 7083bb7 each slowed PRs, none said by how much)."""
import datetime
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
        for file in ['.github/workflows/pr-suites.yml', '.github/actions/free-ai-relay/action.yml', 'tools/pr-verdict.py', 'desktop/e2e/lib/plan.mjs', 'desktop/e2e/pr-suites.mjs', 'desktop/e2e/plan-run.mjs']:
            self.assertTrue(pv.ci_change([file]), file)
        self.assertFalse(pv.ci_change(['tools/ship.sh', 'desktop/e2e/suites/jobs.mjs']))

    def test_a_workflow_no_pr_runs_is_not_a_ci_change(self):
        # #2137 went red at 11.4 min, every check green, only because it edited the users' Always On workflows (daily/scout/mail.yml: workflow_call), which no PR runs.
        slow = [run('CI · Pull request', end='2026-10-26T03:14:00Z')]
        always_on = ['.github/workflows/daily.yml', '.github/workflows/scout.yml', '.github/workflows/mail.yml']
        self.assertFalse(pv.ci_change(always_on))
        self.assertEqual(pv.verdict(slow, files=always_on)[0], 'success')
        for name in ['e2e.yml', 'pr-suites.yml', 'e2e-windows.yml']:   # dispatched by a PR workflow, or one itself
            self.assertTrue(pv.ci_change([f'.github/workflows/{name}']), name)

    def test_the_pr_workflows_list_is_every_workflow_a_pr_can_start(self):
        # A pull_request trigger, or started by a workflow a PR runs (gh workflow run X, pr-suites' dispatch X, uses: ./.github/workflows/X), followed to the end. A new PR workflow fails here.
        texts = {path.name: path.read_text(encoding='utf-8') for path in WORKFLOWS.glob('*.yml')}
        reach = {name for name, text in texts.items() if re.search(r'(?m)^  pull_request(_target)?:|^on:.*\bpull_request\b', text)}
        while True:
            more = {name for name in texts if name not in reach and any(re.search(r'(?m)^[^#\n]*(\bworkflow run\s+|\bdispatch\s+|uses:\s*\./\.github/workflows/)%s\b' % re.escape(name), texts[known]) for known in reach)}
            if not more: break
            reach |= more
        self.assertEqual(set(pv.PR_WORKFLOWS), reach, 'pr-verdict.py PR_WORKFLOWS: the workflows a PR can start')

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
        self.assertNotIn('CI · Prompt cases (Haiku re-ask)', prs, 'paid Haiku checks are manually dispatched, never an automatic PR workflow')
        verdict = (WORKFLOWS / 'pr-verdict.yml').read_text()
        listed = set(re.findall(r"(?m)^      - '(.+)'$", verdict))
        self.assertEqual(prs - listed, set(), 'add it to pr-verdict.yml workflow_run.workflows')
        self.assertIn('CI · End-to-end on Mac + Linux', listed, "the e2e run a PR starts (pr-suites.yml) is judged when it ends")
        self.assertNotIn('CI · Prompt cases (Haiku re-ask)', listed, 'a manual run must not participate in the PR verdict')

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
            if not (re.search(r'(?m)^  pull_request:', trigger) or path.name in ('e2e.yml', 'e2e-windows.yml')):
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
                if cond and ('refs/heads/main' in cond.group(1) or "github.event_name == 'schedule'" in cond.group(1) or "inputs.tag != ''" in cond.group(1)):
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
        self.assertLess(suites.index('!= OPEN'), suites.index('dispatch e2e.yml'))


    def test_a_ci_or_shell_pr_runs_one_short_windows_check(self):
        # #1997: the relay's tar broke every Windows suite, seen only by the next beta. pr-suites.mjs says windows=1 (lib/pr-suites.mjs windowsSmoke).
        suites = (WORKFLOWS / 'pr-suites.yml').read_text(); win = (WORKFLOWS / 'e2e-windows.yml').read_text()
        trigger = suites.split('\npermissions:')[0]
        for path in ("'.github/**'", "'tools/*.sh'", "'desktop/scripts/*.sh'"):
            self.assertIn(path, trigger)
        self.assertRegex(suites, r"gh workflow run e2e-windows\.yml --ref \"\$HEAD_REF\" -f suites=settings -f pr_steps=")
        self.assertIn("inputs.pr_steps && format('E2E for PR · windows {0} · {1}'", win, 'the verdict counts it by its title')
        self.assertIn("E2E_STEP_NAMES: ${{ inputs.pr_steps }}", win)
        self.assertIn("E2E_STORE: ${{ inputs.pr_steps != '' && 'sqlite' || '' }}", win)
        self.assertRegex(win, r"Take the suite's lock[^\n]*\n        if: inputs\.pr_steps == ''", 'a PR check on SQLite needs no Notion page: it never waits for the lock on a runner')

    def test_the_backstop_skips_a_replaced_commit_and_keeps_one_per_pr(self):
        # 27 Oct 2026: 22 queued verdicts for commits no open PR had as its head, each waiting for a runner under GitHub's 20-job cap.
        text = (WORKFLOWS / 'pr-verdict.yml').read_text()
        job = text.split('\n  verdict:\n', 1)[1]
        condition = job.split('    if: >-\n', 1)[1].split('\n    runs-on:', 1)[0]
        self.assertIn("github.event.workflow_run.head_sha == github.event.workflow_run.pull_requests[0].head.sha", condition, 'a replaced commit or a merged PR is skipped')
        header = text.split('\njobs:\n', 1)[0]
        group = header.split('concurrency:\n', 1)[1].split('\n  cancel-in-progress:', 1)[0]
        self.assertIn("&& github.event.workflow_run.head_branch || 'skipped'", group, 'one verdict per PR branch, not per commit')
        # Review on #2248: concurrency applies before `if:`, so an event the job skips must not share the branch group (it would replace the head's waiting verdict).
        self.assertIn(' '.join(condition.split()), ' '.join(group.split()), 'the group picks the branch by the same condition the job runs on')

    def test_the_budget_counts_running_time_not_the_wait_for_a_runner(self):
        # Owner, 27 Oct 2026: "Count running time only". #2215: 12.4 min in all, its jobs waited for runners most of it; a run of 11 min stays red.
        slow = [run('CI · Pull request', at='2026-10-27T05:00:00Z', end='2026-10-27T05:12:24Z')]
        queued = [('2026-10-27T05:03:00Z', '2026-10-27T05:05:30Z'), ('2026-10-27T05:04:00Z', '2026-10-27T05:06:00Z'), ('2026-10-27T05:08:00Z', '2026-10-27T05:12:24Z')]
        state, why, *_ = pv.verdict(slow, files=['.github/workflows/e2e.yml'], spans=queued)
        self.assertEqual(state, 'success', why)
        self.assertIn('7.4 min running + 5.0 min waiting for runners', why)
        long = [('2026-10-27T05:00:30Z', '2026-10-27T05:11:30Z')]
        state, why, *_ = pv.verdict(slow, files=['.github/workflows/e2e.yml'], spans=long)
        self.assertEqual(state, 'failure')
        self.assertIn('checks ran 11.0 min running', why)
        self.assertEqual(pv.verdict(slow, files=['.github/workflows/e2e.yml'])[0], 'failure', 'no job times read: the wall time, as before')

    def test_running_minutes_count_parallel_jobs_once(self):
        self.assertAlmostEqual(pv.running_minutes([('2026-10-27T05:00:00Z', '2026-10-27T05:04:00Z'), ('2026-10-27T05:01:00Z', '2026-10-27T05:03:00Z'),
                                                   ('2026-10-27T05:10:00Z', '2026-10-27T05:11:00Z'), (None, None)]), 5.0)
        self.assertIsNone(pv.running_minutes([(None, None)]))


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
        self.assertEqual(why, 'e2e settings, apply running since 04:02 Zurich')
        self.assertEqual(pv.verdict([run('CI · Pull request'), e2e], now=NOW)[1], 'e2e settings,apply running since 04:02 Zurich')

    def test_a_waiting_text_is_true_whenever_it_is_read(self):
        # 26 Oct 2026, the owner: "it stays like that: 'waiting 3 min: e2e quality' for more than 5 minutes. this is a bug". The status is written only when a job
        # ends, so a minutes-so-far counter froze between writes. A pending or settling text names a clock time, never a count up to now.
        e2e = run(E2E, status='in_progress', event='workflow_dispatch', title='E2E for PR · quality · b', id=3, at='2026-10-26T03:02:00Z')
        settle = run(E2E, status='in_progress', event='workflow_dispatch', title='E2E for PR · settings · b', id=4)
        cases = [([run('CI · Pull request'), e2e], {3: [job(30, 'plan'), job(31, 'quality', status='in_progress')]}),
                 ([run('CI · Pull request'), e2e], None),
                 ([run('CI · Pull request', status='in_progress')], None),
                 ([run('CI · Pull request'), settle], {4: [job(40, 'plan')]})]
        later = NOW + datetime.timedelta(minutes=17)
        for runs, jobs in cases:
            state, why, *_ = pv.verdict(runs, jobs=jobs, now=NOW)
            self.assertIn(state, ('pending', 'settling'))
            self.assertEqual(pv.verdict(runs, jobs=jobs, now=later)[1], why, f'{state}: the text changed with the clock')
            self.assertNotRegex(why, r'\d+(\.\d+)? ?min', f'{state}: a counter freezes between writes: {why}')

    def test_a_merged_or_closed_pr_gets_nothing(self):
        # #2041: merged by override, then a late job wrote "All checks passed: failure" on the merged head
        self.assertEqual(pv.open_pr([{'number': 2041, 'state': 'closed', 'merged_at': '2026-10-26T04:00:00Z'}]), ('', False))
        self.assertEqual(pv.open_pr([{'number': 2044, 'state': 'open', 'merged_at': None}]), ('2044', True))
        self.assertEqual(pv.open_pr([]), ('', True))

def meta_answer(*prs):
    return json.dumps({'data': {'repository': {'object': {'associatedPullRequests': {'nodes': list(prs)}}}}})


def gql_pr(number=7, state='OPEN', merged=None, files=('desktop/a.js',), more=False, messages=('Fix a thing',)):
    return {'number': number, 'state': state, 'mergedAt': merged, 'files': {'pageInfo': {'hasNextPage': more}, 'nodes': [{'path': f} for f in files]},
            'commits': {'nodes': [{'commit': {'message': m}} for m in messages]}}


class TheVerdictReadsThePrInOneCall(unittest.TestCase):
    """29 Oct 2026, api-quota: the verdict made 3 REST calls (the commit's PRs, its files, its commit messages) before reading any run, in ~218 runs an hour at peak, on
    Actions' 1,000-an-hour GITHUB_TOKEN quota shared with every workflow; the 403s turned unrelated PRs red. One GraphQL call (its own bucket) carries all three."""

    def read(self, *prs):
        asked = []
        def fake(*args):
            asked.append(args); return meta_answer(*prs)
        return pv.pr_meta('o/r', 'abc1234', fake), asked

    def test_one_call_gives_the_open_pr_its_files_and_messages(self):
        (pulls, files, messages), asked = self.read(gql_pr(7, files=('a.js', 'b.py'), messages=('one', 'two')))
        self.assertEqual(len(asked), 1)
        self.assertEqual(pv.open_pr(pulls), ('7', True))
        self.assertEqual((files, messages), (['a.js', 'b.py'], ['one', 'two']))

    def test_a_merged_pr_still_gets_nothing(self):
        (pulls, _, _), _ = self.read(gql_pr(8, state='MERGED', merged='2026-10-29T00:06:00Z'))
        self.assertEqual(pv.open_pr(pulls), ('', False))
        (pulls, _, _), _ = self.read(gql_pr(9, state='CLOSED'))
        self.assertEqual(pv.open_pr(pulls), ('', False))

    def test_with_the_open_pr_among_closed_ones_its_own_files_are_used(self):
        (pulls, files, _), _ = self.read(gql_pr(5, state='CLOSED', files=('old.js',)), gql_pr(6, files=('new.js',)))
        self.assertEqual((pv.open_pr(pulls), files), (('6', True), ['new.js']))

    def test_a_pr_of_over_100_files_is_read_over_rest_not_cut_short(self):
        (pulls, files, messages), _ = self.read(gql_pr(7, more=True))
        self.assertIsNone(files, 'a cut file list would hide a CI change from the budget check')

    def test_the_log_says_how_much_of_each_quota_is_left(self):
        # Nothing logged the GITHUB_TOKEN quota: "most of it" was arithmetic from run counts. rate_limit costs no call.
        line = pv.quota_line(lambda *a: json.dumps({'resources': {'core': {'remaining': 412, 'limit': 1000}, 'graphql': {'remaining': 4950, 'limit': 5000}}}))
        self.assertEqual(line, 'quota left: REST 412/1000, GraphQL 4950/5000')

    def test_a_quota_read_that_fails_never_fails_the_run(self):
        def refuse(*a): raise subprocess.CalledProcessError(1, ['gh'])
        self.assertEqual(pv.quota_line(refuse), '')

    def test_a_failed_call_prints_gh_s_own_message_and_still_raises(self):
        # stderr was captured and dropped: the 403 of 23:29Z showed only "returned non-zero exit status 1". Still a CalledProcessError: health_greys catches Exception per job.
        import contextlib, io
        from unittest import mock
        boom = subprocess.CalledProcessError(1, ['gh'], stderr='API rate limit exceeded for installation')
        seen = io.StringIO()
        with mock.patch.object(pv.subprocess, 'run', side_effect=boom), contextlib.redirect_stderr(seen), self.assertRaises(subprocess.CalledProcessError):
            pv.gh('api', 'x')
        self.assertIn('API rate limit exceeded', seen.getvalue())


FAKE_GH = r"""#!/usr/bin/env python3
import json, os, sys
a = sys.argv[1:]; d = os.environ['FAKE_DIR']
def out(name): sys.stdout.write(open(os.path.join(d, name)).read())
if a[:2] == ['run', 'list']: out('runs.json')
elif a[0] == 'api' and a[1] == 'graphql': out('meta.json')   # the PR's state, files and messages in one call; no REST answer for them: a call back to REST must fail the test
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
        json.dump(runs, open(os.path.join(d, 'runs.json'), 'w')); open(os.path.join(d, 'meta.json'), 'w').write(meta_answer(*[gql_pr(p['number'], p['state'].upper(), p['merged_at'], files=('desktop/renderer/app.js',)) for p in pulls]))
        json.dump([{'id': 20, 'name': 'python', 'status': 'in_progress', 'conclusion': None, 'runner_name': 'r1',
                    'steps': [{'name': 'Run tests', 'status': 'completed', 'conclusion': 'success'}, {'name': pv.STEP, 'status': 'in_progress'}]}],
                  open(os.path.join(d, 'jobs-2.json'), 'w'))
        env = dict(os.environ, PATH=bin_dir + os.pathsep + os.environ['PATH'], FAKE_DIR=d, GITHUB_RUN_ID='2', RUNNER_NAME='r1')
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

    def test_gh_output_is_read_as_utf8_on_any_runner(self):
        # #2062: on Windows, text=True decoded gh's UTF-8 as cp1252; "E2E for PR · " did not match and the e2e runs were not counted (a false green).
        from unittest import mock
        with mock.patch.object(pv.subprocess, 'run', return_value=mock.Mock(stdout='[]')) as run_:
            pv.gh('run', 'list')
        self.assertEqual(run_.call_args.kwargs.get('encoding'), 'utf-8')
        self.assertNotIn('text', run_.call_args.kwargs, 'text=True uses the locale (cp1252 on Windows)')

    def test_a_merged_pr_gets_nothing(self):
        done, written = self.run_step([{'number': 7, 'state': 'closed', 'merged_at': '2026-10-26T04:59:23Z'}])
        self.assertEqual((done.returncode, written), (0, ''), done.stderr)


if __name__ == '__main__':
    unittest.main()
