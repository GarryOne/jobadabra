"""The weekly e2e root-cause issue (gate G6): causes from logs, mass events folded, the gate that catches each red, the breaking PR from `red-main` issues."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools import e2e_weekly as w  # noqa: E402

# Beta 3, 26 Oct 2026 01:10: the e2e key ran out of credit; every suite stopped before its first step.
CREDIT = ('✗ the wander suite stopped: E2E_ANTHROPIC_KEY: the API refused model claude-haiku-5-5 (400) before any suite ran: '
          '"Your credit balance is too low to access the Anthropic API"')
# Beta 2: cardstates' own checks, five different failures.
CHECK = '✗ a partial Tailor run: its counts, its row actions and its warning status agree: the heading is not "3 of 5 CVs ready"'
ONE = ("✗ every finished state: locator.click: Timeout 30000ms exceeded.\n6 passed, 6 failed\n⚠ one cause, 6 steps: click on locator('#activity-recent li button'): "
       'not visible (gave up after 30 s). Fix it first: these steps stopped there')
INTERMITTENT = '✗ Notion is busy (429): the list says "Completed"\n🔁 intermittent: Notion is busy (429): a wrong value, not timing'


def row(suite, cause, kind='beta', run=1, os_name='Mac/Linux', **extra):
    return {'kind': kind, 'run': run, 'url': f'https://r/{run}', 'at': '2026-10-25T23:20:00Z', 'suite': suite, 'os': os_name, 'cause': cause, 'detail': '', **extra}


class Causes(unittest.TestCase):
    def test_each_log_gets_its_cause_and_first_red_step(self):
        self.assertEqual(w.classify(CREDIT)[0], 'ai-key')
        self.assertEqual(w.classify(CHECK), ('check-failed', 'a partial Tailor run: its counts, its row actions and its warning status agree: the heading is not "3 of 5 CVs ready"'))
        self.assertEqual(w.classify(ONE), ('one-cause', "⚠ one cause, 6 steps: click on locator('#activity-recent li button'): not visible (gave up after 30 s)"))
        self.assertEqual(w.classify(INTERMITTENT)[0], 'intermittent')
        for free_ai in ('✗ the Free AI relay refused its first question (429): "busy"', '✗ x: the Free AI relay at http://127.0.0.1:8787/api/ai is not answering (ECONNREFUSED)',
                        '✗ x: CI_FREE_AI_CF_TOKEN is not an active Cloudflare token (401, no status)'):   # #1997 moved CI's suites to Free AI
            self.assertEqual(w.classify(free_ai)[0], 'ai-key', free_ai)
        self.assertEqual(w.classify('✗ x: locator.click: Timeout 30000ms exceeded.')[0], 'timeout')
        self.assertEqual(w.classify("✗ x: Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON")[0], 'environment')

    def test_the_env_dump_and_later_steps_never_decide_the_cause(self):
        # Real stores log (beta 23 Oct): every step prints its env, so "E2E_ANTHROPIC_KEY: ***" sits above the red step; it read as ai-key.
        log = ('E2E · Windows · stores\tUNKNOWN STEP\t2026-10-23T23:55:03Z   E2E_ANTHROPIC_KEY: ***\n'
               "E2E · Windows · stores\tUNKNOWN STEP\t2026-10-23T23:57:04Z ✗ the board shows the store's applications in their stage columns: a card is in the wrong column\n"
               'E2E · Windows · stores\tUNKNOWN STEP\t2026-10-23T23:57:09Z ✗ a later step: the judge call failed (400): Your credit balance is too low\n')
        self.assertEqual(w.classify(log), ('check-failed', "the board shows the store's applications in their stage columns: a card is in the wrong column"))
        self.assertEqual(w.classify('✗ the employers suite stopped: E2E_ANTHROPIC_KEY: the API refused model claude-haiku-5-5 (400): "You have reached your specified workspace API usage limits"')[0], 'ai-key')

    def test_job_names_give_suite_and_os(self):
        self.assertEqual(w.suite_and_os('E2E · Windows · applyflows-2of2', 'beta'), ('applyflows', 'Windows'))
        self.assertEqual(w.suite_and_os('E2E · Mac + Linux · cardstates', 'beta'), ('cardstates', 'Mac/Linux'))
        self.assertEqual(w.suite_and_os('foryou (Windows)', 'windows'), ('foryou', 'Windows'))
        self.assertEqual(w.suite_and_os('recorded-2of5', 'main'), ('recorded', 'Mac/Linux'))
        for name in ('Release · Mac beta', 'HTML report', 'Telegram alert', 'Code → suite map', 'plan'):
            self.assertFalse(w.is_suite_job(name), name)


class Events(unittest.TestCase):
    def test_one_credit_outage_is_one_row_not_forty(self):
        reds = [row(f's{i}', 'ai-key') for i in range(40)] + [row('cardstates', 'check-failed', run=2)]
        rows = w.events(reds)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['suite'], '40 suites')
        self.assertEqual(w.caught_by(rows[0]), 'the test environment: no gate (fix the key or the service)')

    def test_a_few_product_reds_stay_rows(self):
        self.assertEqual(len(w.events([row(f's{i}', 'check-failed') for i in range(6)])), 6)


class CaughtBy(unittest.TestCase):
    def test_the_gate_that_catches_each_red(self):
        self.assertRegex(w.caught_by(row('interactions', 'check-failed', pr=1911, pr_ran=False)), r'^G1: PR #1911 did not run `interactions`')
        self.assertRegex(w.caught_by(row('cardstates', 'check-failed', main_before='failure')), r'^G2a: main was red')
        self.assertRegex(w.caught_by(row('failuresnotion', 'intermittent', main_before='success')), r'^G5:')
        self.assertRegex(w.caught_by(row('foryou', 'timeout', os_name='Windows', main_before=None)), r'^G4: Windows never ran it')
        self.assertRegex(w.caught_by(row('settings', 'check-failed', main_before='success')), r'^nothing yet')
        self.assertRegex(w.caught_by(row('settings', 'check-failed', kind='main')), r'^G2a: red main, owned')

    def test_the_breaking_pr_comes_from_the_bisect_issue(self):
        issues = [{'title': 'Red main: interactions', 'body': "Main's `interactions` e2e suite is red\n\nBreaking PR: #1911 (branch `rail-short-window`)"},
                  {'title': 'Red main: settings', 'body': 'Breaking PR: not found. Commits still in range: abc'}]
        self.assertEqual(w.breaking_prs(issues), {'interactions': {'pr': 1911, 'branch': 'rail-short-window'}})

    def test_main_before_reads_the_newest_check_before_the_beta(self):
        runs = [{'id': 3, 'created_at': '2026-10-26T00:00:00Z'}, {'id': 2, 'created_at': '2026-10-25T21:47:00Z'}, {'id': 1, 'created_at': '2026-10-25T13:47:00Z'}]
        jobs = {3: [{'name': 'cardstates', 'conclusion': 'success'}], 2: [{'name': 'cardstates', 'conclusion': 'failure'}], 1: [{'name': 'cardstates', 'conclusion': 'success'}]}
        self.assertEqual(w.main_before(runs, 'cardstates', '2026-10-25T23:20:00Z', jobs.get), 'failure')
        self.assertIsNone(w.main_before(runs, 'foryou', '2026-10-25T23:20:00Z', jobs.get))
        self.assertIsNone(w.main_before(runs, 'cardstates', '2026-10-25T23:20:00Z', jobs.get, 'Windows'), 'a Linux job says nothing about Windows')
        jobs[2].append({'name': 'cardstates (Windows)', 'conclusion': 'success'})
        self.assertEqual(w.main_before(runs, 'cardstates', '2026-10-25T23:20:00Z', jobs.get, 'Windows'), 'success')


class Render(unittest.TestCase):
    def test_gaps_first_and_counted(self):
        rows = [row('cardstates', 'check-failed', main_before='failure'), row('settings', 'check-failed', main_before='success')]
        body = w.render(rows, '2026-W44', 7, {'runs': 12, 'red': 2})
        self.assertIn('**Not caught by any gate yet: 1.**', body)
        self.assertLess(body.index('`settings`'), body.index('`cardstates`'), 'what no gate catches comes first')

    def test_a_run_github_would_not_list_is_named_not_a_crash(self):
        # 26 Oct 2026, second dry run: three 502s in a row on one run's jobs killed the whole report.
        calls = []
        def failing_gh(*args, **kw):
            calls.append(args)
            raise RuntimeError('gh api repos/x: gh: Server Error (HTTP 502)')
        saved, w.gh = w.gh, failing_gh
        try:
            self.assertEqual(w.jobs_of(40085685674), [])
        finally:
            w.gh = saved
        self.assertEqual(len(w.UNREAD), 1)
        body = w.render([], '2026-W44', 7, {'runs': 1, 'red': 0, 'unread': w.UNREAD})
        self.assertIn('GitHub did not list the jobs of 1 run(s)', body)
        self.assertIn('40085685674', body)


if __name__ == '__main__':
    unittest.main()
