"""GitHub run/attempt evidence must prove two backbone reds before a revert PR can open."""
import copy
import json
import unittest
from pathlib import Path
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
