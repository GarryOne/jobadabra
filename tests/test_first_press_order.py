"""A first Find jobs press reads before its read cut and sorts what it read (27 Oct 2026, the search benchmark: 6 fresh personas found 0-2
jobs where the 20 Oct round found 49-1,459; the run waited up to 45 s for its web search before the first-jobs slice, so the slice's boards
were asked at 80 s, past the read cut of 67 s; and the quality suite on Free AI: "No time left" for its 10 titles in scoring's share, 0 of
12 postings listed, so the "always 3" scores had no job)."""
import io
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from src import run_counts, time_budget
from src.sources import careers

BUDGET = 3   # the app's 180 s, scaled (time_budget.part)
_READER = careers.READER


def setUpModule():   # the guard in tests/test_found_boards_ai.py: no page read reaches a real model from this file
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


class TheSliceNeverWaitsForTheWebSearch(unittest.TestCase):
    def test_a_first_press_reads_its_slice_then_the_known_and_web_searchs_boards(self):
        source = (Path(__file__).resolve().parents[1] / 'src' / 'daily_search.py').read_text()
        body = source[source.index('def search('):]
        self.assertIn('if full_read and not slice_first:', body, 'the wait for the web search (boards_first.run) is not in front of a slice')
        self.assertLess(body.index('first_jobs.run('), body.rindex('boards_first.run('), 'the boards are still read on a first press, after its slice')
        self.assertLess(body.rindex('boards_first.run('), body.index('boards_ahead.scan_beside('), 'still before the employer read')


class TheTitlesThatFeedScoringAreSorted(unittest.TestCase):
    def setUp(self):
        run_counts.reset()
        self.addCleanup(run_counts.reset)
        self.addCleanup(time_budget.start, 0)
        time_budget.start(BUDGET, now=time.monotonic() - BUDGET * 130 / time_budget.PLANNED)   # 130 s of the app's 180: scoring's share
        self.assertTrue(time_budget._scorings() and not time_budget.ended())

    def test_one_batch_a_call_while_no_matched_job_waits_for_a_score(self):
        self.assertEqual(time_budget.local_titles(10), 10)
        self.assertEqual(time_budget.local_titles(100), time_budget.FEED, 'one batch, not the whole floor')

    def test_none_while_a_matched_job_waits_for_its_score_then_one_batch_again(self):
        with redirect_stdout(io.StringIO()):
            run_counts.matched([{'url': 'https://x.test/1'}])
            self.assertEqual(time_budget.local_titles(10), 0, 'scoring keeps its share for the job that waits (b8cfac4)')
            run_counts.scored({'url': 'https://x.test/1'}, 40)
        self.assertEqual(time_budget.local_titles(10), 10, 'scored: the share is idle, the next titles feed it')

    def test_none_at_the_runs_end(self):
        time_budget.start(BUDGET, now=time.monotonic() - BUDGET)
        self.assertEqual(time_budget.local_titles(10), 0)


if __name__ == '__main__':
    unittest.main()
