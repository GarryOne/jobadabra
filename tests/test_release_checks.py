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
    if 'databaseId,status' in args:   # the ids of the runs seen open
        print('101')
        sys.exit(0)
    if '--jq' in args:
        counts = json.load(open(os.path.join(state, 'open.json')))
        n = int(open(os.path.join(state, 'calls')).read() or 0) if os.path.exists(os.path.join(state, 'calls')) else 0
        open(os.path.join(state, 'calls'), 'w').write(str(n + 1))
        print(counts[min(n, len(counts) - 1)])
    else:
        done = json.load(open(os.path.join(state, 'done.json')))
        if done and isinstance(done[0], list):   # one list per call: the completed list catching up after a run ends
            path = os.path.join(state, 'done_calls')
            n = int(open(path).read()) if os.path.exists(path) else 0
            open(path, 'w').write(str(n + 1))
            done = done[min(n, len(done) - 1)]
        print(json.dumps([{'conclusion': c} for c in done]))
    sys.exit(0)
if args[0] == 'api':
    endpoint = args[1]
    if '/actions/runs/' in endpoint:   # a run read by id: byid.json lists "status conclusion" per call (default: completed with the completed list's first conclusion, else still running)
        path = os.path.join(state, 'byid_calls')
        n = int(open(path).read()) if os.path.exists(path) else 0
        open(path, 'w').write(str(n + 1))
        byid = json.load(open(os.path.join(state, 'byid.json')))
        if byid is None:
            done = json.load(open(os.path.join(state, 'done.json')))
            done = done[-1] if done and isinstance(done[0], list) else done
            print(f'completed {done[0]}' if done else 'in_progress ')
        else:
            print(byid[min(n, len(byid) - 1)])
        sys.exit(0)
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



def code_lines(text):
    """The text without its comment lines: a comment that names the script does not run it."""
    return '\n'.join(line for line in text.splitlines() if not line.lstrip().startswith('#'))


class ReleaseChecks(unittest.TestCase):
    def run_checks(self, open_counts, done, wait='5', newer=None, compare=None, poll='1', mode=None, soak=None, byid=None):
        with tempfile.TemporaryDirectory() as tmp:
            bin_dir = Path(tmp) / 'bin'
            bin_dir.mkdir()
            gh = bin_dir / 'gh'
            gh.write_text(FAKE_GH)
            gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
            (Path(tmp) / 'open.json').write_text(json.dumps(open_counts))
            (Path(tmp) / 'done.json').write_text(json.dumps(done))
            (Path(tmp) / 'byid.json').write_text(json.dumps(byid))
            (Path(tmp) / 'newer.json').write_text(json.dumps(newer or [[]]))
            (Path(tmp) / 'compare.json').write_text(json.dumps(compare or {}))
            sleep = bin_dir / 'sleep'
            sleep.write_text(FAKE_SLEEP)
            sleep.chmod(sleep.stat().st_mode | stat.S_IEXEC)
            env = dict(os.environ, PATH=f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', FAKE_STATE=tmp, RELEASE_CI_POLL=poll, RELEASE_CI_WAIT=wait, GITHUB_REPOSITORY='o/r')
            env.pop('JOB_PILOTTO_SOAK', None)
            if soak:
                env['JOB_PILOTTO_SOAK'] = soak
            done_run = subprocess.run(['bash', str(SCRIPT), *([mode] if mode else []), 'desktop-v9', 'b5c13d0c2abf3574fe01a8f2ecff527eaf485965'], env=env, capture_output=True, text=True, timeout=60)
            polls = Path(tmp) / 'polls'
            self.polls = polls.read_text().splitlines() if polls.exists() else []
            return done_run.returncode, done_run.stdout

    def test_a_running_build_is_waited_for_then_decides(self):
        code, out = self.run_checks([1, 1, 0], ['success'])
        self.assertEqual(code, 0, out)
        self.assertIn('build.yml on b5c13d0: green', out)

    def test_a_run_seen_open_gets_its_verdict_from_its_id_not_from_a_completed_list_that_omits_it(self):
        # Beta 9 (1 Nov 2026): the run ended seconds before the completed list was read; the list was empty and the release stopped on "none" although the build was green.
        # mac-07: the box has the run's id, so it reads that run, and the list only finds runs.
        code, out = self.run_checks([1, 0], [[]], byid=['in_progress ', 'completed success'])
        self.assertEqual(code, 0, out)
        self.assertIn('build.yml on b5c13d0: green', out)

    def test_a_run_read_by_id_that_failed_stops_the_release_even_if_the_list_says_green(self):
        code, out = self.run_checks([1, 0], [['success']], byid=['completed failure'])
        self.assertEqual(code, 1, out)
        self.assertIn('build.yml on b5c13d0: red', out)

    def test_no_run_at_all_is_still_none_when_none_was_ever_open(self):
        code, out = self.run_checks([0], [[]])
        self.assertEqual(code, 1, out)
        self.assertIn('build.yml on b5c13d0: none', out)
        self.assertNotIn('not listed as completed yet', out)

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

    # Owner, 1 Nov 2026 ("the blocking of the main's CI"): the wait for main's build.yml is its own job (--wait-ci); the Release jobs only run the rest (--after-ci).
    def test_wait_ci_decides_on_main_s_build_and_never_reads_the_schema(self):
        code, out = self.run_checks([1, 0], ['success'], mode='--wait-ci', soak='on')   # the fake gh fails any schema call: reaching it would exit 1
        self.assertEqual(code, 0, out)
        self.assertIn('build.yml on b5c13d0: green', out)
        self.assertNotIn('Schema', out)

    def test_wait_ci_refuses_a_red_or_a_still_running_build_with_the_same_words(self):
        code, out = self.run_checks([1, 0], ['failure'], mode='--wait-ci')
        self.assertEqual(code, 1, out)
        self.assertIn('desktop-v9 stays a pre-release: build.yml is not green on its commit.', out)
        code, out = self.run_checks([1], [], wait='2', mode='--wait-ci')
        self.assertEqual(code, 1, out)
        self.assertIn('is still running after 2 s: not waiting any longer', out)
        self.assertIn('desktop-v9 stays a pre-release: build.yml is not green on its commit.', out)

    def test_after_ci_neither_waits_for_nor_reads_the_build(self):
        code, out = self.run_checks([1], ['failure'], mode='--after-ci')   # the build is red and running; this part must not look
        self.assertEqual(code, 0, out)
        self.assertNotIn('build.yml', out)
        self.assertEqual(self.polls, [])

    def test_no_mode_is_the_whole_check_as_before(self):
        code, out = self.run_checks([1, 0], ['failure'])
        self.assertEqual(code, 1, out)
        self.assertIn('stays a pre-release', out)

    def test_every_release_job_goes_through_the_shared_checks(self):
        # The jobs that approve a beta (Mac, Windows/Linux in desktop.yml, beta-approve.yml) read build.yml's result only through tools/release-checks.sh.
        # desktop.yml: the Main's CI job waits for it once (--wait-ci); the two Release jobs run the rest (--after-ci) and read that job's result.
        desktop = code_lines((ROOT / '.github' / 'workflows' / 'desktop.yml').read_text())
        self.assertEqual(desktop.count('tools/release-checks.sh --wait-ci "$TAG" "$REF"'), 1)
        self.assertEqual(desktop.count('tools/release-checks.sh --after-ci "$TAG" "$REF"'), 2)
        self.assertEqual(len(re.findall(r'tools/release-checks\.sh', desktop)), 3)
        self.assertIn('tools/release-checks.sh "$TAG" "$REF"', (ROOT / '.github' / 'workflows' / 'beta-approve.yml').read_text())
        for path in sorted((ROOT / '.github' / 'workflows').glob('*.yml')):
            if path.name == 'build.yml':
                continue
            self.assertIsNone(re.search(r'--workflow[ =]build\.yml', path.read_text()), f'{path.name} reads build.yml itself: use tools/release-checks.sh')

    def test_every_job_that_waits_outlives_the_longest_wait_the_checks_allow(self):
        # Why (30 Oct 2026, a8; beta 41090972183): the 20-minute Windows release job was cancelled at 1080 s of the checks' 3600 s wait while main's build ran 46 min.
        wait = int(re.search(r'RELEASE_CI_WAIT:-(\d+)', SCRIPT.read_text()).group(1))
        review = int(re.search(r'timeout (\d+) node review-ui\.mjs', (ROOT / '.github' / 'actions' / 'e2e-review' / 'action.yml').read_text()).group(1))
        waiting, after = [], []
        for name in ['desktop.yml', 'beta-approve.yml']:
            text = (ROOT / '.github' / 'workflows' / name).read_text()
            for job in re.split(r'\n  (?=[\w-]+:\n)', text):
                code = code_lines(job)
                if re.search(r'tools/release-checks\.sh(?! --after-ci)', code):
                    waiting.append((name, job))
                elif 'tools/release-checks.sh --after-ci' in code:
                    after.append((name, job))
        self.assertEqual(len(waiting), 2, "desktop.yml's Main's CI job and beta-approve.yml")
        self.assertEqual(len(after), 2, 'the Mac and the Windows Release jobs')
        for name, job in waiting:
            minutes = int(re.search(r'\n    timeout-minutes: (\d+)', job).group(1))
            needed = wait + (review if 'e2e-review' in job else 0) + 600   # 10 min for downloads, rates and the release itself
            self.assertGreaterEqual(minutes * 60, needed, f'{name} {job.split(":")[0]}: {minutes} min is shorter than the checks may wait ({needed // 60} min)')
        for name, job in after:   # no wait left here: the review plus the lane's own steps
            minutes = int(re.search(r'\n    timeout-minutes: (\d+)', job).group(1))
            self.assertGreaterEqual(minutes * 60, review + 600, f'{name} {job.split(":")[0]}: {minutes} min is shorter than its review plus its steps')


if __name__ == '__main__':
    unittest.main()
