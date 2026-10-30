# Verify AI number composition in every PR verdict writer.
import os
import sys
import unittest

from tests.test_pr_verdict import ROOT, WORKFLOWS, pv, run


class TheAiNumberInEveryWriter(unittest.TestCase):
    def write_case(self, kind):
        """Exercise the real main loop and status POST with only GitHub and time replaced."""
        from unittest import mock
        from tools import pr_ai_number as ai, pr_speed_number as speed
        from tests.test_pr_ai_number import RATES
        r = run('E2E', event='workflow_dispatch', title='E2E for PR · qualityai,settings · topic', id=7)
        jobs = {7: [{'id': 71, 'name': 'qualityai', 'status': 'completed', 'conclusion': 'success'},
                    {'id': 72, 'name': 'settings', 'status': 'completed', 'conclusion': 'success'}]}
        if kind == 'settling':
            r.update(status='in_progress')
            jobs[7] = [jobs[7][1]]   # measured artifact read independently; another job is still being created
        elif kind == 'grey':
            jobs[7][1]['conclusion'] = 'failure'
        elif kind == 'final':
            r.update(status='in_progress')
            jobs[7][1].update(status='in_progress', runner_name='ours', steps=[{'name': pv.STEP, 'status': 'in_progress'}])
        sent = []
        with mock.patch.dict(os.environ, {'GITHUB_RUN_ID': '7' if kind == 'final' else '99', 'RUNNER_NAME': 'ours'}), \
             mock.patch.object(sys, 'argv', ['pr-verdict.py', '--repo', 'o/r', '--sha', 'head', *(['--job-status', 'success'] if kind == 'final' else [])]), \
             mock.patch.object(sys, 'stdout'), mock.patch.object(pv, 'read', return_value=([r], jobs)), \
             mock.patch.object(pv, 'pr_meta', return_value=([{'number': 1, 'state': 'open'}], [], [])), \
             mock.patch.object(pv, 'main_state_module', side_effect=lambda repo, ref, name='main_e2e_state': ai if name == 'pr_ai_number' else speed if name == 'pr_speed_number' else mock.Mock()), \
             mock.patch.object(ai, 'report_suites', return_value={'qualityai'}), mock.patch.object(ai, 'numbers', return_value=(RATES, RATES)) as read_number, \
             mock.patch.object(pv, 'main_red_greys', return_value={72}), \
             mock.patch.object(pv, 'lane_greys', return_value={}), mock.patch.object(pv, 'health_greys', return_value={}), \
             mock.patch.object(pv, 'quota_line', return_value=''), mock.patch.object(pv.time, 'sleep'), \
             mock.patch.object(pv, 'gh', side_effect=lambda *args: sent.append(args)):
            self.assertEqual(pv.main(), 0)
        self.assertEqual(read_number.call_count, 1, 'artifact reads stay outside the settling loop')
        post = next(args for args in sent if '/statuses/' in args[1])
        return next(a.removeprefix('description=') for a in post if a.startswith('description=')), post

    def test_the_final_inline_writer_keeps_the_number(self):
        from tests.test_pr_ai_number import SAME
        self.assertEqual(self.write_case('final')[0], SAME)

    def test_the_backstop_keeps_the_number(self):
        from tests.test_pr_ai_number import SAME
        self.assertEqual(self.write_case('backstop')[0], SAME)

    def test_the_settling_timeout_keeps_the_number(self):
        line, post = self.write_case('settling')
        self.assertTrue(line.startswith('still ending: e2e qualityai,settings ending · AI:'), line)
        self.assertIn('same as main', line)
        self.assertIn('state=pending', post)

    def test_main_red_grey_keeps_the_number(self):
        line, post = self.write_case('grey')
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
