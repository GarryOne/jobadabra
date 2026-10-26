"""The first 3 jobs of a search are always scored (owner, 18 Oct 2026: "Yes, always 3"; spec 2026-10-18-search-learns-sources.md PR 9): the
persona rerun's driver had 33 jobs in the list and none scored in press 1, because the AI budget was spent before scoring started. The floor
moves those 3 scores from the next search to this one (no new spend: $0.02-0.045 per press on an API key, $0 on the plan)."""
import re
import tempfile
import unittest
from pathlib import Path

from src import time_budget as budget


class FloorTests(unittest.TestCase):
    def tearDown(self):
        budget.start(0)

    def test_scorings_spent_share_still_takes_and_starts_the_first_three(self):
        budget.start(180, now=0)
        budget.score_first()   # 150 s: scoring's time is spent (it keeps the facts' 25 s and the last 15), the run's is not
        self.assertEqual(budget.batch('score', 10, now=150), 3, 'the batch keeps 3 when the time is up')
        self.assertEqual(budget.batch('score', 2, now=150), 2)
        self.assertEqual([budget.may_score(now=150) for _ in range(5)], [True, True, True, False, False])

    def test_the_floor_never_passes_the_runs_end(self):
        # owner, 26 Oct 2026: "A find jobs session should take at most 3min" (tests/test_three_minutes.py)
        budget.start(180, now=0)   # the last 15 s: a call started now would end past 180 s
        self.assertEqual(budget.batch('score', 10, now=165), 0)
        self.assertFalse(budget.may_score(now=165))
        self.assertEqual(budget.batch('score', 10, now=500), 0, 'the floor is used: the rest waits for the next search')

    def test_scores_started_in_time_count_toward_the_floor(self):
        budget.start(180, now=0)
        self.assertTrue(all(budget.may_score(now=10) for _ in range(3)))
        self.assertFalse(budget.may_score(now=500))

    def test_the_floor_is_per_search(self):
        budget.start(180, now=0)
        budget.score_first()
        budget.may_score(now=150)
        self.assertEqual(budget.batch('score', 10, now=151), 2)
        budget.start(180, now=0)   # a new search
        budget.score_first()
        self.assertEqual(budget.batch('score', 10, now=151), 3)

    def test_without_a_budget_every_score_starts(self):
        budget.start(0)
        self.assertTrue(all(budget.may_score() for _ in range(10)))
        self.assertEqual(budget.batch('score', 10), 10)


class ScoreRunTests(unittest.TestCase):
    def tearDown(self):
        budget.start(0)

    def test_score_run_scores_three_when_the_time_is_up(self):
        from src import store
        from src.ai import score
        from tests.test_score import ModelClient
        from unittest import mock
        with tempfile.TemporaryDirectory() as tmp, store.connect(Path(tmp) / 'jobs.sqlite') as db, mock.patch('src.paths.DATA', Path(tmp)):   # its pace file too
            report = {'jobs': [{'company': 'Example', 'id': str(i), 'title': f'SRE {i}', 'location': 'Zurich', 'url': f'https://x.test/{i}',
                                'description': 'Kubernetes, Terraform, Datadog.', 'status': 'new'} for i in range(6)], 'sources': []}
            store.import_watch_report(db, report)
            from src.daily_helpers import to_score
            import time
            budget.start(180, now=time.monotonic() - 150)   # scoring's time is spent (it keeps the facts' time), the run's is not
            budget.score_first()
            stats = {}
            score.run(db, to_score(db, frozenset()), 'Profile v1', 'm', 50, client=ModelClient({'m': lambda title: 70}), stats=stats, workers=1)
            self.assertEqual(len(score.load(db)), 3, 'the first 3, the others wait for the next search')


class ClassTests(unittest.TestCase):
    def test_every_scoring_call_starts_through_the_floor(self):
        # A new place that starts a score must ask may_score, or the floor is skipped there.
        source = Path('src/ai/score.py').read_text()
        self.assertIn("budget.may_score()", source)
        self.assertNotRegex(source, r"over\('score'\)", 'a score starts through may_score, which keeps the floor')
        self.assertTrue(re.search(r"batch\('score'", Path('src/daily_search.py').read_text()))


if __name__ == '__main__':
    unittest.main()
