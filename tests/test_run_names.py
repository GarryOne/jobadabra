"""The names of the scheduled runs on GitHub's Actions list (owner, 12 Oct 2026): ONE "Nightly beta" a day, the Worker's 04:00 start; every other scheduled run
(the three e2e looks a day, either started by the Worker or by GitHub's own schedule, and the nightly's backup start) is an "E2E check". Guarded with
tests/test_desktop_workflow.py (the desktop run-name) and app-core/test/watchdog.test.js (the Worker's titles are in the run-names)."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
E2E = (ROOT / '.github/workflows/e2e.yml').read_text()
SCHEDULER = (ROOT / 'app-core/src/scheduler.js').read_text()


class RunNamesTest(unittest.TestCase):
    def test_the_e2e_looks_are_named_e2e_check_whoever_starts_them(self):
        run_name = E2E.split('run-name:', 1)[1].split('\n', 1)[0]
        self.assertIn("inputs.scheduled && 'E2E check · on time (Worker cron)'", run_name)
        self.assertIn("github.event_name == 'schedule' && 'E2E check · GitHub schedule (backup)'", run_name)
        self.assertNotIn('Scheduled e2e', run_name)

    def test_the_workers_title_for_e2e_matches_its_run_name(self):
        self.assertRegex(SCHEDULER, r"'e2e\.yml': 'E2E check · on time \(Worker cron\)'")

    def test_no_run_name_but_the_nightly_says_nightly_beta(self):
        for file in sorted((ROOT / '.github/workflows').glob('*.yml')):
            lines = [line for line in file.read_text().splitlines() if line.startswith('run-name:')]
            if file.name != 'desktop.yml':
                self.assertFalse(any('Nightly beta' in line for line in lines), file.name)


if __name__ == '__main__':
    unittest.main()
