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
                        runs=[run('CI · Pull request'), e2e], jobs={2: [job(20, 'settings', conclusion=conclusion)]}, revalidate_head=True)
                    self.assertEqual(done.returncode, 0, done.stderr)
                    self.assertIn('"state=' + expected + '"', written, done.stdout)
                    self.assertEqual(calls.count('run list'), 1)

    def test_started_sweep_writes_pending_if_a_counted_run_became_live(self):
        for status in ('queued', 'in_progress', 'waiting'):
            done, written, calls = self.run_step([{'number': 7, 'state': 'open', 'merged_at': None}],
                runs=[run('CI · Tests · python', status=status)], revalidate_head=True)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertIn('state=pending', written)
            self.assertEqual(calls.count('run list'), 1)
        for pr in ({'state': 'closed', 'merged_at': None}, {'state': 'closed', 'merged_at': '2026-10-30T00:00:00Z'},
                   {'state': 'open', 'merged_at': None, 'head_sha': 'replaced'}):
            done, written, _ = self.run_step([dict(pr, number=7)], revalidate_head=True)
            self.assertEqual((done.returncode, written), (0, ''), done.stderr)

    def test_planner_does_not_schedule_a_head_while_its_event_writer_and_counted_run_are_live(self):
        node = {'headRefOid': 'abc1234', 'commits': {'nodes': [{'commit': {'status': None}}]}}
        writer = run('CI · PR verdict', status='in_progress', event='workflow_run', id=99)
        for status in ('queued', 'in_progress', 'waiting'):
            plan, written, calls = self.run_step([], runs=[writer, run('python', status=status)], sweep_heads=[node])
            self.assertEqual(plan.returncode, 0, plan.stderr)
            self.assertIn('heads=[]', plan.stdout, 'planning stays outside the writer queue and cannot cancel the writer')
            self.assertEqual(written, '')
            self.assertEqual(calls.count('run list'), 1)

    def test_skipped_planners_cannot_queue_behind_or_replace_a_real_sweep(self):
        planner = (base.WORKFLOWS / 'pr-verdict.yml').read_text().split('  sweep:\n', 1)[1].split('\n  verdict:', 1)[0]
        group = planner.split('      group:', 1)[1].split('\n', 1)[0].strip()
        def key(event, rid):
            if '${{' not in group: return group
            expr = group.split('${{', 1)[1].split('}}', 1)[0]
            expr = expr.replace('github.event_name', repr(event)).replace('github.run_id', repr(rid))
            return eval(expr.replace('&&', ' and ').replace('||', ' or ').strip())
        self.assertEqual(key('schedule', '1'), key('workflow_dispatch', '2'))
        self.assertNotEqual(key('workflow_run', '3'), key('schedule', '1'))
        self.assertNotEqual(key('workflow_run', '3'), key('workflow_run', '4'))

    def test_planner_requires_counted_runs_and_ignores_superseded_or_non_pr_runs(self):
        node = {'headRefOid': 'abc1234', 'commits': {'nodes': [{'commit': {'status': None}}]}}
        other = run('bisect', status='in_progress', event='workflow_dispatch', id=3)
        for runs, expected in (([], '[]'), ([other], '[]'),
                               ([other, run('python', status='in_progress'),
                                 run('python', id=2, at='2026-10-26T03:01:00Z')], '["abc1234"]')):
            plan, _, _ = self.run_step([], runs=runs, sweep_heads=[node])
            self.assertEqual(plan.returncode, 0, plan.stderr)
            self.assertIn('heads=' + expected, plan.stdout)


if __name__ == '__main__':
    unittest.main()
