# Verify AI number composition in every PR verdict writer.
import os
import sys
import unittest

from tests.test_pr_verdict import ROOT, WORKFLOWS, pv, run


class TheAiNumberInEveryWriter(unittest.TestCase):
    def write_case(self, kind, timed=False):
        """Exercise the real main loop and status POST with only GitHub and time replaced."""
        from unittest import mock
        from tools import pr_ai_number as ai, pr_speed_number as speed
        from tests.test_pr_ai_number import RATES
        from tests.test_pr_speed_number import Github
        speed_gh = Github(200, baseline=(130,) * 12)
        r = run('E2E', event='workflow_dispatch', title='E2E for PR · qualityai,settings · topic', id=7)
        if timed:
            r['displayTitle'] = 'E2E for PR · qualityai,jobs,settings · topic'
            speed_gh.artifacts[7] = speed_gh.artifacts.pop(99)
        jobs = {7: [{'id': 71, 'name': 'qualityai', 'status': 'completed', 'conclusion': 'success'},
                    {'id': 72, 'name': 'settings', 'status': 'completed', 'conclusion': 'success'}]}
        if kind == 'settling':
            r.update(status='in_progress')
            jobs[7] = [jobs[7][1]]   # measured artifact read independently; another job is still being created
        elif kind == 'pending':
            r.update(status='in_progress')
            jobs[7][1].update(status='in_progress', steps=[{'name': 'tests', 'status': 'in_progress'}])
        elif kind == 'grey':
            jobs[7][1]['conclusion'] = 'failure'
        elif kind == 'red':
            jobs[7][1]['conclusion'] = 'failure'
        elif kind == 'early-red':
            r.update(status='in_progress')
            jobs[7][1]['conclusion'] = 'failure'
            jobs[7].append({'id': 73, 'name': 'jobs', 'status': 'in_progress', 'steps': [{'name': 'tests', 'status': 'in_progress'}]})
        sent = []
        # Why (owner, 30 Oct 2026, "One writer"): only pr-verdict.yml writes; a job's own step (--job-status) writes nothing.
        with mock.patch.dict(os.environ, {'GITHUB_RUN_ID': '99', 'RUNNER_NAME': 'ours'}), \
             mock.patch.object(sys, 'argv', ['pr-verdict.py', '--repo', 'o/r', '--sha', 'head']), \
             mock.patch.object(sys, 'stdout'), mock.patch.object(pv, 'read', return_value=([r], jobs)), \
             mock.patch.object(pv, 'pr_meta', return_value=([{'number': 1, 'state': 'open'}], [], [])), \
             mock.patch.object(pv, 'main_state_module', side_effect=lambda repo, ref, name='main_e2e_state': ai if name == 'pr_ai_number' else speed if name == 'pr_speed_number' else mock.Mock()), \
             mock.patch.object(ai, 'report_suites', return_value={'qualityai'}), mock.patch.object(ai, 'numbers', return_value=(RATES, RATES)) as read_number, \
             mock.patch.object(pv, 'main_red_greys', return_value=set() if kind in ('red', 'early-red') else {72}), \
             mock.patch.object(pv, 'lane_greys', return_value={}), mock.patch.object(pv, 'health_greys', return_value={}), \
             mock.patch.object(pv, 'quota_line', return_value=''), mock.patch.object(pv.time, 'sleep'), \
             mock.patch.object(pv, 'gh', side_effect=lambda *args, **kw: sent.append(args) if '/statuses/' in ' '.join(args) else speed_gh(*args, **kw)):
            self.assertEqual(pv.main(), 0)
        self.assertEqual(read_number.call_count, 1, 'one artifact read per write')
        post = next(args for args in sent if '/statuses/' in args[1])
        return next(a.removeprefix('description=') for a in post if a.startswith('description=')), post, speed_gh.calls

    def test_pending_and_settling_writers_make_zero_speed_calls(self):
        for kind in ('pending', 'settling'):
            with self.subTest(kind=kind):
                line, post, calls = self.write_case(kind, timed=True)
                self.assertEqual(calls, [])
                self.assertNotIn('main median', line)
                self.assertIn('state=pending', post)

    def test_backstop_grey_and_red_writers_obey_the_speed_cap(self):
        for kind in ('backstop', 'grey', 'red'):
            with self.subTest(kind=kind):
                line, post, calls = self.write_case(kind, timed=True)
                self.assertIn('main median from 4 runs', line)
                self.assertIn('state=failure' if kind == 'red' else 'state=success', post)
                self.assertEqual(sum(a[:2] == ('run', 'list') for a in calls), 1)
                self.assertEqual(sum(a[-1].endswith('/zip') for a in calls), 5)
                self.assertLessEqual(sum('/runs/' in ' '.join(a) for a in calls), 8)

    def test_red_while_another_job_runs_is_not_a_final_speed_write(self):
        line, post, calls = self.write_case('early-red', timed=True)
        self.assertEqual(calls, [])
        self.assertNotIn('main median', line)
        self.assertIn('state=failure', post)

    def test_the_backstop_keeps_the_number(self):
        from tests.test_pr_ai_number import SAME
        self.assertEqual(self.write_case('backstop')[0], SAME)

    def test_a_settling_run_is_written_pending_with_the_number(self):
        line, post, _ = self.write_case('settling')
        self.assertTrue(line.startswith('e2e qualityai,settings ending · AI:'), line)
        self.assertIn('same as main', line)
        self.assertIn('state=pending', post)

    def test_main_red_grey_keeps_the_number(self):
        line, post, _ = self.write_case('grey')
        self.assertTrue(line.startswith('grey: settings'), line)
        self.assertIn('AI: facts 63/63 (main 63/63)', line)
        self.assertIn('same as main', line)
        self.assertIn('state=success', post)

    def test_retry_guard_reads_the_checkout_without_an_api_mode(self):
        workflow = (WORKFLOWS / 'e2e.yml').read_text()
        self.assertIn('steps.suite_run.outputs.report_only != \'1\'', workflow)
        self.assertIn('node -e', workflow)
        self.assertNotIn('--report-only', workflow)

    def test_verdict_glue_stays_below_the_house_split_limit(self):
        source = (ROOT / 'tools/pr-verdict.py').read_text()
        self.assertLessEqual(len(source.splitlines()), 460)
        self.assertNotIn('--report-only', source)


if __name__ == '__main__':
    unittest.main()
