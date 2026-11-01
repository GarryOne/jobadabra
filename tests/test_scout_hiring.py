"""Who hires: employers an open-web search names as hiring for a role in a place (src/scout_hiring.py). Pilot of 19 Oct 2026: 17 new employers
with a readable job site from 15 such searches (hotels, hospitals, schools, labs) against 9 from 30 job-system board searches. No network."""
import sqlite3
import unittest
from unittest import mock

from src import scout_cells, scout_core, scout_hiring, scout_hiring_cells, scout_role_search
from src.sources import web_search

SEARCH = {'role_keywords': ['chef', 'cook'], 'locations': {'top_tier': ['Munich'], 'country_wide': ['Germany'], 'abroad': []}}
NAMED = [{'name': 'München Klinik', 'website': 'https://www.muenchen-klinik.de/'}, {'name': 'Again', 'website': 'https://www.muenchen-klinik.de/jobs'},
         {'name': '', 'website': 'https://x.de'}, {'name': 'No site', 'website': 'muenchen.de'}, {'name': 'Rosewood Munich', 'website': 'https://www.rosewoodhotels.com/en/munich'}]


def memory_db():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    scout_core.ensure_tables(db)
    return db


class HiringSearchTest(unittest.TestCase):
    def test_each_named_employer_comes_once_with_its_website(self):
        found = scout_hiring.candidates(NAMED, 'Hiring search 2026-10-19')
        self.assertEqual([(c['name'], c['website']) for c in found],
                         [('München Klinik', 'https://www.muenchen-klinik.de/'), ('Rosewood Munich', 'https://www.rosewoodhotels.com/en/munich')])
        self.assertTrue(all(c['priority'] == scout_hiring.PRIORITY and c['origin'] == 'Hiring search 2026-10-19' for c in found))

    def test_an_install_asks_one_role_and_place_a_run_and_moves_on(self):
        db, asked = memory_db(), []
        with mock.patch.object(scout_core, 'CENTRAL', False):
            for _ in range(5):
                scout_hiring.run(db, SEARCH, asker=lambda role, place: asked.append((role, place)) or NAMED)
        self.assertEqual(len(asked), 5, 'one search a run')
        self.assertEqual(set(asked), {(role, place) for role in ('chef', 'cook') for place in ('Munich', 'Germany')}, 'every pair in turn')

    def test_an_install_searches_only_on_its_plan_never_on_an_api_key(self):
        db = memory_db()
        with mock.patch.object(scout_core, 'CENTRAL', False), mock.patch.object(web_search, '_claude_code', lambda: False), \
                mock.patch.object(scout_hiring, 'ask', lambda *a: self.fail('an API-key install must not pay for this search')):
            self.assertEqual(scout_hiring.run(db, SEARCH)['queries'], 0)

    def test_the_central_scout_asks_role_families_in_cities_of_the_thinnest_cell_and_tags_its_kind(self):
        db, asked = memory_db(), []
        scout_cells.keep(db, [])
        with mock.patch.object(scout_core, 'CENTRAL', True):
            got = scout_hiring.run(db, SEARCH, asker=lambda role, place: asked.append((role, place)) or NAMED)
        kind = scout_cells.AIMED[0]
        self.assertEqual(asked, [('Sales Representative', 'Zurich, Switzerland'), ('Sales Representative', 'Lausanne, Switzerland')], 'the family in each city')
        self.assertTrue(got['candidates'][0]['origin'].startswith(f'Hiring search {kind} '))
        from src.ai import scout_ideas
        self.assertEqual(scout_ideas.origin_kind(got['candidates'][0]['origin']), f'Hiring search {kind}', 'the queue learns its yield per kind')

    def test_a_cell_with_many_pairs_asks_six_a_run_and_moves_on(self):
        db = memory_db()
        first = scout_hiring_cells.take(db, 'trades', 'de', ('w', 'Germany'))
        second = scout_hiring_cells.take(db, 'trades', 'de', ('w', 'Germany'))
        self.assertEqual((len(first), len(second)), (6, 6))
        self.assertNotEqual(first, second)
        self.assertTrue(all(place.endswith(', Germany') for _, place in first + second))

    def test_a_country_without_a_city_in_the_lab_draws_is_asked_country_wide(self):
        self.assertEqual(scout_hiring_cells.take(memory_db(), 'trades', 'lu', ('welding', 'Luxembourg')), [('welding', 'Luxembourg')])

    def test_every_kind_family_is_a_lab_family(self):
        ids = {family['id'] for family in scout_hiring_cells.draws()['families']}
        for kind, families in scout_hiring_cells.FAMILIES.items():
            self.assertIn(kind, scout_cells.AIMED)
            self.assertTrue(set(families) <= ids, f'{kind}: {set(families) - ids}')

    def test_a_portal_that_is_a_job_systems_own_board_goes_to_the_probe_and_the_rest_are_dropped(self):
        db = memory_db()
        answer = {'employers': NAMED[:1], 'portals': ['https://www.pracuj.pl/', 'https://jobs.lever.co/acme-labs']}
        with mock.patch.object(scout_core, 'CENTRAL', False):
            got = scout_hiring.run(db, SEARCH, asker=lambda role, place: answer)
        self.assertEqual([c['name'] for c in got['candidates']], ['München Klinik', 'Acme Labs'])

    def test_the_scout_gets_the_boards_and_the_employers_together_and_one_failing_leaves_the_other(self):
        db = memory_db()
        boards = {'candidates': [{'name': 'Zauber'}], 'queries': 6, 'note': '1 boards from 6 searches'}
        with mock.patch.object(scout_role_search, 'run', lambda *a: boards), \
                mock.patch.object(scout_hiring, 'run', lambda *a: {'candidates': [{'name': 'Rosewood'}], 'queries': 1, 'note': '1 employers hiring from 1 search'}), \
                mock.patch.dict('os.environ', {'JOBADABRA_FIXTURE_DIR': ''}):
            both = scout_role_search.guarded(db, SEARCH)
        self.assertEqual([c['name'] for c in both['candidates']], ['Zauber', 'Rosewood'])
        def broken(*a):
            raise RuntimeError('search down')
        with mock.patch.object(scout_role_search, 'run', lambda *a: boards), mock.patch.object(scout_hiring, 'run', broken), \
                mock.patch.dict('os.environ', {'JOBADABRA_FIXTURE_DIR': ''}):
            self.assertEqual([c['name'] for c in scout_role_search.guarded(db, SEARCH)['candidates']], ['Zauber'])


if __name__ == '__main__':
    unittest.main()
