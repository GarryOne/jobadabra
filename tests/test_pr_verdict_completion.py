"""Replay a completed workflow's verdict write while GitHub's run/job lists still say running."""
import copy
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pr_verdict_completion', ROOT / 'tools/pr-verdict.py')
pv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv)
RECORDED = json.loads((ROOT / 'tests/fixtures/pr-verdict-stale.json').read_text())


class CompletionWriter(unittest.TestCase):
    def write(self, record=None, event_name='workflow_run', job_status='', files=('src/sources/visits.py',)):
        record = copy.deepcopy(record or RECORDED)
        writes = []

        def gh(*args):
            if args[:2] == ('api', 'graphql'):
                return json.dumps({'data': {'repository': {'object': {'associatedPullRequests': {'nodes': [
                    {'number': 2533, 'state': 'OPEN', 'mergedAt': None, 'headRefOid': '263ca66', 'files': {
                        'pageInfo': {'hasNextPage': False}, 'nodes': [{'path': path} for path in files]},
                     'commits': {'nodes': []}}
                ]}}}}})
            if args[:2] == ('run', 'list'):
                self.assertIn('attempt', args[-1].split(','), 'gh exposes run_attempt as attempt')
                return json.dumps(record['runs'])
            if args[:2] == ('api', 'rate_limit'):
                return json.dumps({'resources': {'core': {'remaining': 500, 'limit': 1000},
                                                  'graphql': {'remaining': 5000, 'limit': 5000}}})
            if args[0] == 'api' and args[1].endswith('/jobs?per_page=100'):
                return json.dumps(record['jobs'][args[1].split('/runs/')[1].split('/')[0]])
            if args[:2] == ('api', 'repos/o/r/statuses/263ca66'):
                writes.append(dict(arg.split('=', 1) for arg in args[3::2]))
                return '{}'
            raise AssertionError(f'unrecorded gh call: {args}')

        with tempfile.TemporaryDirectory() as folder:
            event_path = Path(folder) / 'event.json'
            event_path.write_text(json.dumps(record['event']))
            env = {'GITHUB_EVENT_NAME': event_name, 'GITHUB_EVENT_PATH': str(event_path),
                   'GITHUB_RUN_ID': '4' if job_status else '99', 'RUNNER_NAME': 'python-runner'}
            argv = ['pr-verdict.py', '--repo', 'o/r', '--sha', '263ca66']
            if job_status:
                argv += ['--job-status', job_status]
            with patch.dict(os.environ, env, clear=True), patch.object(sys, 'argv', argv), \
                    patch.object(pv, 'gh', side_effect=gh), patch.object(sys, 'stdout'), \
                    patch.object(pv, 'main_state_module', side_effect=OSError('offline replay')), \
                    patch.object(pv.time, 'sleep', side_effect=AssertionError('no verdict wait or re-read')):
                self.assertEqual(pv.main(), 0)
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0]['context'], 'All checks passed')
        return writes[0]

    def test_2533_last_completion_writes_success_despite_both_lists_lagging(self):
        written = self.write()
        self.assertEqual(written['state'], 'success', written)
        self.assertIn('4.3 min', written['description'])

    def e2e_record(self, conclusion='success'):
        record = copy.deepcopy(RECORDED)
        record['runs'][-1].update(workflowName='CI · End-to-end on Mac + Linux',
                                  event='workflow_dispatch', displayTitle='E2E for PR · settings · stale-verdict')
        record['jobs']['4'][0]['name'] = 'E2E · settings'
        record['event']['workflow_run'].update(name='CI · End-to-end on Mac + Linux',
                                                event='workflow_dispatch', conclusion=conclusion)
        return record

    def test_last_e2e_success_clears_lagging_run_and_job_lists(self):
        written = self.write(self.e2e_record())
        self.assertEqual(written['state'], 'success', written)
        self.assertIn('4.3 min', written['description'])

    def test_last_e2e_failure_preserves_real_jobs_and_their_verdict(self):
        for status, conclusion, expected in [('in_progress', None, 'pending'), ('completed', 'failure', 'failure')]:
            with self.subTest(status=status):
                record = self.e2e_record('failure')
                record['jobs']['4'][0].update(status=status, conclusion=conclusion)
                with patch.object(pv, 'verdict', wraps=pv.verdict) as decide:
                    self.assertEqual(self.write(record)['state'], expected)
                self.assertEqual(decide.call_args.args[3][4], record['jobs']['4'])

    def test_a_sibling_still_running_keeps_the_verdict_pending(self):
        record = copy.deepcopy(RECORDED)
        record['runs'][2].update(status='in_progress', conclusion='')
        record['jobs']['3'] = [{'id': 30, 'name': 'desktop', 'status': 'in_progress', 'steps': []}]
        self.assertEqual(self.write(record)['state'], 'pending')

    def test_a_completion_for_another_head_cannot_clear_python(self):
        record = copy.deepcopy(RECORDED)
        record['event']['workflow_run']['head_sha'] = 'old-head'
        self.assertEqual(self.write(record)['state'], 'pending')

    def test_an_old_attempt_cannot_clear_a_rerun_of_the_same_id(self):
        record = copy.deepcopy(RECORDED)
        record['runs'][-1]['attempt'] = 2
        self.assertEqual(self.write(record)['state'], 'pending')

    def test_an_old_run_cannot_clear_a_newer_run_of_the_same_workflow(self):
        record = copy.deepcopy(RECORDED)
        newer = dict(record['runs'][-1], databaseId=5, createdAt='2026-10-30T01:03:00Z')
        record['runs'].append(newer)
        record['jobs']['5'] = [{'id': 50, 'name': 'python', 'status': 'in_progress', 'steps': []}]
        self.assertEqual(self.write(record)['state'], 'pending')

    def test_a_lagging_list_stays_pending_without_a_second_read(self):
        record = copy.deepcopy(RECORDED)
        record['event']['workflow_run']['head_sha'] = 'old-head'
        self.assertEqual(self.write(record)['state'], 'pending', 'a later event or sweep owns the next read')

    def test_a_ci_change_budgets_running_time_not_the_runner_queue(self):
        # Keep bf7dfa1's running-time budget coverage; the completed state is read once.
        record = copy.deepcopy(RECORDED)
        record['event']['workflow_run']['head_sha'] = 'old-head'
        record['jobs'] = {str(n): [{'name': 'tests', 'status': 'completed', 'conclusion': 'success', 'started_at': '2026-10-30T00:58:00Z',
                                    'completed_at': '2026-10-30T01:01:00Z'}] for n in (1, 2, 3, 4)}
        record['runs'] = [dict(r, status='completed', conclusion='success', createdAt='2026-10-30T00:48:00Z') for r in record['runs']]
        written = self.write(record, files=('tools/pr-verdict.py',))
        self.assertEqual(written['state'], 'success', written)
        self.assertIn('min waiting for runners', written['description'])

    def test_a_job_s_own_step_writes_nothing_and_reads_nothing(self):
        # Why (owner, 30 Oct 2026, "One writer"): a branch not yet rebased still runs the old per-job step; it must cost no GitHub call.
        from unittest import mock
        with mock.patch.object(sys, 'argv', ['pr-verdict.py', '--repo', 'o/r', '--sha', '263ca66', '--job-status', 'success']), \
             mock.patch.object(pv, 'gh', side_effect=AssertionError('no GitHub call from a job step')) as gh, mock.patch.object(sys, 'stdout'):
            self.assertEqual(pv.main(), 0)
        self.assertEqual(gh.call_count, 0)


if __name__ == '__main__':
    unittest.main()
