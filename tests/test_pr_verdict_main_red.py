"""A PR is red only when its diff broke it (owner, 28 Oct 2026, the e2e reliability design #2336): a PR suite that fails exactly as main's own red shows grey.
#2342 (Focus target fix): its focus suite passed, its settings suite failed with the line main's settings had printed since #2339, and "All checks passed" read
"red: e2e focus,settings". tools/pr-verdict.py now greys a job whose every "✗ step: reason" line main's newest red of that suite printed, and a red names the
failing jobs. Strict: a new step or a new reason stays red."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('pr_verdict', ROOT / 'tools' / 'pr-verdict.py')
pv = importlib.util.module_from_spec(spec); spec.loader.exec_module(pv)
from tools import main_e2e_state  # noqa: E402

STEP = 'Automatic backup: the backup file, imported after a reset, brings this computer back as it was'
PR_LOG = '\n'.join([   # gh run view --log-failed of #2342's settings job (run 40678522625)
    f'settings\tFirst try failed: the settings suite once more, to tell flaky from real\t2026-10-28T11:18:16.1233732Z ✗ {STEP}: export archive omitted profile.md',
    'settings\tFirst try failed: the settings suite once more, to tell flaky from real\t2026-10-28T11:18:16.3879685Z ##[error]export archive omitted profile.md',
    f'settings\tFirst try failed: the settings suite once more, to tell flaky from real\t2026-10-28T11:18:16.9988165Z     ✗ {STEP}: export archive omitted profile.md'])
MAIN_LOG = '\n'.join([   # main's settings red (run 40650235925, #2339)
    f'settings\tUNKNOWN STEP\t2026-10-28T07:31:54.4791922Z ✗ {STEP}: the export before the reset did not finish: "Export failed: tar failed (2)"',
    f'settings\tUNKNOWN STEP\t2026-10-28T07:32:20.3051766Z ✗ {STEP}: export archive omitted profile.md'])


def run(id, conclusion='failure', title='E2E for PR · focus,settings · focus-target-kept'):
    return {'databaseId': id, 'workflowName': 'CI · End-to-end on Mac + Linux', 'status': 'completed', 'conclusion': conclusion, 'event': 'workflow_dispatch',
            'createdAt': '2026-10-28T11:00:00Z', 'updatedAt': '2026-10-28T11:20:00Z', 'displayTitle': title}


def job(id, name, conclusion='success', status='completed'):
    return {'id': id, 'name': name, 'status': status, 'conclusion': conclusion, 'steps': []}


PR = {'databaseId': 1, 'workflowName': 'CI · Pull request', 'status': 'completed', 'conclusion': 'success', 'event': 'pull_request',
      'createdAt': '2026-10-28T11:00:00Z', 'updatedAt': '2026-10-28T11:01:00Z', 'displayTitle': 'CI · Pull request'}
JOBS = {7: [job(70, 'plan'), job(71, 'settings', 'failure'), job(72, 'focus'), job(73, 'HTML report')]}
MAIN = {'settings': {'conclusion': 'failure', 'jobs': [900]}, 'focus': {'conclusion': 'success', 'jobs': []}}


class MainsOwnRed(unittest.TestCase):
    def test_failure_lines_are_read_without_gh_columns_stamps_or_indent(self):
        self.assertEqual(pv.marks(PR_LOG), {f'✗ {STEP}: export archive omitted profile.md'})
        self.assertEqual(pv.marks('plain line\n##[error]Process completed with exit code 1.'), set())

    def test_2342_settings_failed_as_main_did_and_a_new_step_or_reason_stays_red(self):
        self.assertTrue(pv.mains_own(PR_LOG, [MAIN_LOG]))
        self.assertFalse(pv.mains_own(PR_LOG.replace('omitted profile.md', 'omitted answers.md'), [MAIN_LOG]), 'a new reason is this diff')
        self.assertFalse(pv.mains_own(PR_LOG + f'\n2026-10-28T11:19:00Z ✗ Every Settings section renders: Connections is empty', [MAIN_LOG]), 'a new step is this diff')
        self.assertFalse(pv.mains_own('##[error]Process completed with exit code 1.', [MAIN_LOG]), 'no failure line: nothing to compare, red')
        self.assertFalse(pv.mains_own(PR_LOG, []), 'main printed nothing to match')

    def test_a_grey_job_is_shown_never_red_and_a_red_names_its_failing_jobs(self):
        state, why, *_ = pv.verdict([PR, run(7)], jobs=JOBS, greys={71})
        self.assertEqual(state, 'success', why)
        self.assertTrue(why.startswith('grey: settings (red on main too, not this PR); '), why)
        state, why, *_ = pv.verdict([PR, run(7)], jobs=JOBS)
        self.assertEqual((state, why), ('failure', 'red: e2e settings'), 'the failing job, not the run title "focus,settings"')

    def test_greys_come_from_main_state_and_logs_and_any_failed_read_keeps_red(self):
        logs = {71: PR_LOG, 900: MAIN_LOG}
        self.assertEqual(pv.main_red_greys('o/r', [PR, run(7)], JOBS, read_main=lambda repo: MAIN, log_of=logs.get), {71})
        self.assertEqual(pv.main_red_greys('o/r', [PR, run(7)], JOBS, read_main=lambda repo: {**MAIN, 'settings': {'conclusion': 'success'}}, log_of=logs.get), set(), 'green on main: red')
        running = {7: [job(71, 'settings', '', 'in_progress')]}
        self.assertEqual(pv.main_red_greys('o/r', [PR, run(7)], running, read_main=lambda repo: MAIN, log_of=logs.get), set(), 'a job still running has no log yet')

        def broken(repo):
            raise subprocess.CalledProcessError(1, 'gh')
        self.assertEqual(pv.main_red_greys('o/r', [PR, run(7)], JOBS, read_main=broken, log_of=logs.get), set())
        self.assertEqual(pv.main_red_greys('o/r', [PR, run(7, title='Bisect settings abc')], JOBS, read_main=lambda repo: MAIN, log_of=logs.get), set(), 'only the PR\'s own e2e run')

    def test_main_state_keeps_the_ids_of_a_suites_red_jobs(self):
        runs = [{'id': 5, 'head_branch': 'main', 'head_sha': 'a' * 40, 'conclusion': 'failure', 'display_title': 'E2E check · nightly', 'created_at': 'x', 'html_url': 'u'}]
        jobs = {5: [{'id': 51, 'name': 'applyflows-1of2', 'conclusion': 'failure'}, {'id': 52, 'name': 'applyflows-2of2', 'conclusion': 'success'}, {'id': 53, 'name': 'settings', 'conclusion': 'success'}]}
        st = main_e2e_state.state(runs, lambda rid: jobs.get(rid, []))
        self.assertEqual((st['applyflows']['conclusion'], st['applyflows']['jobs']), ('failure', [51]))
        self.assertEqual(st['settings']['jobs'], [])


FAKE_GH = r"""#!/usr/bin/env python3
import json, os, sys
d = os.environ['FAKE_DIR']; a = sys.argv[1:]; path = next((x for x in a if x.startswith('repos/')), '')
def out(name): sys.stdout.write(open(os.path.join(d, name), encoding='utf-8').read())
if a[:2] == ['run', 'list']: out('runs.json')
elif a[:2] == ['api', 'graphql']: print(json.dumps({'data': {'repository': {'object': {'associatedPullRequests': {'nodes': [{'number': 2342, 'state': 'OPEN', 'mergedAt': None,
    'files': {'pageInfo': {'hasNextPage': False}, 'nodes': [{'path': 'desktop/renderer/pages/focus.js'}]}, 'commits': {'nodes': [{'commit': {'message': 'Keep the typed daily target'}}]}}]}}}}}))
elif '/contents/tools/main_e2e_state.py' in path: out('main_e2e_state.py')
elif '/actions/workflows/e2e.yml/runs' in path: out('main-runs.json')
elif '/logs' in path:
    if os.environ.get('FAKE_OLD_GH') and '--allow-escape-sequences' in a: sys.exit('unknown flag: --allow-escape-sequences')
    if '--allow-escape-sequences' not in a and not os.environ.get('FAKE_OLD_GH'): sys.exit('the response contains terminal escape sequences; pass --allow-escape-sequences')
    out('log-' + path.split('/jobs/')[1].split('/')[0] + '.txt')
elif '/jobs' in path: out('jobs-' + path.split('/runs/')[1].split('/')[0] + '.json')
elif '/statuses/' in path: open(os.path.join(d, 'written'), 'a').write(json.dumps(a[2:]) + chr(10))
else: sys.exit('fake gh: no answer for ' + repr(a))
"""


class TheStepAsCIRunsIt(unittest.TestCase):
    """The whole script as a PR job's last step runs it: a copy with no repo around it (every PR workflow fetches pr-verdict.py alone), the real `gh` replaced.
    The code review of this change found the first version never greyed in CI: its sibling main_e2e_state.py was missing, and `gh run view --log-failed`
    refuses logs until the run ends."""

    def run_step(self, job_status='', me_runs=False, old_gh=False):
        d = tempfile.mkdtemp(); bin_dir = os.path.join(d, 'bin'); os.mkdir(bin_dir)
        gh = Path(bin_dir, 'gh'); gh.write_text(FAKE_GH.replace('/usr/bin/env python3', sys.executable), encoding='utf-8'); gh.chmod(0o755)
        e2e = dict(run(7), status='in_progress' if me_runs else 'completed', conclusion='' if me_runs else 'failure')
        files = {'runs.json': [PR, e2e], 'main-runs.json': [{'id': 500, 'head_branch': 'main', 'head_sha': 'b' * 40, 'conclusion': 'failure', 'display_title': 'E2E check · nightly',
                                                           'created_at': '2026-10-28T07:27:50Z', 'html_url': 'u'}],
                 'jobs-500.json': [{'id': 900, 'name': 'settings', 'conclusion': 'failure'}, {'id': 901, 'name': 'focus', 'conclusion': 'success'}],
                 'jobs-7.json': [job(70, 'plan'), job(71, 'settings', 'failure'),
                                 dict(job(72, 'focus', '', 'in_progress'), runner_name='r1', steps=[{'name': 'Run', 'status': 'completed', 'conclusion': 'success'}, {'name': pv.STEP, 'status': 'in_progress'}])
                                 if me_runs else job(72, 'focus')]}
        for name, data in files.items():
            Path(d, name).write_text(json.dumps(data), encoding='utf-8')
        for name, text in {'log-71.txt': PR_LOG.replace('settings\tFirst try failed: the settings suite once more, to tell flaky from real\t', ''),
                           'log-900.txt': MAIN_LOG.replace('settings\tUNKNOWN STEP\t', ''), 'main_e2e_state.py': (ROOT / 'tools' / 'main_e2e_state.py').read_text(encoding='utf-8')}.items():
            Path(d, name).write_text(text, encoding='utf-8')
        env = dict(os.environ, PATH=bin_dir + os.pathsep + os.environ['PATH'], FAKE_DIR=d, GITHUB_RUN_ID='7', RUNNER_NAME='r1', GITHUB_SHA='abc1234', FAKE_OLD_GH='1' if old_gh else '')
        script = Path(d, 'pr-verdict.py'); script.write_text((ROOT / 'tools' / 'pr-verdict.py').read_text(encoding='utf-8'), encoding='utf-8')
        args = [sys.executable, str(script), '--repo', 'o/r', '--sha', 'abc1234'] + (['--job-status', job_status] if job_status else [])
        done = subprocess.run(args, env=env, capture_output=True, encoding='utf-8', timeout=60)
        written = Path(d, 'written').read_text(encoding='utf-8') if Path(d, 'written').exists() else ''
        return done, written

    def test_the_backstop_greys_2342s_settings_with_the_file_alone(self):
        done, written = self.run_step()
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn('"state=success"', written, done.stdout + done.stderr)
        self.assertIn('grey: settings (red on main too, not this PR)', written)

    def test_focus_ending_after_settings_writes_grey_from_its_own_step(self):
        done, written = self.run_step(job_status='success', me_runs=True)
        self.assertIn('"state=success"', written, done.stdout + done.stderr)

    def test_a_gh_older_than_the_escape_flag_is_asked_again_without_it(self):
        done, written = self.run_step(old_gh=True)
        self.assertIn('"state=success"', written, done.stdout + done.stderr)


if __name__ == '__main__':
    unittest.main()
