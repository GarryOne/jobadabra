"""Five independent green PR attempts are required before a suite enters the backbone."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pr_verdict', Path(__file__).resolve().parents[1] / 'tools/pr-verdict.py')
pv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv)


class BurnIn(unittest.TestCase):
    def verdict(self, outcomes, completed=True, **kwargs):
        run = {'databaseId': 7, 'workflowName': 'CI · End-to-end on Mac + Linux', 'event': 'workflow_dispatch',
               'displayTitle': 'E2E for PR · quality · burn-in', 'createdAt': '2026-10-29T10:00:00Z',
               'updatedAt': '2026-10-29T10:04:00Z', 'status': 'completed' if completed else 'in_progress',
               'conclusion': 'success' if all(o == 'success' for o in outcomes) else 'failure'}
        jobs = [{'id': i, 'name': f'quality · burn-in {i}/5', 'status': 'in_progress' if o is None else 'completed',
                 'conclusion': o, 'steps': []} for i, o in enumerate(outcomes, 1)]
        return pv.verdict([run], jobs={7: jobs}, **kwargs)[:2]

    def test_five_green_attempts_admit(self):
        self.assertEqual(self.verdict(['success'] * 5)[0], 'success')

    def test_four_green_and_one_red_never_admit_even_when_grey_or_report_only(self):
        for kwargs in ({}, {'greys': {5: 'tolerant'}}, {'greys': {5: 'main'}}, {'greys': {5: 'runner'}}, {'reports': {'quality'}}):
            with self.subTest(kwargs=kwargs):
                state, why = self.verdict(['success'] * 4 + ['failure'], **kwargs)
                self.assertEqual(state, 'failure')
                self.assertIn('quality burn-in 4/5: not admitted', why)

    def test_skipped_cancelled_and_missing_attempts_are_not_passes(self):
        for outcomes in (['success'] * 4, ['success'] * 4 + ['skipped'], ['success'] * 4 + ['cancelled']):
            state, why = self.verdict(outcomes)
            self.assertEqual(state, 'failure')
            self.assertIn('burn-in 4/5', why)

    def test_a_fifth_attempt_still_running_keeps_the_verdict_pending(self):
        self.assertEqual(self.verdict(['success'] * 4 + [None], completed=False)[0], 'pending')

    def test_workflow_burn_in_attempts_keep_first_failure_and_never_retry(self):
        workflow = (Path(__file__).resolve().parents[1] / '.github/workflows/e2e.yml').read_text()
        first = workflow.split('id: suite_run', 1)[1].split('- name: AI answer candidates', 1)[0]
        self.assertIn('continue-on-error: ${{ !inputs.mutant && !matrix.burnIn }}', first)
        retry = first.split('- name: "First try failed:', 1)[1].split('env:', 1)[0]
        self.assertIn('!matrix.burnIn', retry)
        self.assertIn("format('{0} · burn-in {1}/5', matrix.suite, matrix.burnIn)", workflow)

    def test_completed_green_e2e_still_reads_jobs_to_check_all_five_attempts(self):
        run = {'databaseId': 7, 'workflowName': 'E2E', 'event': 'workflow_dispatch', 'status': 'completed',
               'conclusion': 'success', 'displayTitle': 'E2E for PR · quality · burn-in'}
        attempts = [{'id': 1, 'name': 'quality · burn-in 1/5', 'status': 'completed', 'conclusion': 'success'}]
        with patch.object(pv, 'gh', side_effect=[json.dumps([run]), json.dumps(attempts)]):
            runs, jobs = pv.read('o/r', 'head', '')
        self.assertEqual(jobs.get(7), attempts, 'a green run can still have missing or skipped admission jobs')

    def test_standalone_verdict_downloads_its_burn_in_companion_at_its_own_ref(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(pv, '__file__', str(Path(folder) / 'pr-verdict.py')):
            with patch.object(pv, 'gh', return_value=(ROOT / 'tools/pr_burn_in.py').read_text()) as gh:
                state, why = self.verdict(['success'] * 4 + ['failure'],
                    burn_in=lambda *args: pv.main_state_module('o/r', 'head', 'pr_burn_in').failures(*args))
        self.assertEqual(state, 'failure')
        self.assertIn('burn-in 4/5', why)
        self.assertTrue(gh.call_args.args[-1].endswith('tools/pr_burn_in.py?ref=head'))

    def test_a_flip_names_the_pass_count_before_individual_failures_can_truncate_it(self):
        for passed in (1, 2, 3):
            with self.subTest(passed=passed):
                state, why = self.verdict(['success'] * passed + ['failure'] * (5 - passed))
                self.assertEqual(state, 'failure')
                self.assertIn(f'quality burn-in {passed}/5: not admitted', why)
