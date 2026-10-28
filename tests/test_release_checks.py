"""The shared release checks wait for a running build.yml on the commit instead of failing, and every release job goes through them."""
import json
import os
import re
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'tools' / 'release-checks.sh'
NEWER = '19220ef' + '1' * 33
NEWEST = '29220ef' + '2' * 33

# Fake gh and sleep keep every API call offline and advance pending builds without waiting on the clock.
FAKE_GH = r'''#!/usr/bin/env python3
import json, os, sys
state = os.environ['FAKE_STATE']
args = sys.argv[1:]
if args[:2] == ['run', 'list']:
    if '--jq' in args:
        counts = json.load(open(os.path.join(state, 'open.json')))
        n = int(open(os.path.join(state, 'calls')).read() or 0) if os.path.exists(os.path.join(state, 'calls')) else 0
        open(os.path.join(state, 'calls'), 'w').write(str(n + 1))
        print(counts[min(n, len(counts) - 1)])
    else:
        print(json.dumps([{'conclusion': c} for c in json.load(open(os.path.join(state, 'done.json')))]))
    sys.exit(0)
if args[0] == 'api':
    endpoint = args[1]
    if '/actions/workflows/build.yml/runs?' in endpoint:
        assert 'branch=main' in endpoint
        snapshots = json.load(open(os.path.join(state, 'newer.json')))
        step = int(open(os.path.join(state, 'sleeps')).read()) if os.path.exists(os.path.join(state, 'sleeps')) else 0
        runs = snapshots[min(step, len(snapshots) - 1)]
        if 'status=success' in endpoint:
            runs = [r for r in runs if r.get('conclusion') == 'success']
        else:
            assert args[args.index('--jq') + 1] == '.workflow_runs[] | select(.status != "completed") | .head_sha'
            runs = [r for r in runs if r['status'] != 'completed']
        print('\n'.join(r['head_sha'] for r in runs))
        sys.exit(0)
    if '/compare/' in endpoint:
        head = endpoint.split('...')[1]
        print(json.load(open(os.path.join(state, 'compare.json'))).get(head, 'ahead'))
        sys.exit(0)
sys.exit(1)
'''

FAKE_SLEEP = r'''#!/usr/bin/env python3
import os, pathlib, sys
state = pathlib.Path(os.environ['FAKE_STATE'])
path = state / 'sleeps'
path.write_text(str(int(path.read_text()) + 1 if path.exists() else 1))
with (state / 'polls').open('a') as log:
    log.write(sys.argv[1] + '\n')
'''


def build(status='in_progress', conclusion=None, sha=NEWER):
    """One main-branch build run, with the GitHub API's field names."""
    return {'head_sha': sha, 'status': status, 'conclusion': conclusion}



class ReleaseChecks(unittest.TestCase):
    def run_checks(self, open_counts, done, wait='5', newer=None, compare=None, poll='1'):
        with tempfile.TemporaryDirectory() as tmp:
            bin_dir = Path(tmp) / 'bin'
            bin_dir.mkdir()
            gh = bin_dir / 'gh'
            gh.write_text(FAKE_GH)
            gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
            (Path(tmp) / 'open.json').write_text(json.dumps(open_counts))
            (Path(tmp) / 'done.json').write_text(json.dumps(done))
            (Path(tmp) / 'newer.json').write_text(json.dumps(newer or [[]]))
            (Path(tmp) / 'compare.json').write_text(json.dumps(compare or {}))
            sleep = bin_dir / 'sleep'
            sleep.write_text(FAKE_SLEEP)
            sleep.chmod(sleep.stat().st_mode | stat.S_IEXEC)
            env = dict(os.environ, PATH=f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', FAKE_STATE=tmp, RELEASE_CI_POLL=poll, RELEASE_CI_WAIT=wait, GITHUB_REPOSITORY='o/r')
            env.pop('JOB_PILOTTO_SOAK', None)
            done_run = subprocess.run(['bash', str(SCRIPT), 'desktop-v9', 'b5c13d0c2abf3574fe01a8f2ecff527eaf485965'], env=env, capture_output=True, text=True, timeout=60)
            polls = Path(tmp) / 'polls'
            self.polls = polls.read_text().splitlines() if polls.exists() else []
            return done_run.returncode, done_run.stdout

    def test_a_running_build_is_waited_for_then_decides(self):
        code, out = self.run_checks([1, 1, 0], ['success'])
        self.assertEqual(code, 0, out)
        self.assertIn('build.yml on b5c13d0: green', out)

    def test_a_build_that_ends_red_stops_the_release(self):
        code, out = self.run_checks([1, 0], ['failure'])
        self.assertEqual(code, 1, out)
        self.assertIn('stays a pre-release', out)

    def test_a_build_still_running_after_the_wait_stops_the_release_and_says_so(self):
        code, out = self.run_checks([1], [], wait='2')
        self.assertEqual(code, 1, out)
        self.assertIn('is still running after', out)
        self.assertIn('stays a pre-release', out)

    def test_cancelled_own_build_waits_for_newer_success(self):
        code, out = self.run_checks([0], ['cancelled'], newer=[
            [build()], [build('completed', 'success')]])
        self.assertEqual(code, 0, out)
        self.assertIn("waiting for the newer commit 19220ef's build.yml", out)
        self.assertIn('build.yml on b5c13d0: green', out)
        self.assertEqual(self.polls, ['1'])

    def test_cancelled_own_build_waits_for_newer_failure(self):
        code, out = self.run_checks([0], ['cancelled'], newer=[
            [build()], [build('completed', 'failure')]])
        self.assertEqual(code, 1, out)
        self.assertIn("waiting for the newer commit 19220ef's build.yml", out)
        self.assertIn('build.yml on b5c13d0: red', out)
        self.assertEqual(self.polls, ['1'])

    def test_cancelled_build_with_no_newer_pending_or_green_is_red(self):
        code, out = self.run_checks([0], ['cancelled'])
        self.assertEqual(code, 1, out)
        self.assertIn('build.yml on b5c13d0: red', out)
        self.assertEqual(self.polls, [])

    def test_newer_build_still_pending_after_wait_stops_and_says_so(self):
        code, out = self.run_checks([0], ['cancelled'], wait='2', newer=[[build()]])
        self.assertEqual(code, 1, out)
        self.assertIn('19220ef', out)
        self.assertIn('is still running after 2 s', out)
        self.assertIn('stays a pre-release', out)
        self.assertEqual(self.polls, ['1', '1'])

    def test_own_and_newer_builds_share_one_wait_budget(self):
        code, out = self.run_checks([1, 0], ['cancelled'], wait='2', newer=[[build()]])
        self.assertEqual(code, 1, out)
        self.assertIn('is still running after 2 s', out)
        self.assertEqual(self.polls, ['1', '1'])

    def test_cancelled_newer_build_is_replaced_by_newest_queued_build(self):
        code, out = self.run_checks([0], ['cancelled'], newer=[
            [build()],
            [build('queued', sha=NEWEST), build('completed', 'cancelled')],
            [build('completed', 'success', NEWEST), build('completed', 'cancelled')]])
        self.assertEqual(code, 0, out)
        self.assertIn('29220ef (newer, on main) is green', out)
        self.assertEqual(self.polls, ['1', '1'])

    def test_older_green_or_pending_commit_cannot_cover_beta(self):
        for status, conclusion in [('completed', 'success'), ('in_progress', None)]:
            with self.subTest(status=status):
                code, out = self.run_checks([0], ['cancelled'],
                    newer=[[build(status, conclusion)]], compare={NEWER: 'behind'})
                self.assertEqual(code, 1, out)
                self.assertIn('build.yml on b5c13d0: red', out)
                self.assertEqual(self.polls, [])

    def test_wait_message_is_printed_once_a_minute(self):
        code, out = self.run_checks([0], ['cancelled'], wait='120', newer=[[build()]], poll='30')
        self.assertEqual(code, 1, out)
        self.assertEqual(out.count("waiting for the newer commit 19220ef's build.yml"), 2)
        self.assertIn('is still running after 120 s', out)

    def test_every_release_job_goes_through_the_shared_checks(self):
        # The jobs that approve a beta (Mac, Windows/Linux in desktop.yml, beta-approve.yml) read build.yml's result only through tools/release-checks.sh.
        callers = ['desktop.yml', 'beta-approve.yml']
        for name in callers:
            text = (ROOT / '.github' / 'workflows' / name).read_text()
            self.assertIn('tools/release-checks.sh "$TAG" "$REF"', text, name)
        for path in sorted((ROOT / '.github' / 'workflows').glob('*.yml')):
            if path.name == 'build.yml':
                continue
            self.assertIsNone(re.search(r'--workflow[ =]build\.yml', path.read_text()), f'{path.name} reads build.yml itself: use tools/release-checks.sh')
        self.assertEqual(len(re.findall(r'tools/release-checks\.sh', (ROOT / '.github' / 'workflows' / 'desktop.yml').read_text())), 2)


if __name__ == '__main__':
    unittest.main()
