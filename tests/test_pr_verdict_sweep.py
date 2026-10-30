"""Exercise PR verdict sweep selection and repair using the offline GitHub transport."""
import unittest
from tests import test_pr_verdict as base
from tests.test_pr_verdict import run, job


class Sweep(unittest.TestCase):
    run_step = base.TheScriptAsAJobRunsIt.run_step

    def test_sweep_repairs_pending_or_missing_heads_without_a_completion_event(self):
        # Owner's 30 Oct incident: an ended red e2e, pending status, zero live runs, no delivered event.
        for status in ('PENDING', None):
            for conclusion, expected in (('failure', 'failure'), ('success', 'success')):
                with self.subTest(status=status, conclusion=conclusion):
                    node = {'headRefOid': 'abc1234', 'commits': {'nodes': [{'commit': {'status': {'contexts':
                        [{'context': 'All checks passed', 'state': status}] if status else []}}}]}}
                    terminal = [{'headRefOid': state, 'commits': {'nodes': [{'commit': {'status': {'contexts':
                        [{'context': 'All checks passed', 'state': state}]}}}]}} for state in ('SUCCESS', 'FAILURE', 'ERROR')]
                    plan, _, calls = self.run_step([], sweep_heads=[node, *terminal])
                    self.assertEqual(plan.returncode, 0, plan.stderr)
                    self.assertIn('heads=["abc1234"]', plan.stdout)
                    self.assertEqual(calls.count('api graphql'), 1, 'one PR/status listing, no REST status scan per PR')
                    e2e = run('E2E', event='workflow_dispatch', title='E2E for PR · settings · topic', id=2, conclusion=conclusion)
                    done, written, calls = self.run_step([{'number': 7, 'state': 'open', 'merged_at': None}],
                        runs=[run('CI · Pull request'), e2e], jobs={2: [job(20, 'settings', conclusion=conclusion)]}, idle_only=True)
                    self.assertEqual(done.returncode, 0, done.stderr)
                    self.assertIn('"state=' + expected + '"', written, done.stdout)
                    self.assertEqual(calls.count('run list'), 1)

    def test_sweep_leaves_live_heads_pending_and_closed_prs_untouched(self):
        for status in ('queued', 'in_progress', 'waiting'):
            done, written, calls = self.run_step([{'number': 7, 'state': 'open', 'merged_at': None}],
                runs=[run('CI · Tests · python', status=status)], idle_only=True)
            self.assertEqual((done.returncode, written), (0, ''), done.stderr)
            self.assertEqual(calls.count('run list'), 1)
        done, written, _ = self.run_step([{'number': 7, 'state': 'closed', 'merged_at': None}], idle_only=True)
        self.assertEqual((done.returncode, written), (0, ''), done.stderr)


if __name__ == '__main__':
    unittest.main()
