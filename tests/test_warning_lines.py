"""A warning the run logged is also recorded in run['warnings'], so the row's Status says Warnings like the panel does (beta 2, 25 Oct 2026)."""
import json
import unittest
from pathlib import Path

from src import run_log, warning_lines
from src.notion import cron_report, cron_runs

CASES = json.loads((Path(__file__).parent / 'fixtures' / 'warning_lines.json').read_text())['cases']
RUN = {'mode': 'search', 'started_at': '2026-10-25T21:00:00+00:00', 'trigger': 'Mac (you)', 'seconds': 30, 'new': 1, 'warnings': []}


class WarningLines(unittest.TestCase):
    def test_every_warning_kind_the_panel_knows_reaches_the_status(self):
        for case in CASES:
            with self.subTest(line=case['line']):
                self.assertEqual(warning_lines.is_warning(case['line']), case['warning'])
                run = warning_lines.record_logged_warnings({**RUN, 'warnings': []}, [case['line']])
                self.assertEqual(cron_report.status(run), 'Warnings' if case['warning'] else 'OK')

    def test_a_logged_429_with_no_recorded_warnings_is_warned_on_both_run_writers(self):
        lines = ['Found 1 new job', 'Notion 429 Too Many Requests, retrying']
        self.assertEqual(cron_report.status(RUN), 'OK')   # what the row said before: the panel said "with warnings"
        run = {**RUN, 'warnings': []}
        run_log._output.clear(); run_log._output.extend(lines)
        self.assertEqual(run_log.finished(run)['status'], 'Warnings')
        run = {**RUN, 'warnings': []}
        cron_runs._output.clear(); cron_runs._output.extend(lines)
        warning_lines.record_logged_warnings(run, list(cron_runs._output))
        self.assertEqual(cron_runs.status(run), 'Warnings')

    def test_a_warning_already_recorded_is_not_added_twice(self):
        run = {**RUN, 'warnings': ['Notion was busy']}
        warning_lines.record_logged_warnings(run, ['Warning: Notion was busy', 'Warning: Notion was busy'])
        self.assertEqual(run['warnings'], ['Notion was busy'])


    def test_both_run_writers_record_what_the_run_logged(self):
        import inspect
        self.assertIn('record_logged_warnings(run,', inspect.getsource(cron_runs.log_run))
        self.assertIn('record_logged_warnings(run,', inspect.getsource(run_log.finished))


if __name__ == '__main__':
    unittest.main()
