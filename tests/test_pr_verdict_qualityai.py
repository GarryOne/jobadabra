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


if __name__ == '__main__':
    unittest.main()
