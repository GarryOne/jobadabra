"""A search's AI steps stop at the time budget (owner, 7 Oct 2026: "never more than 2-3 minutes"); what is left waits for the next search,
your best places first, and the log says so."""
import contextlib
import io
import pathlib
import tempfile
import unittest
from unittest import mock

from src import time_budget as budget
from src.ai import title_triage
from tests.test_title_triage import SEARCH, Client


class BudgetTests(unittest.TestCase):
    def tearDown(self):
        budget.start(0)

    def test_each_step_keeps_time_for_the_ones_after_it(self):
        budget.start(180, now=0)
        self.assertFalse(budget.over('titles', now=99))
        self.assertTrue(budget.over('titles', now=100), 'titles stop 80 s early: reading and scoring still get time')
        self.assertFalse(budget.over('enrich', now=129))
        self.assertTrue(budget.over('enrich', now=130))
        self.assertFalse(budget.over('score', now=169))
        self.assertTrue(budget.over('score', now=170), 'no call starts in the last 10 s: one running ends by 180 s')

    def test_a_refresh_that_scores_first_leaves_the_facts_their_time(self):
        # 10 Oct 2026: scoring took all 180 s, the facts started with "Time is up", and 0 of 103 jobs ever had them.
        budget.start(180, now=0)
        budget.score_first()
        self.assertFalse(budget.over('score', now=144))
        self.assertTrue(budget.over('score', now=145), 'scoring stops 35 s early (25 s of facts, the last 10 kept)')
        self.assertFalse(budget.over('enrich', now=169), 'the facts run to the end of the budget')
        self.assertTrue(budget.over('enrich', now=170))
        self.assertEqual(budget.batch('score', 1000, now=0), int((180 - 35) * 1.0 / budget.PACE['score']), 'the batch is sized without their 35 s')
        budget.start(180, now=0)
        self.assertTrue(budget.over('enrich', now=145), 'a fresh budget is back to reading first')

    def test_the_crawl_and_the_ai_steps_share_one_deadline(self):
        # 17 Oct 2026: a 10-minute crawl left the AI no time, and restart() gave the AI steps 180 s after it; 26 Oct 2026 (owner: "A find
        # jobs session should take at most 3min") the runs took 12-23 min. Now every read stops at half the budget, the AI steps get the rest.
        from src.sources import read_budget
        budget.start(180, now=0)
        self.assertEqual(read_budget.cut_at(), 90, 'the reads end at half the budget')
        self.assertFalse(budget.over('score', now=90), 'scoring has the time after the reads')
        self.assertGreater(budget.batch('score', 2868, now=90, say=False), 20)
        self.assertEqual(budget.batch('score', 2868, now=600, say=False), 0, 'nothing past the run\'s 3 minutes, not even the floor')

    def test_a_run_that_scored_none_with_a_backlog_says_so(self):
        from src.daily_helpers import none_scored
        self.assertEqual(none_scored(2868, {'done': 0}), ['2868 job(s) waiting, none scored this run'])
        self.assertEqual(none_scored(2868, {}), ['2868 job(s) waiting, none scored this run'])
        self.assertEqual(none_scored(2868, {'done': 40}), [])
        self.assertEqual(none_scored(0, {'done': 0}), [])
        self.assertEqual(none_scored(None, {}), [])

    def test_new_jobs_are_named_in_the_log_for_the_result_card(self):
        from src.daily_helpers import NEW_LISTED, new_job_lines
        jobs = [{'title': f'SRE {i}', 'company': 'Acme', 'url': f'https://x.test/{i}'} for i in range(14)]
        lines = new_job_lines(jobs, ['new', 'seen', 'changed'] + ['new'] * 11)
        self.assertEqual(lines[0], 'New job: SRE 0 | Acme | https://x.test/0')
        self.assertEqual(lines[1], 'New job: SRE 3 | Acme | https://x.test/3', 'only new jobs, not seen or changed')
        self.assertEqual(len(lines), NEW_LISTED)
        self.assertEqual(new_job_lines(jobs, ['seen'] * 14), [])

    def test_no_budget_never_stops(self):
        budget.start(0)
        self.assertFalse(budget.over('score', now=10 ** 9))

    def test_best_places_first_the_order_kept_otherwise(self):
        jobs = [{'id': 1, 'location': 'Sion'}, {'id': 2, 'location': 'Lausanne'}, {'id': 3, 'location': 'Zürich'}, {'id': 4, 'location': 'Genève'}]
        with mock.patch('src.paths.load_search_config', return_value={'locations': {'top_tier': ['gen[eè]v', 'lausanne']}}):
            self.assertEqual([j['id'] for j in budget.best_first(jobs)], [2, 4, 1, 3])


class TitlesStopTests(unittest.TestCase):
    def setUp(self):
        self.store = mock.patch.object(title_triage, 'STORE', pathlib.Path(tempfile.mkdtemp()) / 't.json')
        self.store.start()

    def tearDown(self):
        self.store.stop()
        budget.start(0)

    def test_time_up_asks_nothing_and_says_what_waits(self):
        budget.start(1, now=0)   # long spent
        client, out = Client(['magasin']), io.StringIO()
        with contextlib.redirect_stdout(out):
            got = title_triage.decide(['Collaborateur Magasin', 'Head of Growth'], SEARCH, client)
        self.assertEqual(client.calls, [])
        self.assertEqual(got, {}, 'undecided titles are asked about next search')
        self.assertIn('2 title(s) wait for the next one', out.getvalue())


if __name__ == '__main__':
    unittest.main()


class NoShadowTests(unittest.TestCase):
    def test_the_search_still_sees_the_ai_spending_budget(self):
        # 7 Oct 2026: a local "from . import budget" (this module, then named budget.py) hid src.ai.budget in daily.main, and every search
        # logged "budget check skipped": the monthly AI spend was not checked. Nothing in daily.py may bind the name again.
        import ast
        import pathlib
        # daily.py was split (8 Oct 2026): main() into daily.py, daily_modes.py (one function per mode) and daily_search.py; all of them are checked.
        for name in ('daily.py', 'daily_modes.py', 'daily_search.py', 'daily_helpers.py'):
            tree = ast.parse(pathlib.Path('src', name).read_text())
            local = [node.lineno for fn in ast.walk(tree) if isinstance(fn, ast.FunctionDef) for node in ast.walk(fn)
                     if isinstance(node, (ast.Import, ast.ImportFrom)) and any((alias.asname or alias.name) == 'budget' for alias in node.names)]
            self.assertEqual(local, [], name)
            # The same for every module daily.py imports at the top (7 Oct 2026: a local "added" hid src.ai.added): no assignment rebinds one.
            top = {(alias.asname or alias.name).split('.')[0] for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom)) for alias in node.names}
            main = [fn for fn in tree.body if isinstance(fn, ast.FunctionDef) and (fn.name in ('main', 'search') or fn.name.endswith('_mode'))]
            rebound = sorted({target.id for fn in main for node in ast.walk(fn) if isinstance(node, ast.Assign) for target in node.targets
                              if isinstance(target, ast.Name) and target.id in top})
            self.assertEqual(rebound, [], f'these names are modules {name} imports: {rebound}')


class SizedBatchTests(unittest.TestCase):
    """Owner, 7 Oct 2026: "not a hard cut, a batch that is reasonably small": each step takes what it can finish, from its own pace."""
    def tearDown(self):
        budget.start(0)

    def test_no_budget_takes_everything_and_measures_nothing(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.paths.DATA', pathlib.Path(tmp)):
            budget.start(0)
            self.assertEqual(budget.batch('score', 60), 60)
            budget.record('score', 30, 10)
            self.assertFalse((pathlib.Path(tmp) / 'step_pace.json').exists(), 'a test or a one-off command never sets the pace')

    def test_each_step_takes_its_share_at_its_own_measured_pace(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.paths.DATA', pathlib.Path(tmp)), contextlib.redirect_stdout(io.StringIO()) as out:
            budget.start(180, now=0)
            self.assertEqual(budget.batch('score', 60, now=120), 16, '50 s left (the last 10 kept) at 3 s a job')
            budget.record('score', 60, 30)   # this Mac scores at 2 s a job: the pace moves halfway there
            self.assertEqual(budget.batch('score', 60, now=120), 20, '50 s left at 2.5 s a job')
            self.assertEqual(budget.in_calls('title_rounds', 300, 30, 2, now=60), 120, '20% of 120 s at 10 s a round: 2 rounds of 2 calls of 30')
            self.assertEqual(budget.batch('enrich', 5, now=0), 5, 'a small batch is taken whole, nothing said')
        self.assertIn('This refresh scores 16 of 60 jobs', out.getvalue())
        self.assertIn('44 wait for the next refresh, best places and closest jobs first', out.getvalue())


class PlaceCallsTests(unittest.TestCase):
    """Placing locations is paced per round of calls, not per location: Haiku answers 60 a call, two calls at once (7 Oct 2026: a refresh
    placed 32 of 1,500 locations, at 0.5 s a location at least)."""
    def tearDown(self):
        budget.start(0)

    def test_a_refresh_places_whole_rounds_of_calls(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.paths.DATA', pathlib.Path(tmp)), contextlib.redirect_stdout(io.StringIO()) as out:
            budget.start(180, now=0)
            self.assertEqual(budget.in_calls('place_rounds', 1500, 60, 2, now=0), 240, '15% of 180 s at 10 s a round: 2 rounds of 2 calls of 60')
            budget.record('place_rounds', 6, 1)   # this Mac: a round in 6 s, the pace moves halfway there
            self.assertEqual(budget.in_calls('place_rounds', 1500, 60, 2, now=0), 360, '27 s at 8 s a round: 3 rounds')
            self.assertEqual(budget.in_calls('place_rounds', 50, 60, 2, now=0), 50, 'fewer than a round: all of them, nothing said')
        self.assertIn('This refresh places 240 of 1500 job locations', out.getvalue())
        budget.start(0)
        self.assertEqual(budget.in_calls('place_rounds', 1500, 60, 2), 1500, 'no budget: all of them')
