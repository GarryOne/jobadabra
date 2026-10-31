"""Guard qualityai job/attempt attribution and bounded unreadable results with offline GitHub responses."""
import unittest
from tests import test_pr_ai_number as base


class MeasurementOwnership(unittest.TestCase):
    qualityai_post = base.Artifacts.qualityai_post

    def test_previous_attempt_artifact_cannot_clear_a_new_attempts_crash(self):
        for previous, expected in ((True, 'failure'), (False, 'success')):
            with self.subTest(previous=previous):
                post = self.qualityai_post('failure', 'qualityai', base.RATES, False, attempt=2, previous=previous)
                self.assertIn('state=' + expected, post)

    def test_another_jobs_number_cannot_clear_a_crashed_shard(self):
        post = self.qualityai_post('failure', 'E2E · Mac + Linux · qualityai-1of2', base.RATES, False, peer=True)
        self.assertIn('state=failure', post)

    def test_unreadable_result_expires_after_run_completion_instead_of_sticking_pending(self):
        for age, expected in ((29, 'pending'), (31, 'failure')):
            with self.subTest(age=age):
                post = self.qualityai_post('failure', 'qualityai', base.RATES, False, fail_at='/zip', age_min=age)
                self.assertIn('state=' + expected, post)
                if expected == 'failure':
                    self.assertTrue(any('qualityai result unreadable' in arg for arg in post), post)


class BudgetRefusal(unittest.TestCase):
    qualityai_post = base.Artifacts.qualityai_post
    reason = 'broker: budget:own-share 67.0% of 60% (scheduled)'
    message = ('AI asks with no stored answer: 1 (first: fixture-key); the AI was refused: '
               + reason + '; the step then failed: 503 ai-capped: the Codex broker said no')

    def record(self, message=None):
        """Mirror ai-miss-cause's failureRecords output, including its original symptom."""
        return {'suite': 'qualityai', 'step': 'judge facts', 'message': message or self.message}

    def test_artifact_budget_refusal_alone_is_grey_and_named_in_the_final_status(self):
        post = self.qualityai_post('failure', 'qualityai', None, False,
                                  files={'ai-capped.json': {'neurons': None, 'why': self.reason},
                                         'suite-failures.json': [self.record()]})
        self.assertIn('state=success', post)
        self.assertTrue(any('qualityai: AI budget refused, not judged' in arg for arg in post), post)

    def test_old_artifact_without_why_uses_the_named_failure_annotation(self):
        post = self.qualityai_post('failure', 'qualityai', None, False,
                                  files={'ai-capped.json': {'neurons': None}},
                                  annotations=[{'annotation_level': 'failure', 'title': 'qualityai · judge facts',
                                                'message': self.message}])
        self.assertIn('state=success', post)
        self.assertTrue(any('qualityai: AI budget refused, not judged' in arg for arg in post), post)

    def test_refusal_plus_real_assertion_stays_red_even_when_both_have_the_refusal_prefix(self):
        assertion = self.message.split('; the step then failed: ')[0] + '; the step then failed: facts differ'
        for counts in (None, base.RATES):
            with self.subTest(counts=counts):
                post = self.qualityai_post('failure', 'qualityai', counts, False,
                                          files={'ai-capped.json': {'why': self.reason},
                                                 'suite-failures.json': [self.record(), self.record(assertion)]})
                self.assertIn('state=failure', post)

    def test_annotations_cannot_override_a_structured_nonbudget_refusal(self):
        post = self.qualityai_post('failure', 'qualityai', None, False,
                                  files={'ai-capped.json': {'why': 'broker: login missing'},
                                         'suite-failures.json': [self.record()]},
                                  annotations=[{'annotation_level': 'failure', 'title': 'qualityai · judge facts',
                                                'message': self.message}])
        self.assertIn('state=failure', post)

    def test_nonbudget_or_unmarked_failure_stays_red(self):
        for why in ('broker: login missing', 'neuron cap', ''):
            with self.subTest(why=why):
                post = self.qualityai_post('failure', 'qualityai', None, False,
                                          files={'ai-capped.json': {'why': why},
                                                 'suite-failures.json': [self.record('facts differ')]})
                self.assertIn('state=failure', post)

    def test_every_title_and_other_check_still_decides_with_the_grey_note(self):
        files = {'ai-capped.json': {'why': self.reason}, 'suite-failures.json': [self.record()]}
        for other, expected in (('success', 'success'), ('failure', 'failure'), ('in_progress', 'pending')):
            with self.subTest(other=other):
                plain = self.qualityai_post('failure', 'qualityai', None, False, other_status=other)
                self.assertIn('state=failure', plain)  # count fix alone: automatic red is retained
                post = self.qualityai_post('failure', 'qualityai', None, False, files=files, other_status=other)
                self.assertIn('state=' + expected, post)
                self.assertTrue(any('qualityai: AI budget refused, not judged' in arg for arg in post), post)

    def test_a_failure_in_another_job_step_cannot_be_cleared_by_the_suite_refusal(self):
        post = self.qualityai_post('failure', 'qualityai', None, False,
                                  files={'ai-capped.json': {'why': self.reason},
                                         'suite-failures.json': [self.record()]},
                                  extra_step='Scan artifact contents for CI secrets')
        self.assertIn('state=failure', post)

    def test_annotation_refusal_plus_assertion_stays_red(self):
        for message in ('facts differ', self.message.replace('503 ai-capped:', 'facts differ:')):
            with self.subTest(message=message):
                annotations = [{'annotation_level': 'failure', 'title': 'qualityai · judge facts',
                                'message': text} for text in (self.message, message)]
                post = self.qualityai_post('failure', 'qualityai', None, False, annotations=annotations)
                self.assertIn('state=failure', post)

    def test_later_qualityai_title_keeps_its_number_without_clearing_the_older_failure(self):
        from datetime import datetime, timedelta, timezone
        from tests.test_pr_verdict import pv, run
        from tools import pr_ai_number as ai
        end = datetime.now(timezone.utc)
        stamp = lambda value: value.isoformat().replace('+00:00', 'Z')
        runs = [dict(run('E2E', event='workflow_dispatch', id=rid,
                         title=title, conclusion=conclusion, at=stamp(end - timedelta(minutes=offset)),
                         end=stamp(end)), attempt=1) for rid, title, conclusion, offset in (
                             (7, 'E2E for PR · qualityai,settings · topic', 'failure', 5),
                             (8, 'E2E for PR · qualityai · topic', 'success', 4))]
        jobs = {rid: [{'id': rid * 10, 'name': 'qualityai', 'status': 'completed',
                       'conclusion': conclusion, 'run_attempt': 1,
                       'started_at': stamp(end - timedelta(minutes=3)), 'completed_at': stamp(end)}]
                for rid, conclusion in ((7, 'failure'), (8, 'success'))}
        github = base.Github([], {8: [{'id': 8, 'name': ai.ARTIFACT}]}, {8: base.archive()})
        reports, line = ai.prepare('o/r', pv.counted(runs), jobs, github,
                                   lambda name='main_e2e_state': __import__('tools.' + name, fromlist=[name]))
        state, why, *_ = pv.verdict(runs, jobs=jobs, reports=reports)
        self.assertEqual(state, 'failure')
        self.assertIn('facts 63/63', line(why))

    def test_prior_attempts_budget_refusal_cannot_clear_the_current_crash(self):
        post = self.qualityai_post('failure', 'qualityai', None, False, attempt=2, previous=True,
                                  files={'ai-capped.json': {'why': self.reason},
                                         'suite-failures.json': [self.record()]})
        self.assertIn('state=failure', post)

    def test_unreadable_refusal_evidence_keeps_the_existing_deadline(self):
        for age, expected in ((29, 'pending'), (31, 'failure')):
            with self.subTest(age=age):
                post = self.qualityai_post('failure', 'qualityai', None, False,
                                          fail_at='/annotations?', age_min=age)
                self.assertIn('state=' + expected, post)


if __name__ == '__main__':
    unittest.main()
