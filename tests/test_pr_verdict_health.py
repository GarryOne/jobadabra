"""Recorded CI health failures use the verdict's existing grey map; unrelated failures remain red."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pr_verdict', ROOT / 'tools/pr-verdict.py')
pv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv)
RECORDED = json.loads((ROOT / 'tests/fixtures/pr-verdict-health.json').read_text())


def run():
    return {'databaseId': 7, 'workflowName': 'E2E', 'displayTitle': 'E2E for PR · apply,employers · topic',
            'event': 'workflow_dispatch', 'status': 'completed', 'conclusion': 'failure',
            'createdAt': '2026-10-28T11:00:00Z', 'updatedAt': '2026-10-28T11:01:00Z'}


class HealthGreys(unittest.TestCase):
    def grey(self, job, annotations=(), log=''):
        return pv.health_greys('o/r', [run()], {7: [job]},
                               annotations_of=lambda _: annotations, log_of=lambda _: log)

    def test_recorded_runner_never_acquired_is_grey_without_a_log(self):
        record = RECORDED['runner']
        self.assertEqual(record['job']['steps'], [])
        greys = self.grey(record['job'], record['annotations'])
        self.assertEqual(greys, {record['job']['id']: 'runner'})
        state, why, *_ = pv.verdict([run()], jobs={7: [record['job']]}, greys=greys)
        self.assertEqual(state, 'success', why)
        self.assertIn('runner not acquired', why)

    def test_recorded_cap_annotation_in_isolation_is_health(self):
        # Replay just the recorded cap failure; the actual job also had an unrelated assertion (next test).
        record = RECORDED['ai_mixed']
        annotation = next(a for a in record['annotations'] if 'ai-capped:' in a['message'])
        log = f"✗ {annotation['title']}: {annotation['message']}"
        greys = self.grey(record['job'], [annotation], log)
        self.assertEqual(greys, {record['job']['id']: 'ai-credit'})
        self.assertIn('AI cap or credit', pv.verdict([run()], jobs={7: [record['job']]}, greys=greys)[1])

    def test_the_recorded_mixed_job_stays_red(self):
        record = RECORDED['ai_mixed']
        log = '\n'.join(f"✗ {a['title']}: {a['message']}" for a in record['annotations'] if ' · ' in a['title'])
        self.assertEqual(self.grey(record['job'], record['annotations'], log), {})

    def test_cancellation_without_capacity_evidence_and_a_started_runner_stay_red(self):
        record = RECORDED['runner']
        self.assertEqual(self.grey(record['job']), {})
        job = {**record['job'], 'steps': [{'name': 'Test', 'conclusion': 'failure'}]}
        self.assertEqual(self.grey(job, record['annotations']), {})

    def test_credit_errors_are_not_a_blanket_for_ai_assertions_or_deliberate_stubs(self):
        job = RECORDED['ai_mixed']['job']
        for text in ('score was 20, expected 80', 'the AI refused (400): the suite armed the stub no-credit on purpose'):
            self.assertEqual(self.grey(job, [], f'✗ judge: {text}'), {})

    def test_failed_reads_are_isolated_and_cannot_make_a_job_green(self):
        record = RECORDED['runner']
        def broken(_):
            raise OSError('annotations unavailable')
        self.assertEqual(pv.health_greys('o/r', [run()], {7: [record['job']]}, annotations_of=broken), {})
        job = copy.deepcopy(record['job'])
        job['status'] = 'in_progress'
        self.assertEqual(self.grey(job, record['annotations']), {})

    def test_install_transport_is_scoped_to_the_failed_step(self):
        # Reconstructed network fault until a recorded install red is supplied; this is not the spec's acceptance proof.
        step = {'name': 'Install the app', 'conclusion': 'failure',
                'started_at': '2026-10-28T11:00:00Z', 'completed_at': '2026-10-28T11:00:05Z'}
        job = {**RECORDED['ai_mixed']['job'], 'steps': [step]}
        log = '2026-10-28T11:00:02.123Z npm error code ECONNRESET'
        self.assertEqual(self.grey(job, [], log), {job['id']: 'install'})
        state, why, *_ = pv.verdict([run()], jobs={7: [job]}, greys={job['id']: 'install'})
        self.assertEqual(state, 'success', why)
        self.assertIn('install download unavailable', why)
        self.assertEqual(self.grey(job, [], log.replace('11:00:02', '10:59:00')), {}, 'an earlier recovered error is no proof')
        self.assertEqual(self.grey(job, [], log.replace('ECONNRESET', 'EUSAGE')), {}, 'lockfile mismatches belong to the diff')
        self.assertEqual(self.grey(job, [], log + '\n✗ app launches: crashed'), {}, 'a suite assertion still blocks')

    def test_a_cap_does_not_hide_another_ci_step_failing(self):
        record = RECORDED['ai_mixed']
        annotation = next(a for a in record['annotations'] if 'ai-capped:' in a['message'])
        job = {**record['job'], 'steps': [*record['job']['steps'], {'name': 'Install another package', 'conclusion': 'failure'}]}
        self.assertEqual(self.grey(job, [annotation], f"✗ judge: {annotation['message']}"), {})


if __name__ == '__main__':
    unittest.main()
