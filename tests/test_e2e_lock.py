"""The e2e suite lock waits instead of dropping (beta 14, 24 Oct 2026: GitHub cancelled 12 jobs of a by-hand beta because a newer job queued into the same concurrency group)."""
import json
import os
import re
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / 'tools/e2e-lock.sh'
WORKFLOWS = ROOT / '.github/workflows'
# The jobs that run one suite on its one Notion page: every one of them takes the lock; none may queue through a concurrency group GitHub can drop a waiter from.
SUITE_JOBS = (('desktop.yml', 'test-mac'), ('desktop.yml', 'test-windows'), ('e2e.yml', 'suite'), ('e2e-windows.yml', 'suite'))

FAKE_GH = r'''#!/usr/bin/env python3
# a fake `gh api` over a folder: refs, commits and run statuses
import json, os, re, sys
state = os.environ['FAKE_GH']
def load(name):
    p = os.path.join(state, name)
    return json.load(open(p)) if os.path.exists(p) else {}
def save(name, data): json.dump(data, open(os.path.join(state, name), 'w'))
args = sys.argv[1:]
assert args[0] == 'api'
method = 'GET'; fields = {}; jq = ''; endpoint = ''
i = 1
while i < len(args):
    a = args[i]
    if a == '-X': method = args[i + 1]; i += 2
    elif a == '-f': k, v = args[i + 1].split('=', 1); fields[k] = v; i += 2
    elif a == '--jq': jq = args[i + 1]; i += 2
    else: endpoint = a; i += 1
refs, commits, runs = load('refs.json'), load('commits.json'), load('runs.json')
m = re.match(r'repos/[^/]+/[^/]+/(.*)', endpoint); path = m.group(1)
if method == 'POST' and path == 'git/commits':
    sha = '%040x' % (len(commits) + 1); commits[sha] = fields['message']; save('commits.json', commits); print(sha)
elif method == 'POST' and path == 'git/refs':
    name = fields['ref'].replace('refs/', '', 1)
    if os.environ.get('FAKE_POST_FAIL') == '422': print('{"message":"Validation Failed","status":"422"}'); sys.exit(1)
    if os.environ.get('FAKE_POST_FAIL'): print('{"message":"Resource not accessible by integration","status":"403"}'); sys.exit(1)
    if os.environ.get('FAKE_NEED_TOKEN') and os.environ.get('GH_TOKEN') != os.environ['FAKE_NEED_TOKEN']: print('{"message":"Resource not accessible by integration","status":"403"}'); sys.exit(1)
    if name in refs: sys.exit(1)
    refs[name] = fields['sha']; save('refs.json', refs)
elif method == 'DELETE' and path.startswith('git/refs/'):
    refs.pop(path[len('git/refs/'):], None); save('refs.json', refs)
elif path.startswith('git/ref/'):
    name = path[len('git/ref/'):]
    if name not in refs: print('{"message":"Not Found","status":"404"}'); sys.exit(1)
    print(refs[name])
elif path.startswith('git/commits/'):
    sha = path[len('git/commits/'):]
    print('tree1' if jq == '.tree.sha' else commits.get(sha, ''))
elif path.startswith('actions/runs/'):
    rid = path[len('actions/runs/'):]
    if rid not in runs: print('{"message":"Not Found","status":"404"}'); sys.exit(1)
    print(runs[rid])
else:
    sys.exit(2)
'''


@unittest.skipIf(os.name == 'nt', 'bash script; the workflows run it on Linux, Mac and Git Bash only through the job shell')
class E2eLockTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        bin_dir = self.tmp / 'bin'; bin_dir.mkdir()
        gh = bin_dir / 'gh'; gh.write_text(FAKE_GH); gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        self.state = self.tmp / 'state'; self.state.mkdir()
        self.env = {**os.environ, 'PATH': f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', 'FAKE_GH': str(self.state), 'GITHUB_REPOSITORY': 'o/r',
                    'GITHUB_SHA': 'abc', 'E2E_LOCK_POLL': '1', 'E2E_LOCK_MAX': '3'}

    def run_lock(self, cmd, run, job='test-mac', key='apply', **env):
        return subprocess.run(['bash', str(LOCK), cmd, key], env={**self.env, **env, 'GITHUB_RUN_ID': run, 'GITHUB_JOB': job}, capture_output=True, text=True, timeout=30)

    def set_runs(self, runs): (self.state / 'runs.json').write_text(json.dumps(runs))

    def refs(self):
        p = self.state / 'refs.json'
        return json.loads(p.read_text()) if p.exists() else {}

    def test_a_free_lock_is_taken_and_released_by_its_holder_only(self):
        self.set_runs({'1': 'in_progress', '2': 'in_progress'})
        self.assertEqual(self.run_lock('acquire', '1').returncode, 0)
        self.assertEqual(list(self.refs()), ['e2e-locks/apply'])
        self.run_lock('release', '2')   # another run's release leaves it alone
        self.assertEqual(list(self.refs()), ['e2e-locks/apply'])
        self.run_lock('release', '1')
        self.assertEqual(self.refs(), {})

    def test_a_second_job_waits_and_is_never_dropped_while_the_holder_runs(self):
        self.set_runs({'1': 'in_progress', '2': 'in_progress'})
        self.run_lock('acquire', '1')
        waited = self.run_lock('acquire', '2', job='test-windows')
        self.assertEqual(waited.returncode, 1, 'it gives up only at its own limit, never earlier')
        self.assertIn('is held by run=1', waited.stdout)
        self.assertIn('waited 3s', waited.stderr)

    def test_a_lock_of_a_finished_run_is_taken_over(self):
        self.set_runs({'1': 'completed', '2': 'in_progress'})
        self.run_lock('acquire', '1')
        taken = self.run_lock('acquire', '2')
        self.assertEqual(taken.returncode, 0, taken.stdout + taken.stderr)
        self.assertIn('taking it over', taken.stdout)

    def test_a_lock_that_cannot_be_created_fails_with_the_reason_not_a_wait(self):
        # beta 16 (24 Oct 2026): creating the ref failed on the runner, gh's 404 body was read as "the holder", and 8 jobs "waited" for nobody for 5 minutes
        self.set_runs({'2': 'in_progress'})
        failed = self.run_lock('acquire', '2', **{'FAKE_POST_FAIL': '422'})
        self.assertEqual(failed.returncode, 1)
        self.assertIn('Validation Failed', failed.stderr)
        self.assertNotIn('waiting', failed.stdout)

    def test_a_rerun_attempt_without_ref_rights_runs_without_the_lock_and_says_so(self):
        # beta 17 (24 Oct 2026): the re-run of a job that took its lock on attempt 1 got 403 "Resource not accessible by integration" on creating the ref
        self.set_runs({'2': 'in_progress'})
        passed = self.run_lock('acquire', '2', **{'FAKE_POST_FAIL': '1', 'GITHUB_RUN_ATTEMPT': '2'})
        self.assertEqual(passed.returncode, 0, passed.stderr)
        self.assertIn('WITHOUT its lock', passed.stderr)
        self.assertIn('::warning::apply: ran without the suite lock', passed.stdout)
        self.assertEqual(self.refs(), {})

    def test_the_apps_token_takes_the_lock_when_the_workflow_token_cannot(self):
        self.set_runs({'2': 'in_progress'})
        taken = self.run_lock('acquire', '2', **{'FAKE_NEED_TOKEN': 'app-token', 'GH_TOKEN': 'workflow-token', 'E2E_LOCK_TOKEN': 'app-token'})
        self.assertEqual(taken.returncode, 0, taken.stderr)
        self.assertEqual(len(self.refs()), 1)
        released = self.run_lock('release', '2', **{'FAKE_NEED_TOKEN': 'app-token', 'GH_TOKEN': 'workflow-token', 'E2E_LOCK_TOKEN': 'app-token'})
        self.assertEqual(self.refs(), {})

    def test_a_holder_whose_run_is_gone_is_taken_over(self):
        self.set_runs({'2': 'in_progress'})   # run 1 does not exist (404)
        self.run_lock('acquire', '1')
        taken = self.run_lock('acquire', '2')
        self.assertEqual(taken.returncode, 0, taken.stdout + taken.stderr)
        self.assertIn('taking it over', taken.stdout)

    def test_different_suites_do_not_wait_for_each_other(self):
        self.set_runs({'1': 'in_progress'})
        self.run_lock('acquire', '1', key='apply')
        self.assertEqual(self.run_lock('acquire', '1', key='quality').returncode, 0)


class SuiteJobsTakeTheLockTest(unittest.TestCase):
    def job_text(self, workflow, name):
        text = (WORKFLOWS / workflow).read_text()
        return re.split(r'\n  %s:\n' % re.escape(name), text)[1].split('\n  ')[0] if False else re.split(r'\n  %s:\n' % re.escape(name), text)[1]

    def suite_job(self, workflow, name):
        body = self.job_text(workflow, name)
        end = re.search(r'\n  [a-z][a-z0-9-]*:\n', body)
        return body[:end.start()] if end else body

    def test_every_suite_job_takes_the_lock_and_releases_it_even_when_cancelled(self):
        for workflow, name in SUITE_JOBS:
            job = self.suite_job(workflow, name)
            self.assertIn('tools/e2e-lock.sh acquire', job, f'{workflow} {name}')
            release = job.split('tools/e2e-lock.sh release')[0].rsplit('- name:', 1)[-1] if 'tools/e2e-lock.sh release' in job else ''
            self.assertIn('if: always()', release, f'{workflow} {name}: the release step runs after a failure or a cancel')
            self.assertIn('contents: write', job, f'{workflow} {name}: creating the lock ref needs it')
            # a re-run attempt's workflow token cannot create refs: both lock steps get the CI App's token, minted just before each
            self.assertIn('id: lock_app\n', job, f'{workflow} {name}')
            self.assertIn('id: lock_app_end\n', job, f'{workflow} {name}')
            self.assertEqual(job.count('E2E_LOCK_TOKEN: ${{ steps.lock_app.outputs.token }}'), 1, f'{workflow} {name}')
            self.assertEqual(job.count('E2E_LOCK_TOKEN: ${{ steps.lock_app_end.outputs.token }}'), 1, f'{workflow} {name}')

    def test_no_suite_job_queues_through_a_group_that_drops_a_waiter(self):
        for workflow, name in SUITE_JOBS:
            group = re.search(r'\n    concurrency:\n(?:      .*\n)+', self.suite_job(workflow, name) + '\n')
            if not group:
                continue
            body = re.sub(r'#.*', '', group.group(0))
            # the only group left is e2e.yml's per-pull-request one, which cancels an older run of the SAME pull request and never meets a beta
            self.assertIn('e2e-pr-', body, f'{workflow} {name}: a shared group drops the second waiter (beta 14)')
            self.assertNotIn("format('e2e-{0}', matrix.key)", body)


if __name__ == '__main__':
    unittest.main()
