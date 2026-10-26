"""A timed search that scores plans for scoring's real stop from its first second (26 Oct 2026, a proof on a copy of the owner's data:
score_first was switched on only when scoring began, so the title floor ran to 120 s and scoring had 3 s left: 3 jobs scored)."""
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import daily_helpers, time_budget

SEARCH = Path(__file__).resolve().parents[1] / 'src' / 'daily_search.py'


class ScoreFirstFromTheStart(unittest.TestCase):
    def setUp(self):
        self.addCleanup(time_budget.start, 0)

    def plan(self, score_max=60, profile=lambda: 'SRE in Zurich', budget=180):
        time_budget.start(budget)
        with mock.patch.object(daily_helpers, 'profile_source', return_value=profile):
            return daily_helpers.scoring_plan(SimpleNamespace(score_max=score_max), stores=None)

    def test_a_timed_search_with_a_profile_scores_first_from_the_start(self):
        self.assertIsNotNone(self.plan())
        self.assertTrue(time_budget.SCORE_FIRST)
        time_budget.start(180, now=time.monotonic() - 100)
        time_budget.score_first()
        self.assertEqual(time_budget.local_titles(10), 0, "past 95 s the title floor leaves scoring its share (stop 140 s, SCORING 45 s)")

    def test_nothing_to_score_plans_no_score_first(self):
        for kwargs in ({'score_max': 0}, {'profile': None}, {'budget': 0}):
            with self.subTest(kwargs):
                self.plan(**kwargs)
                self.assertFalse(time_budget.SCORE_FIRST)

    def test_the_search_plans_before_it_reads_any_site(self):
        text = SEARCH.read_text()
        self.assertLess(text.index('scoring_plan(args, stores)'), text.index('boards_first.run('))
        self.assertNotIn('time_budget.score_first()', text, 'decided once, at the start (daily_helpers.scoring_plan)')


if __name__ == '__main__':
    unittest.main()
