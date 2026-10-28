"""GitHub run/attempt evidence must prove two backbone reds before a revert PR can open."""
import copy
import json
import io
import os
import subprocess
from contextlib import redirect_stdout, redirect_stderr
from unittest.mock import patch
import unittest
from pathlib import Path
from tools import backbone_red as backbone
from tools.backbone_red import candidate, collect

FIXTURES = Path(__file__).parent / 'fixtures'
# Supplied fixtures are HAND-MADE, not captured REST responses: all ids, times, logs
# and provenance fields are synthetic. No local recorded red/red pair was supplied.
SHA = 'a' * 40


def records(name='red-red'):
    return json.loads((FIXTURES / f'backbone-{name}.json').read_text())['records']


class BackboneRedTest(unittest.TestCase):
    def test_red_red_pair_proves_the_same_suite_on_distinct_attempts(self):
        proof = candidate(records(), SHA, {})
        self.assertIsNotNone(proof)
        self.assertEqual(proof['suite'], 'apply')
        self.assertEqual(proof['attempts'], ['501/1', '501/2'])

    def test_red_green_pair_is_a_flip_not_a_revert(self):
        self.assertIsNone(candidate(records('red-green'), SHA, {}))

    def test_tolerant_suspended_and_retired_are_not_reverted(self):
        for lane in ['tolerant', 'suspended', 'retired']:
            self.assertIsNone(candidate(records(), SHA, {'apply': {'lane': lane}}))

    def test_health_install_credit_runner_and_unknown_are_not_red_evidence(self):
        for change in ['install', 'credit', 'runner', 'unknown', 'intermittent']:
            data = records()
            for item in data:
                job = item['jobs'][0]
                if change == 'install': job['steps'][0]['conclusion'] = 'failure'
                if change == 'credit': item['logs'][str(job['id'])] = '✗ AI call: credit balance is too low'
                if change == 'runner': job['conclusion'] = 'cancelled'
                if change == 'unknown': item['logs'] = {}
                if change == 'intermittent': item['logs'][str(job['id'])] += '🔁 intermittent'
            self.assertIsNone(candidate(data, SHA, {}), change)

    def test_wrong_commit_wrong_run_duplicate_or_different_suite_do_not_count_twice(self):
        for change in ['sha', 'title', 'branch', 'path', 'duplicate', 'suite']:
            data = records()
            last = data[-1]
            if change == 'sha': last['run']['head_sha'] = 'b' * 40
            if change == 'title': last['run']['display_title'] = 'E2E for PR · apply · branch'
            if change == 'branch': last['run']['head_branch'] = 'branch'
            if change == 'path': last['run']['path'] = '.github/workflows/not-e2e.yml'
            if change == 'duplicate': last['run']['run_attempt'] = 1
            if change == 'suite': last['jobs'][0]['name'] = 'settings'
            self.assertIsNone(candidate(data, SHA, {}), change)

    def test_same_attempt_two_failed_shards_is_only_one_red(self):
        data = records()[:1]
        extra = copy.deepcopy(data[0]['jobs'][0]); extra['name'] = 'apply-2of2'
        data[0]['jobs'].append(extra)
        self.assertIsNone(candidate(data, SHA, {}))

    def test_history_fetches_each_attempt_and_all_job_pages(self):
        calls = []
        data = records()
        def read(endpoint):
            calls.append(endpoint)
            if '/attempts/' in endpoint and '/jobs?' not in endpoint:
                return data[int(endpoint.rsplit('/', 1)[-1]) - 1]['run']
            if '/jobs?' in endpoint:
                number = int(endpoint.split('/attempts/')[1].split('/')[0])
                if 'page=2' in endpoint: return {'jobs': data[number - 1]['jobs'], 'total_count': 101}
                return {'jobs': [{'id': i, 'name': 'plan', 'conclusion': 'success'} for i in range(100)], 'total_count': 101}
            return {'workflow_runs': [data[-1]['run']]}
        got = collect('GarryOne/jobadabra', SHA, read, lambda job: '✗ Filled row: expected 3 fields, got 2')
        proof = candidate(got, SHA, {})
        self.assertIsNotNone(proof)
        self.assertEqual(proof['attempts'], ['501/1', '501/2'])
        self.assertTrue(any('page=2' in call for call in calls))

    def test_a_missing_or_running_latest_suite_interrupts_the_red_pair(self):
        for change in ('missing', 'running'):
            data = records()
            latest = copy.deepcopy(data[-1])
            latest['run']['run_attempt'] = 3
            latest['run']['run_started_at'] = '2026-10-28T10:10:00Z'
            if change == 'missing': latest['jobs'] = []
            if change == 'running': latest['run']['status'] = 'in_progress'
            data.append(latest)
            self.assertIsNone(candidate(data, SHA, {}), change)

    def test_an_incomplete_sharded_suite_is_not_two_red_observations(self):
        data = records()
        for item in data:
            item['jobs'][0]['name'] = 'apply-1of2'
        self.assertIsNone(candidate(data, SHA, {}))

    def test_a_prior_flip_on_this_commit_prevents_later_reds_authorizing_a_revert(self):
        data = records('red-green') + records()
        for i, item in enumerate(data):
            item['run']['run_attempt'] = i + 1
            item['run']['run_started_at'] = f'2026-10-28T10:{i:02d}:00Z'
        self.assertIsNone(candidate(data, SHA, {}))

    def test_a_health_grey_does_not_erase_a_red_then_green_flip(self):
        data = records('red-green') + records()
        grey = copy.deepcopy(data[0])
        grey['jobs'] = []
        data.insert(1, grey)
        for i, item in enumerate(data):
            item['run']['run_attempt'] = i + 1
            item['run']['run_started_at'] = f'2026-10-28T10:{i:02d}:00Z'
        self.assertIsNone(candidate(data, SHA, {}))

    def test_workflow_event_must_be_after_merge_dispatch(self):
        data = records()
        for item in data: item['run']['event'] = 'pull_request'
        self.assertIsNone(candidate(data, SHA, {}))

    def test_cancelled_or_timed_out_workflow_is_health_grey(self):
        for conclusion in ('cancelled', 'timed_out', 'startup_failure', None):
            data = records()
            for item in data: item['run']['conclusion'] = conclusion
            self.assertIsNone(candidate(data, SHA, {}), conclusion)

    def test_an_empty_page_before_the_declared_end_refuses_partial_evidence(self):
        from tools.backbone_red import pages
        def read(endpoint):
            return {'workflow_runs': records(), 'total_count': 3} if '&page=1' in endpoint else {'workflow_runs': [], 'total_count': 3}
        with self.assertRaises(ValueError):
            pages('runs?', 'workflow_runs', read)

    def test_two_distinct_after_merge_runs_can_prove_the_pair(self):
        data = records()
        data[-1]['run'].update(id=502, run_attempt=1)
        proof = candidate(data, SHA, {})
        self.assertIsNotNone(proof)
        self.assertEqual(proof['attempts'], ['501/1', '502/1'])


class OneBackboneSuiteRedAfterMerge(unittest.TestCase):
    """HAND-MADE REST evidence: one backbone red after a merge must request its second attempt."""
    repo = 'GarryOne/jobadabra'

    def run_main(self, data, head=SHA, flags=None):
        """Stub process boundaries only: real REST collection, classification and CLI decisions run."""
        calls = []
        registry = (Path(__file__).resolve().parent.parent / 'desktop/e2e/lanes.json').read_text()
        def process(command, **kwargs):
            calls.append((command, kwargs))
            if command[:2] == ['gh', 'api']:
                endpoint = command[2]
                if endpoint.endswith('/commits/main'): value = {'sha': head}
                elif '/commits/' in endpoint and '/pulls?' in endpoint:
                    value = [{'number': 42, 'merged_at': '2026-10-28T09:00:00Z', 'base': {'ref': 'main'}, 'merge_commit_sha': SHA}]
                elif '/runs?' in endpoint: value = {'workflow_runs': [data[-1]['run']]}
                elif '/attempts/' in endpoint:
                    attempt = int(endpoint.split('/attempts/')[1].split('/')[0])
                    record = next(r for r in data if r['run']['run_attempt'] == attempt)
                    value = {'jobs': record['jobs'], 'total_count': len(record['jobs'])} if '/jobs?' in endpoint else record['run']
                elif endpoint.endswith('/logs'):
                    job_id = endpoint.split('/jobs/')[1].split('/')[0]
                    return subprocess.CompletedProcess(command, 0, next(r['logs'][job_id] for r in data if job_id in r['logs']))
                elif endpoint.endswith('/runs/501'): value = data[-1]['run']
                else: self.fail(f'unexpected REST call: {endpoint}')
                return subprocess.CompletedProcess(command, 0, json.dumps(value))
            if command[0] == 'git':
                self.assertEqual(command[3:], ['show', f'{SHA}:desktop/e2e/lanes.json'])
                return subprocess.CompletedProcess(command, 0, registry)
            if command[:3] == ['gh', 'run', 'rerun'] or command[0] == 'bash':
                return subprocess.CompletedProcess(command, 0, '')
            self.fail(f'unexpected process: {command}')
        output = io.StringIO()
        with patch.object(backbone.subprocess, 'run', side_effect=process), redirect_stdout(output), patch.dict(os.environ, {'GH_TOKEN': 'fake-app', 'RERUN_TOKEN': 'fake-actions'}):
            result = backbone.main(['--repo', self.repo, '--run', '501', *(flags if flags is not None else ['--open'])])
        writes = [(cmd, kw) for cmd, kw in calls if cmd[0] != 'git' and cmd[:2] != ['gh', 'api']]
        return result, output.getvalue(), writes

    def test_one_backbone_suite_is_red_after_merge_requests_one_second_attempt(self):
        data = records()[:1]
        self.assertEqual(backbone.second_attempt_run(data, SHA, {}), 501)
        result, output, writes = self.run_main(data)
        self.assertEqual(result, 0, output)
        self.assertEqual([cmd for cmd, _ in writes], [['gh', 'run', 'rerun', '501', '--failed', '--repo', self.repo]])
        self.assertEqual(writes[0][1]['env']['GH_TOKEN'], 'fake-actions', 'rerun uses actions-write token, not PR App token')
        self.assertIn('second attempt requested (run 501)', output)

    def test_one_backbone_suite_red_after_merge_never_requests_a_third_attempt(self):
        for name, want_revert in [('red-red', True), ('red-green', False), ('running-second', False)]:
            with self.subTest(name=name):
                data = records('red-red' if name == 'running-second' else name)
                if name == 'running-second': data[-1]['run'].update(status='in_progress', conclusion=None)
                self.assertIsNone(backbone.second_attempt_run(data, SHA, {}))
                result, output, writes = self.run_main(data)
                self.assertEqual(result, 0, output)
                self.assertEqual(len(writes), int(want_revert))
                if want_revert:
                    self.assertEqual(writes[0][0][0], 'bash')
                    self.assertTrue(writes[0][0][1].endswith('/tools/revert-red.sh'))
                    self.assertEqual(writes[0][0][2], SHA)

    def test_one_backbone_suite_red_after_merge_health_or_running_evidence_waits(self):
        for change in ('runner', 'install', 'credit', 'unknown', 'shard', 'running', 'job-running', 'cancelled', 'green'):
            with self.subTest(change=change):
                data = records()[:1]
                record, job = data[0], data[0]['jobs'][0]
                if change == 'runner': job['conclusion'] = 'cancelled'
                if change == 'install': job['steps'][0]['conclusion'] = 'failure'
                if change == 'credit': record['logs'][str(job['id'])] = '✗ AI call: credit balance is too low'
                if change == 'unknown': record['logs'][str(job['id'])] = ''
                if change == 'shard': job['name'] = 'apply-1of2'
                if change == 'running': record['run']['status'] = 'in_progress'
                if change == 'job-running': job.update(status='in_progress', conclusion=None)
                if change == 'cancelled': record['run']['conclusion'] = 'cancelled'
                if change == 'green': job['conclusion'] = record['run']['conclusion'] = 'success'
                self.assertIsNone(backbone.second_attempt_run(data, SHA, {}))
                result, output, writes = self.run_main(data)
                self.assertEqual(result, 0, output)
                self.assertEqual(writes, [])

    def test_one_backbone_suite_red_after_merge_only_active_backbone_is_retried(self):
        for lane in ('tolerant', 'suspended', 'retired'):
            self.assertIsNone(backbone.second_attempt_run(records()[:1], SHA, {'apply': {'lane': lane}}), lane)
        data = records()[:1]
        data[0]['run']['display_title'] = f'E2E after merge · {SHA[:7]} · quality'
        data[0]['jobs'][0]['name'] = 'quality'
        result, output, writes = self.run_main(data)
        self.assertEqual(result, 0, output)
        self.assertEqual(writes, [], 'real registry makes quality tolerant')

    def test_one_backbone_suite_red_after_merge_moved_main_or_other_run_waits(self):
        self.assertIsNone(backbone.second_attempt_run(records()[:1], 'b' * 40, {}))
        result, output, writes = self.run_main(records()[:1], head='b' * 40)
        self.assertEqual(result, 0, output)
        self.assertEqual(writes, [])
        for change in ('title', 'event', 'branch', 'path'):
            data = records()[:1]
            if change == 'title': data[0]['run']['display_title'] = 'E2E check · on time'
            if change == 'event': data[0]['run']['event'] = 'pull_request'
            if change == 'branch': data[0]['run']['head_branch'] = 'topic'
            if change == 'path': data[0]['run']['path'] = '.github/workflows/other.yml'
            self.assertIsNone(backbone.second_attempt_run(data, SHA, {}), change)
            result, output, writes = self.run_main(data)
            self.assertEqual(result, 0, output)
            self.assertEqual(writes, [], change)

    def test_one_backbone_suite_red_after_merge_read_only_or_offline_never_reruns(self):
        result, output, writes = self.run_main(records()[:1], flags=[])
        self.assertEqual(result, 0, output)
        self.assertEqual(writes, [])
        with patch.object(backbone.subprocess, 'run', side_effect=AssertionError('offline must never start a process')), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(backbone.main(['--runs-json', str(FIXTURES / 'backbone-red-red.json'), '--open']), 2)
