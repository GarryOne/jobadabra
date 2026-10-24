"""Quality of what the AI writes for the owner: the rules in the prompts, and the checker that flags answers that break them.
Offline and free. The "bad" examples are real output (2 Oct 2026, e2e-activity): a weekly report built on almost no data
claimed "Search paused: no eligible positions in market, resume building needed" with a consultant-style next step."""
import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import insights, quality

BAD_HEADLINE = 'Search paused: no eligible positions in market, resume building needed.'
BAD_ACTION = ('Unblock market access: clarify all hard constraints (work permit, regions, employment terms, salary) '
              'with Jobadabra or a recruiter to determine whether zero eligible jobs reflects a real market gap.')


class Checker(unittest.TestCase):
    def test_the_real_bad_answer_is_flagged_on_every_count(self):
        found = ' | '.join(quality.problems(BAD_HEADLINE, BAD_ACTION))
        for part in ('situation the statistics do not contain', 'no number', 'not start with a verb', 'vague advice', 'characters (max 100)'):
            self.assertIn(part, found)

    def test_a_good_answer_passes(self):
        self.assertEqual(quality.problems('Kubernetes is in 41 of 120 jobs and missing from your CV', 'Add Kubernetes to your CV in Profile', 120), [])

    def test_a_thin_sample_must_say_so_and_collect_data(self):
        self.assertEqual(quality.problems('Not enough data yet: 3 jobs, 0 applications', 'Run a job search from Jobs', 3), [])
        for phrase in ('Salary was answered weakly in 2 of 4 screens; the sample is small.', 'Only 4 jobs: the sample was small'):
            self.assertEqual(quality.problems(phrase, 'Set a firm salary in Profile', 4), [], phrase)
        self.assertIn('small', ' '.join(quality.problems('Remote roles pay 12% more', 'Widen your regions in Strategy', 3)))

    def test_limits(self):
        self.assertTrue(quality.problems('x 1 ' * 40, 'Add a skill'))
        self.assertEqual(quality.problems('', 'Add a skill'), ['no headline'])


class Prompts(unittest.TestCase):
    def test_both_prompts_carry_the_honesty_rules(self):
        for prompt in (insights.SYSTEM, insights.WEEKLY_SYSTEM):
            self.assertIn('Say only what the statistics show', prompt)
            self.assertIn('not enough', prompt.lower())

    def test_schemas_ask_for_a_short_next_step_that_starts_with_a_verb(self):
        self.assertIn('100', insights.SCHEMA['properties']['action']['description'])
        self.assertIn('verb', insights.WEEKLY_SCHEMA['properties']['focus']['description'])


class Logged(unittest.TestCase):
    def test_a_weak_answer_prints_a_warning_and_a_good_one_prints_nothing(self):
        out = io.StringIO()
        with redirect_stdout(out):
            insights._log_quality('weekly report', BAD_HEADLINE, BAD_ACTION)
            insights._log_quality('insight', 'Kubernetes is in 41 of 120 jobs', 'Add Kubernetes to your CV', 120)
        self.assertEqual(len(out.getvalue().splitlines()), 1)
        self.assertTrue(out.getvalue().startswith('Warning: weekly report quality:'))


if __name__ == '__main__':
    unittest.main()
