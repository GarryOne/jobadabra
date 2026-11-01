"""The stable canary blames the stable build only when a suite on it failed with a wrong answer; a plan (harness) failure is reported as the harness (#740); a red made only of waits running out is "timeouts", never a rollback."""
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tools.canary_verdict import failures_in, verdict

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = (ROOT / '.github/workflows/stable-canary.yml').read_text()
RUN = json.loads((ROOT / 'tests/fixtures/canary_41312012476.json').read_text())   # the recorded canary of 1 Nov 2026: 257 s, 176 s and 45 s of waiting


def job(name, conclusion):
    return {'name': name, 'conclusion': conclusion}


def note(message, suite='applyflows'):
    return {'suite': suite, 'step': 'a step', 'message': message}


class CanaryVerdict(unittest.TestCase):
    def test_plan_only_failure_is_the_harness(self):
        self.assertEqual(verdict([job('plan', 'failure'), job('apply', 'skipped')]), 'harness')

    def test_suite_failure_is_stable(self):
        self.assertEqual(verdict([job('plan', 'success'), job('apply', 'failure')]), 'stable')
        self.assertEqual(verdict([job('plan', 'failure'), job('apply', 'failure')]), 'stable')

    def test_all_green(self):
        self.assertEqual(verdict([job('plan', 'success'), job('apply', 'success')]), 'green')

    def test_workflow_files_stable_issue_only_for_stable(self):
        issue = re.search(r'if \[ "\$RESULT" = red \]; then(.*?)\n          fi\n', WORKFLOW, re.S).group(1)
        self.assertIn('fails the end-to-end journey', issue)
        self.assertNotIn('harness', issue)
        self.assertIn('RESULT" = harness', WORKFLOW)


class WaitsThatRanOut(unittest.TestCase):
    """Run 41312012476 (stable v0.8.60, 1 Nov 2026): three applyflows steps only ran out of time, and the issue said "promote the previous build"."""

    def test_the_recorded_slow_run_is_timeouts_not_a_stable_failure(self):
        self.assertEqual(verdict(RUN['jobs'], RUN['failures']), 'timeouts')
        self.assertEqual(sorted(re.search(r'\d+(?:\.\d+)? ?(?:s|ms)\b', item['message']).group(0) for item in RUN['failures']), ['176.41 s', '257.365 s', '45027 ms'])

    def test_without_the_failure_records_a_failed_suite_stays_a_stable_red(self):
        self.assertEqual(verdict(RUN['jobs']), 'stable')
        self.assertEqual(verdict(RUN['jobs'], []), 'stable')

    def test_one_wrong_answer_among_the_waits_is_a_stable_red(self):
        wrong = note('the Jobs list shows 3 rows, the kit says 4')
        self.assertEqual(verdict(RUN['jobs'], RUN['failures'] + [wrong]), 'stable')

    def test_a_failed_job_with_no_record_is_not_called_timeouts(self):
        jobs = RUN['jobs'] + [job('settings-1of2', 'failure')]
        self.assertEqual(verdict(jobs, RUN['failures']), 'stable')

    def test_a_plan_failure_is_still_the_harness_whatever_the_records_say(self):
        self.assertEqual(verdict([job('plan', 'failure'), job('applyflows-2of3', 'skipped')], RUN['failures']), 'harness')

    def test_every_shape_of_a_wait_running_out_counts(self):
        for message in ('the fill did not finish within 257.365 s (last seen: null)', 'the app never saw the earlier form closed after waiting 45027 ms (last report: {})',
                        'the step did not finish within 395 s (it hung)', 'page.click: Timeout 30000ms exceeded.'):
            self.assertEqual(verdict([job('applyflows-2of3', 'failure')], [note(message)]), 'timeouts', message)

    def test_the_records_are_read_from_every_downloaded_artifact(self):
        with tempfile.TemporaryDirectory() as folder:
            for name, records in (('e2e-artifacts-applyflows-2of3', RUN['failures'][:1]), ('e2e-artifacts-apply-1of3', RUN['failures'][1:])):
                (Path(folder) / name).mkdir()
                (Path(folder) / name / 'suite-failures.json').write_text(json.dumps(records))
            (Path(folder) / 'e2e-artifacts-broken').mkdir()
            (Path(folder) / 'e2e-artifacts-broken' / 'suite-failures.json').write_text('{not json')
            self.assertEqual(len(failures_in(folder)), 3)
            ran = subprocess.run([sys.executable, str(ROOT / 'tools/canary_verdict.py'), '--failures', folder], input=json.dumps({'jobs': RUN['jobs']}), capture_output=True, text=True, cwd=ROOT)
            self.assertEqual(ran.stdout.strip(), 'timeouts', ran.stderr)

    def test_the_workflow_says_timeouts_only_and_never_names_a_rollback_for_them(self):
        branch = re.search(r'if \[ "\$RESULT" = timeouts \]; then(.*?)\n          fi\n', WORKFLOW, re.S).group(1)
        self.assertIn('Timeouts only: re-look before any rollback', branch)
        for banned in ('promote', 'release-stable', 'runner slow', 'roll back'):
            self.assertNotIn(banned, branch, banned)
        self.assertNotIn('runner slow', WORKFLOW)
        self.assertIn('canary_verdict.py --failures canary-artifacts', WORKFLOW)
        self.assertIn('timeouts) echo "result=timeouts"', WORKFLOW)


if __name__ == '__main__':
    unittest.main()
