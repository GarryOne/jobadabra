"""The central scout's AI ideas aim at the central list's thinnest kind × country (src/scout_cells.py).
19 Oct 2026: they were asked for the example search's data-analyst roles and answered "scale-ups and SaaS or fintech engineering hubs";
Europe had 837 software employers against 5 hospitality and 4 logistics (owner: "a global job search, across europe")."""
import sqlite3
import unittest
from unittest import mock

from src import scout, scout_cells, scout_core
from src.ai import scout_ideas


def feed(kind, *countries):
    return {'kinds': {kind: 0.9}, 'countries': list(countries)}


class ThinCellTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')

    def test_counts_by_main_kind_and_european_country_only(self):
        self.assertEqual(scout_cells.count([feed('healthcare', 'de', 'us'), feed('healthcare', 'de'), {'countries': ['fr']}]),
                         {'healthcare|de': 2, 'unknown|fr': 1})

    def test_aims_at_the_thinnest_cell_then_the_next_never_software(self):
        full = [feed(kind, country) for kind in scout_cells.AIMED for country in ('ch', 'de') for _ in range(scout_cells.FLOOR)]
        scout_cells.keep(self.db, full + [feed('logistics', 'pl')] + [feed('software', 'hu')])
        first = scout_cells.next_cell(self.db)
        self.assertNotEqual(first[0], 'software')
        self.assertNotIn(first[1], ('ch', 'de'), 'cells at the floor are strong enough')
        self.assertNotEqual(first, ('logistics', 'pl'), 'a cell with one employer comes after the empty ones')
        self.assertNotEqual(scout_cells.next_cell(self.db), first, 'the next run aims elsewhere')

    def test_the_floor_follows_the_country_size(self):
        self.assertEqual({scout_cells.floor_for(c) for c in scout_cells.BIG}, {scout_cells.FLOOR})
        self.assertEqual({scout_cells.floor_for(c) for c in scout_cells.SMALL}, {scout_cells.SMALL_FLOOR})
        self.assertTrue(set(scout_cells.BIG + scout_cells.SMALL) <= set(scout_cells.EUROPE), 'every named country is a column of the page')
        self.assertFalse(set(scout_cells.BIG) & set(scout_cells.SMALL))
        self.assertEqual(scout_cells.floor_for('ch'), scout_cells.MID_FLOOR)
        self.assertEqual([scout_cells.floor_for(c) for c in scout_cells.EUROPE].count(scout_cells.MID_FLOOR), 13, 'the 13 mid-size countries')

    def test_a_small_country_at_its_own_floor_is_not_aimed_at(self):
        enough = [feed(kind, 'lu') for kind in scout_cells.AIMED for _ in range(scout_cells.SMALL_FLOOR)]
        scout_cells.keep(self.db, enough)
        seen = {scout_cells.next_cell(self.db) for _ in range(len(scout_cells.AIMED) * len(scout_cells.EUROPE))}
        self.assertFalse([cell for cell in seen if cell and cell[1] == 'lu'])

    def test_no_counts_yet_means_the_usual_search(self):
        own = {'role_keywords': ['data analyst']}
        self.assertEqual(scout_cells.aim(self.db, own), (own, ''))

    def test_the_cell_gets_the_general_prompt_with_its_work_and_country(self):
        scout_cells.keep(self.db, [])
        search, label = scout_cells.aim(self.db, {'role_keywords': ['data analyst']})
        self.assertEqual(label, scout_cells.AIMED[0])
        self.assertEqual(search['locations']['country_wide'], ['Switzerland'])
        nurse = scout_cells.search_for('healthcare', 'pl')
        self.assertEqual((nurse['role_keywords'][0], nurse['locations']['country_wide']), ('nursing', ['Poland']))
        self.assertIs(scout_ideas.ideas_system(nurse), scout_ideas.IDEAS_SYSTEM_GENERAL)
        self.assertEqual(self.db.execute("SELECT value FROM scout_meta WHERE key = 'ideas_cell'").fetchone()[0], f'{label}|ch',
                         'plain text: central_stats sends it to /admin/job-search/scouting as it is')

    def test_the_central_scout_asks_the_ideas_for_the_cell_and_tags_their_origin(self):
        scout_cells.keep(self.db, [])
        asked = []
        def run(db, search, label=''):
            asked.append((search['locations']['country_wide'], label))
            return {'candidates': [], 'companies': 0, 'directories': 0, 'note': ''}
        with mock.patch.object(scout_core, 'CENTRAL', True), mock.patch.object(scout_ideas, 'run', run), \
                mock.patch('src.features.enabled', lambda name: True), mock.patch('src.ai.engine.ready', lambda: True), \
                mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': ''}):
            scout.ai_ideas(self.db)
        self.assertEqual(asked, [(['Switzerland'], scout_cells.AIMED[0])])

    def test_the_origin_carries_the_kind(self):
        self.assertEqual(scout_ideas.origin_kind('AI idea healthcare 2026-10-19'), 'AI idea healthcare')


if __name__ == '__main__':
    unittest.main()


class CountryTotalsTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')

    def test_totals_count_employers_with_local_jobs_in_each_european_country_once(self):
        feeds = [{'countries': ['de', 'de', 'us']}, {'countries': ['de', 'ee']}, {'countries': []}, {}]
        self.assertEqual(scout_cells.totals(feeds), {'de': 2, 'ee': 1})

    def test_the_summary_line_lists_every_european_country_thinnest_first(self):
        line = scout_cells.coverage_line({'de': 500, 'ee': 1})
        for country in scout_cells.EUROPE:
            self.assertIn(f'{country} ', line)
        self.assertLess(line.index('ee 1*'), line.index('de 500'))
        self.assertNotIn('de 500*', line)

    def test_the_company_lists_look_at_the_thinnest_country_then_the_next(self):
        scout_cells.keep(self.db, [{'countries': ['de']} for _ in range(scout_cells.LOCAL_FLOOR)] + [{'countries': ['ee']}])
        first = scout_cells.next_country(self.db)
        self.assertEqual(len(first), 2)
        self.assertEqual(first, first.upper())
        self.assertNotEqual(first, 'DE', 'a country at the floor is strong enough')
        self.assertNotEqual(scout_cells.next_country(self.db), first, 'the next run looks elsewhere')

    def test_no_counts_yet_means_no_extra_country(self):
        self.assertIsNone(scout_cells.next_country(self.db))

    def test_only_the_central_scout_adds_a_country_to_the_wikidata_list(self):
        from src import scout_candidates
        scout_cells.keep(self.db, [{'countries': ['de']}])
        with mock.patch.object(scout_core, 'CENTRAL', False):
            self.assertEqual(scout_candidates.central_countries(self.db, ['Switzerland']), ['Switzerland'])
        with mock.patch.object(scout_core, 'CENTRAL', True):
            got = scout_candidates.central_countries(self.db, ['Switzerland'])
        self.assertEqual(got[0], 'Switzerland')
        self.assertEqual(len(got), 2)
