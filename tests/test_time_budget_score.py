"""Scoring keeps its part of a timed search, whatever the steps before it wanted (src/time_budget.py RESERVE). 18 Oct 2026, #1440: placing and
sorting took ~165 of the 180 s and Cluj's first search scored 6 jobs instead of 57; then score_own gave scoring its own minutes past the
deadline, and runs took 12-23 min (owner, 26 Oct 2026: "A find jobs session should take at most 3min"). Now titles stop 85 s before the
one deadline and the reads at half of it, so scoring's part is kept inside the 3 minutes."""
import unittest

from src import time_budget


class ScoringKeepsItsPartTest(unittest.TestCase):
    def tearDown(self):
        time_budget.start(0)

    def test_titles_stop_early_enough_for_scoring_to_take_a_real_batch(self):
        time_budget.start(180, now=0)
        stop = next(second for second in range(181) if time_budget.over('titles', now=second))
        self.assertEqual(stop, 95)
        self.assertGreaterEqual(time_budget.batch('score', 1000, now=stop, say=False), 20, 'scoring still has ~70 s at the titles\' stop')

    def test_no_budget_stays_no_budget(self):
        time_budget.start(0)
        self.assertIsNone(time_budget.DEADLINE)
        self.assertFalse(time_budget.over('score'))
        self.assertFalse(time_budget.ended())


if __name__ == '__main__':
    unittest.main()
