"""tools/pre-push-check.sh for a pull-request push (12 Oct 2026): `SHIP_PR=1` (tools/ship.sh) and CI's `CI_GATES=1` run only the fast pure checks: no suite, no gate, no clean checkout. Fixture: pre_push_fixture.py."""
import time
import unittest

from tests.pre_push_fixture import PrePushFixture


class PrePushPrTest(PrePushFixture):
    def test_a_pr_push_runs_no_suite_and_takes_seconds(self):
        self.needed_committed()
        started = time.time()
        self.assertEqual(self.hook('PUSH_FULL=1 SHIP_PR=1 git push origin topic'), (0, ''))
        self.assertFalse(self.log.exists(), 'no suite started')
        self.assertLess(time.time() - started, 10)

    def test_a_pr_push_still_stops_a_long_subject(self):
        self.needed_committed()
        self.commit('y' * 80)
        code, err = self.hook('SHIP_PR=1 git push origin topic')
        self.assertEqual(code, 2)
        self.assertIn('over 72 characters', err)

    def test_a_pr_push_reports_both_a_long_subject_and_a_fix_without_a_test(self):
        self.needed_committed()
        self.commit('y' * 80 + '\n\nFixes #12')
        code, err = self.hook('SHIP_PR=1 git push origin topic')
        self.assertEqual(code, 2, err)
        self.assertIn('1) commit subject over 72 characters', err)
        self.assertIn('2) a commit fixes an issue but changes no test', err)
        self.assertIn('Push blocked by 2 check(s)', err)
        self.assertFalse(self.log.exists(), 'refused before any suite starts')

    def test_ci_gates_runs_the_same_checks(self):
        self.needed_committed()
        self.commit('y' * 80)
        self.assertEqual(self.hook('CI_GATES=1 git push origin topic')[0], 2)

    def test_architecture_output_appears_once_for_failures_and_advisories(self):
        self.needed_committed()
        for status, message in ((1, 'JS architecture: boundary refusal'), (0, 'JS architecture: advisory')):
            with self.subTest(status=status):
                self.commit('Set architecture verdict', {'tools/arch-check.py': f"import sys\nprint({message!r})\nsys.exit({status})\n"})
                code, err = self.hook('SHIP_PR=1 git push origin topic')
                self.assertEqual(code, 2 if status else 0, err)
                self.assertEqual(err.count(message), 1, err)
                if status:
                    self.assertIn(f'1) {message}', err)
                else:
                    self.assertNotIn('Push blocked', err)

    def test_the_same_push_without_the_marker_still_runs_the_suites(self):
        self.needed_committed()
        self.assertEqual(self.hook('git push origin HEAD:main')[0], 0)
        self.assertTrue(self.log.exists())


if __name__ == '__main__':
    unittest.main()
