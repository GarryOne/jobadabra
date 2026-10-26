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
    for job in data['jobs']:
        if job['conclusion'] == 'failure': print(job['name'])
elif '/actions/runs/' in endpoint:
    count_file = os.path.join(state, 'calls')
    n = int(open(count_file).read()) if os.path.exists(count_file) else 0
    open(count_file, 'w').write(str(n + 1))
    seq = data['status']
    print(seq[min(n, len(seq) - 1)])
else:
    sys.exit(2)
'''


def run_wait(data, since='2026-10-25T13:00:00Z'):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        (tmp / 'bin').mkdir()
        gh = tmp / 'bin/gh'
        gh.write_text(FAKE_GH)
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        (tmp / 'data.json').write_text(json.dumps(data))
        summary = tmp / 'summary.md'
        env = {**os.environ, 'PATH': f"{tmp / 'bin'}{os.pathsep}{os.environ['PATH']}", 'FAKE_GH': str(tmp), 'SHA': SHA, 'SINCE': since,
               'PR_SUITES_POLL': '0', 'PR_SUITES_FIND_S': '1', 'PR_SUITES_WAIT_S': '2', 'GITHUB_STEP_SUMMARY': str(summary)}
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
        code, out, _ = run_wait({'runs': [{'id': 8, 'head_sha': SHA, 'created_at': '2026-10-25T13:00:01Z'}], 'status': ['in_progress -'], 'jobs': []})
        self.assertEqual(code, 1, out)
        self.assertIn('still running', out)

    def test_cancelled_is_not_green(self):
        code, out, _ = run_wait({'runs': [{'id': 9, 'head_sha': SHA, 'created_at': '2026-10-25T13:00:01Z'}], 'status': ['completed cancelled'], 'jobs': []})
        self.assertEqual(code, 1, out)


class Workflow(unittest.TestCase):
    def test_pr_suites_waits_and_is_not_report_only(self):
        text = WORKFLOW.read_text()
        self.assertIn('tools/pr-suites-wait.sh', text, 'the PR run must wait for its e2e run, or a red suite does not block the merge')
        self.assertNotIn('report only', text.split('\n', 1)[0].lower())
        self.assertIn('github.event.pull_request.head.sha', text)


if __name__ == '__main__':
    unittest.main()
