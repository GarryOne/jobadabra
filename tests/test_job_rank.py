"""The free ranking a timed search scores from (src/job_rank.py) and the places-then-closeness order every timed step uses (time_budget.best_first)."""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import job_rank, time_budget  # noqa: E402
from src.sources import feeds  # noqa: E402

SEARCH = {'role_keywords': ['software engineer', 'full[- ]?stack'], 'level': ['senior'],
          'quality_stack_keywords': [r'\bjava\b', 'react', 'node\\.?js', 'postgres(ql)?', 'kafka'],
          'locations': {'top_tier': ['cluj'], 'country_wide': ['romania']}}


def job(title, description='', location='Bucharest, Romania'):
    return {'title': title, 'description': description, 'location': location}


class RankTest(unittest.TestCase):
    def test_role_level_and_skills_from_the_users_own_search(self):
        close = job_rank.ranker(SEARCH)
        self.assertEqual(close(job('Senior Software Engineer', 'Java, React, Node.js, PostgreSQL and Kafka')), 2 + 1 + 4 / 2)
        self.assertEqual(close(job('Full-stack developer', 'React')), 2 + 0.5)
        self.assertEqual(close(job('Platform Developer', 'We use Java')), 0.5)   # only the AI's title sort let it in
        self.assertEqual(close(job('Shop assistant')), 0)

    def test_accents_and_an_empty_search(self):
        self.assertEqual(job_rank.ranker({'role_keywords': ['developpeur']})(job('Développeur')), 2)
        self.assertEqual(job_rank.ranker({})(job('Anything', 'java')), 0)

    def test_a_ranked_job_costs_a_bounded_amount_of_work_whatever_its_posting_length(self):
        """CI, 18 Oct 2026: 20,000 postings took 17.5 s (feeds.plain on 4,000 characters each); a first search lists ~60,000.
        Why (28 Oct 2026, beta 40567101285, Build · Mac: 21.8 s against a 14x timing limit, "22x the baseline"; the 22 Oct baseline ratio still moved with a loaded runner): the guard counts the
        function calls one ranked job makes, not seconds, so no runner's speed can change it (owner's rule B: no wall-clock assertion). Measured 28 Oct: 41 (ascii) and 52 (accented) calls a job
        for 1,500 and for 5,400 characters alike (the TEXT cap); the 18 Oct per-character strip (feeds.plain) 3,243."""
        def calls(posting, jobs=40):
            close, count = job_rank.ranker(SEARCH), [0]
            def tick(frame, event, arg):
                if event in ('call', 'c_call'):
                    count[0] += 1
            sys.setprofile(tick)
            try:
                for n in range(jobs):
                    close(job(f'Engineer {n}', posting))
            finally:
                sys.setprofile(None)
            return count[0] / jobs
        accented, plain = 'Développeur à Genève, java ' * 200, 'Lorem ipsum dolor sit amet, java ' * 200
        for posting in (accented, plain):
            self.assertLess(calls(posting), 120, f'{posting[:12]}: one ranked job makes too many calls: the per-job work is no longer bounded')
        self.assertEqual(calls(accented), calls(accented[:1500]), 'a longer posting costs more: the TEXT cap no longer bounds the work')
        with mock.patch.object(job_rank, 'plain', feeds.plain):   # positive control: the 18 Oct slow code is seen by this guard (62x here)
            self.assertGreater(calls(accented), 20 * calls(plain), 'the guard cannot tell the 18 Oct per-character strip from the one-pass one')


class BestFirstTest(unittest.TestCase):
    def setUp(self):
        patch = mock.patch('src.paths.load_search_config', return_value=SEARCH)
        patch.start()
        self.addCleanup(patch.stop)
        place = mock.patch('src.sources.feeds.place_of', return_value=None)
        place.start()
        self.addCleanup(place.stop)

    def test_best_places_first_then_the_closest_then_the_order_kept(self):
        far = job('Platform Developer', 'java', 'Cluj-Napoca, Romania')
        close_elsewhere = job('Senior Software Engineer', 'react kafka')
        first_new, second_new = job('Shop assistant'), job('Cashier')
        order = time_budget.best_first([first_new, close_elsewhere, second_new, far])
        self.assertEqual(order, [far, close_elsewhere, first_new, second_new])

    def test_every_timed_step_takes_its_order_from_best_first(self):
        """The class: whatever a short search spends AI on (score, facts, title sort, first jobs) starts from the same top."""
        root = Path(__file__).resolve().parents[1] / 'src'
        for path in ('ai/score.py', 'ai/enrich.py', 'sources/feeds.py', 'first_jobs.py'):
            self.assertIn('best_first(', (root / path).read_text(), path)


if __name__ == '__main__':
    unittest.main()
