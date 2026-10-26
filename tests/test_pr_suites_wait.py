"""A PR's e2e run blocks its merge: tools/pr-suites-wait.sh fails on a red run (gate G1a, 26 Oct 2026: two PRs merged with cardstates red on their own run)."""
import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WAIT = ROOT / 'tools/pr-suites-wait.sh'
WORKFLOW = ROOT / '.github/workflows/pr-suites.yml'
SHA = 'a' * 40

FAKE_GH = r'''#!/usr/bin/env python3
# a fake `gh api`: the run list, one run's status (a sequence, one step per call) and its jobs
import json, os, sys
state = os.environ['FAKE_GH']
args = sys.argv[1:]
endpoint = args[1]
jq = args[args.index('--jq') + 1] if '--jq' in args else ''
data = json.load(open(os.path.join(state, 'data.json')))
if 'workflows/e2e.yml/runs' in endpoint:
    for run in data['runs']:
        if run['head_sha'] == os.environ['SHA'] and run['created_at'] >= os.environ['SINCE']:
            print(run['id'])
elif endpoint.endswith('/jobs?per_page=100'):
    jobs = [{'status': 'completed' if j.get('conclusion') else 'in_progress', 'started_at': '2026-10-26T02:54:04Z',
             'completed_at': '2026-10-26T02:57:10Z' if j.get('conclusion') else None, **j} for j in data['jobs']]
    print(json.dumps({'jobs': jobs}))
elif '/actions/runs/' in endpoint:
    count_file = os.path.join(state, 'calls')
    n = int(open(count_file).read()) if os.path.exists(count_file) else 0
    open(count_file, 'w').write(str(n + 1))
    seq = data['status']
    print(seq[min(n, len(seq) - 1)])
else:
    sys.exit(2)
'''


def run_wait(data, since='2026-10-25T13:00:00Z', wait_s=20):   # 20 s: each fake gh call starts python; 2 s timed out a green run on a busy Mac
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / 'bin').mkdir()
        gh = tmp / 'bin/gh'
        gh.write_text(FAKE_GH)
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        (tmp / 'data.json').write_text(json.dumps(data))
        summary = tmp / 'summary.md'
        env = {**os.environ, 'PATH': f"{tmp / 'bin'}{os.pathsep}{os.environ['PATH']}", 'FAKE_GH': str(tmp), 'SHA': SHA, 'SINCE': since,
               'PR_SUITES_POLL': '0', 'PR_SUITES_FIND_S': '1', 'PR_SUITES_WAIT_S': str(wait_s), 'GITHUB_STEP_SUMMARY': str(summary)}
        proc = subprocess.run(['bash', str(WAIT), 'GarryOne/jobadabra', 'compact-run-banner', SHA, since], env=env, capture_output=True, text=True, timeout=60)
        return proc.returncode, proc.stdout + proc.stderr, summary.read_text() if summary.exists() else ''


class PrSuitesWait(unittest.TestCase):
    def test_red_run_fails_and_names_the_suite(self):
        # The 25 Oct case: compact-run-banner's own run had cardstates red, and the PR merged.
        code, out, summary = run_wait({'runs': [{'id': 40213000001, 'head_sha': SHA, 'created_at': '2026-10-25T13:21:00Z'}],
                                       'status': ['in_progress -', 'completed failure'],
                                       'jobs': [{'name': 'cardstates', 'conclusion': 'failure'}, {'name': 'activity', 'conclusion': 'success'}]})
        self.assertEqual(code, 1, out)
        self.assertIn('cardstates', summary)
        self.assertNotIn('activity', summary.split('E2E suites red')[1])
        self.assertIn('actions/runs/40213000001', summary)

    def test_the_first_red_suite_fails_at_once_without_waiting_for_the_rest(self):
        # 26 Oct 2026, #1992: wander and quality were red at 02:12; the wait went on for the whole run (31 min) before blocking.
        code, out, summary = run_wait({'runs': [{'id': 40257076325, 'head_sha': SHA, 'created_at': '2026-10-25T13:00:05Z'}],
                                       'status': ['in_progress -'],
                                       'jobs': [{'name': 'wander', 'conclusion': 'failure'}, {'name': 'apply', 'conclusion': None}]})
        self.assertEqual(code, 1, out)
        self.assertNotIn('still running', out, 'it stops at the first red job, not at the time limit')
        self.assertIn('wander', summary)
        self.assertIn('not waiting for the others', summary)

    def test_green_run_passes(self):
        code, out, summary = run_wait({'runs': [{'id': 7, 'head_sha': SHA, 'created_at': '2026-10-25T13:00:05Z'}],
                                       'status': ['queued -', 'in_progress -', 'completed success'], 'jobs': []})
        self.assertEqual(code, 0, out)
        self.assertIn('passed', summary)

    def test_an_older_run_of_the_same_commit_is_not_taken(self):
        # A run started before this dispatch belongs to an earlier push: never its verdict.
        code, out, _ = run_wait({'runs': [{'id': 6, 'head_sha': SHA, 'created_at': '2026-10-25T12:59:00Z'}], 'status': ['completed success'], 'jobs': []})
        self.assertEqual(code, 1, out)
        self.assertIn('No e2e run', out)

    def test_a_run_that_never_ends_fails_by_name(self):
        code, out, _ = run_wait({'runs': [{'id': 8, 'head_sha': SHA, 'created_at': '2026-10-25T13:00:01Z'}], 'status': ['in_progress -'], 'jobs': []}, wait_s=2)
        self.assertEqual(code, 1, out)
        self.assertIn('still running', out)

    def test_cancelled_is_not_green(self):
        code, out, _ = run_wait({'runs': [{'id': 9, 'head_sha': SHA, 'created_at': '2026-10-25T13:00:01Z'}], 'status': ['completed cancelled'], 'jobs': []})
        self.assertEqual(code, 1, out)


    def test_all_suites_green_passes_without_waiting_for_the_report_job(self):
        # 26 Oct 2026, #2017: every suite was green at 03:01; the check waited to 03:06 for "HTML report", which gates nothing.
        code, out, summary = run_wait({'runs': [{'id': 40261336581, 'head_sha': SHA, 'created_at': '2026-10-25T13:00:05Z'}],
                                       'status': ['in_progress -'],
                                       'jobs': [{'name': 'plan', 'conclusion': 'success'}, {'name': 'jobs', 'conclusion': 'success'},
                                                {'name': 'activity', 'conclusion': 'success'}, {'name': 'HTML report', 'conclusion': None, 'status': 'queued'}]})
        self.assertEqual(code, 0, out)
        self.assertNotIn('still running', out)
        self.assertIn('2 of 2 suites passed', out)

    def test_it_says_what_it_waits_for(self):
        # 26 Oct 2026, the owner at 12 minutes: "Why I cannot see what's happening? Why its waiting? For what? I see no logs, no updates".
        code, out, _ = run_wait({'runs': [{'id': 41, 'head_sha': SHA, 'created_at': '2026-10-25T13:00:05Z'}],
                                 'status': ['in_progress -'],
                                 'jobs': [{'name': 'plan', 'conclusion': 'success'}, {'name': 'jobs', 'conclusion': 'success'},
                                          {'name': 'quality', 'conclusion': None, 'status': 'in_progress'},
                                          {'name': 'stores', 'conclusion': None, 'status': 'queued', 'started_at': None}]}, wait_s=2)
        self.assertEqual(code, 1, out)   # the fake run never ends
        self.assertIn('1 of 3 suites passed', out)
        self.assertIn('✓ jobs', out)
        self.assertRegex(out, r'running: quality')
        self.assertRegex(out, r'waiting for a runner: stores')
        self.assertIn('actions/runs/41', out)


class AfterSuiteJobs(unittest.TestCase):
    def test_every_job_that_is_not_a_suite_is_named_in_the_script(self):
        # The wait judges suites only; a new job in e2e.yml (a report, an alert) must be listed or it would count as a suite.
        import re
        names = set()
        for block in re.split(r'\n  (?=[a-z][a-z0-9_-]*:\n)', (ROOT / '.github/workflows/e2e.yml').read_text().split('\njobs:\n', 1)[1]):
            job_id = block.split(':', 1)[0].strip()
            if job_id == 'suite': continue
            m = re.search(r'^    name: (.+)$', block, re.M)
            names.add(m.group(1).strip() if m else job_id)
        listed = set(json.loads(re.search(r"NOT_SUITES='(\[.*?\])'", WAIT.read_text()).group(1)))
        self.assertEqual(names, listed)


class Workflow(unittest.TestCase):
    def test_pr_suites_report_only_until_steps_land(self):
        # owner, 26 Oct 2026: "all my PRs are being blocked from merge" / "How we can unblock the situation" -> "Report-only + cap 4":
        # a PR's suites run but never hold a runner to wait or block the merge, at most 4 per PR, until the per-step selection lands
        text = WORKFLOW.read_text()
        self.assertNotIn('tools/pr-suites-wait.sh', text, 'no job holds a runner to wait for the e2e run')
        self.assertIn('REPORT ONLY', text)
        self.assertRegex(text, r'timeout-minutes: 15\b')


if __name__ == '__main__':
    unittest.main()
