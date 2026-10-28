"""The pay row (src/suggestions_pay.py; spec docs/superpowers/specs/2026-10-28-insights-with-actions-design.md, PR 3, #15): jobs that match
your role and place, are under High fit, and whose Compensation part is their lowest, named in one row with two buttons; no AI call."""
import unittest
from unittest import mock

from src import suggestions, suggestions_pay as pay


def job(n, role=90, place=90, pay_part=40, growth=80, score=64, stage=None):
    parts = {'role_fit': role, 'location': place, 'compensation': pay_part, 'growth': growth, 'risk': 20}
    return ({'id': f'j{n}', 'url': f'https://jobs.example/{n}', 'title': f'SRE {n}', 'company': f'Acme {n}'}, {'score': score, 'components': parts})


class HeldBackTests(unittest.TestCase):
    def test_only_matches_held_under_high_fit_by_their_pay_count(self):
        scored = [job(1), job(2), job(3, pay_part=None), job(4, score=82, pay_part=70), job(5, role=60), job(6, place=70),
                  job(7, pay_part=95), job(8, growth=None), job(9, pay_part=True)]
        self.assertEqual([j['id'] for j in pay.held_back(scored)], ['j1', 'j2', 'j8'],
                         'no stated pay, already High fit, not a match, pay not the lowest part, and a bool are all left out')

    def test_a_job_you_acted_on_is_left_out(self):
        scored = [job(1), job(2)]
        self.assertEqual([j['id'] for j in pay.held_back(scored, {'https://jobs.example/1': 'Dismissed'})], ['j2'])


class EntryTests(unittest.TestCase):
    def test_three_jobs_make_the_row_with_show_and_edit(self):
        found = pay.entry(pay.held_back([job(n) for n in range(1, 6)]))
        self.assertEqual(found['title'], '5 jobs match you but pay keeps them under High fit')
        self.assertEqual([a['do'] for a in found['actions']], ['show_jobs', 'edit_minimum'])
        self.assertEqual(found['actions'][0]['label'], 'Show these 5 jobs')
        self.assertEqual(len(found['actions'][0]['urls']), 5)
        self.assertEqual((found['home'], found['topic'], found['key']), ('strategy', 'search', 'pay:minimum'))
        self.assertEqual(found['evidence'][-1], 'and 2 more')

    def test_under_three_jobs_is_no_row(self):
        self.assertIsNone(pay.entry(pay.held_back([job(1), job(2)])))

    def test_not_now_hides_it_against_its_key(self):
        from datetime import datetime, timezone
        from tests.test_suggestions_search import answer
        now = datetime(2026, 10, 28, 9, 0, tzinfo=timezone.utc)
        found = pay.entry(pay.held_back([job(n) for n in range(1, 5)]))
        self.assertIn(found['kind'], suggestions.PRODUCERS)
        self.assertEqual(suggestions.answered([found], [answer('Not now', found['key'], '2026-11-11')], now), [])

    def test_no_jobs_cache_is_no_row_and_no_error(self):
        with mock.patch('src.paths.jobs_db', return_value='/nonexistent/jobs.db'):
            self.assertEqual(pay.now([]), [])


class DemoTests(unittest.TestCase):
    def test_the_demo_row_is_what_the_engine_makes_of_its_jobs(self):
        import json
        import pathlib
        demo = json.loads((pathlib.Path(__file__).resolve().parent.parent / 'desktop' / 'demo' / 'focus.json').read_text())['suggestions']
        shown, = [e for e in demo if e['kind'] == pay.KIND]
        jobs = [{'url': url, 'title': title, 'company': company} for url, title, company in (
            ('https://jobs.example.ch/0', 'Senior Platform Engineer', 'Helvetia Cloud'), ('https://jobs.example.ch/1', 'SRE Lead', 'Alpine Labs'),
            ('https://jobs.example.ch/2', 'DevOps Engineer', 'Matterhorn Bank'), ('https://jobs.example.ch/3', 'Cloud Engineer', 'Rhein Systems'),
            ('https://jobs.example.ch/4', 'Site Reliability Engineer', 'Aare Digital'))]
        self.assertEqual(shown, pay.entry(jobs))


if __name__ == '__main__':
    unittest.main()
