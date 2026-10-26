import unittest
from unittest import mock

from src.sources import boards

# What places.json holds once the AI worked the words out (src/places.py): each word's countries, in any language.
KNOWN = {'zürich': {'kind': 'city', 'countries': ['Switzerland']}, 'genève': {'kind': 'city', 'countries': ['Switzerland']},
         'são bernardo do campo': {'kind': 'city', 'countries': ['Brazil']}, 'sao paulo': {'kind': 'city', 'countries': ['Brazil']},
         'brazil': {'kind': 'country', 'countries': ['Brazil']}, 'portugal': {'kind': 'country', 'countries': ['Portugal']}}


class SwissPlaceTest(unittest.TestCase):
    """A search is Swiss when the AI said one of its place words is in Switzerland, or a Swiss region word names it (6 Oct 2026: a regex
    read 'bern' in São Bernardo, so a Brazilian user's search was read as Swiss; 8 Oct 2026: no regex of place names at all)."""

    def setUp(self):
        patch = mock.patch('src.places.load', return_value=KNOWN)
        patch.start()
        self.addCleanup(patch.stop)

    def test_swiss_places_are_swiss(self):
        for word in ('Zürich', 'Genève', 'Romandie'):
            self.assertEqual(boards.swiss_place_word({'locations': {'top_tier': [word]}}), word)

    def test_a_brazilian_search_is_not_swiss(self):
        search = {'locations': {'top_tier': ['são bernardo do campo', 'sao paulo'], 'country_wide': ['brazil'], 'abroad': ['portugal']}}
        self.assertFalse(boards.swiss_places(search))

    def test_a_swiss_city_is_swiss_before_the_ai_worked_it_out(self):
        """The first market works offline: Switzerland's fixed table (src/regions.py) knows its towns, so a Zurich or Basel search crawls
        jobs.ch on its first run, with or without AI (8 Oct 2026, the owner: "will the app work the same for a Swiss candidate?")."""
        with mock.patch('src.places.load', return_value={}):
            for word in ('Basel', 'Zürich', 'Lugano', 'Zug'):
                self.assertEqual(boards.swiss_place_word({'locations': {'top_tier': [word]}}), word)
            self.assertIsNone(boards.swiss_place_word({'locations': {'top_tier': ['São Bernardo do Campo']}}))


class PlaceCountryDecidesTest(unittest.TestCase):
    """18 Oct 2026, persona runs: a Nuremberg driver's place "altdorf" (Altdorf bei Nürnberg, placed in Germany by the AI) matched the Swiss
    town Altdorf in the fixed table, and jobs.ch was searched for Nuremberg. A place's country decides, never a shared word: every reader of
    "is this search Swiss" goes through places.in_switzerland."""
    SEARCH = {'locations': {'top_tier': ['n[uü]rnberg'], 'country_wide': ['altdorf'], 'abroad': []}}

    def readers(self):
        from src import pool_tags
        from src.sources import aggregators, google_jobs
        with mock.patch.object(pool_tags.meanings, 'labels', return_value=[]), mock.patch('src.ai.meanings_pack.every', return_value=[]), \
                mock.patch('src.ai.decide.decide', return_value=None), mock.patch('builtins.print'):
            return {'job boards': boards.swiss_place_word(self.SEARCH) is not None,
                    'aggregator countries': 'ch' in aggregators._countries(self.SEARCH),
                    'pool tags': 'ch' in pool_tags.places(['altdorf'])[0],
                    # Google Jobs searches Switzerland (gl=ch kept); an unplaced "Altdorf" itself stays as drafted (unknown, never dropped on a guess)
                    'google jobs': google_jobs.within_places({'locations': ['Altdorf'], 'country': 'ch'}, self.SEARCH)['country'] == 'ch'}

    def test_a_place_the_ai_put_in_another_country_is_not_swiss_anywhere(self):
        known = {'altdorf': {'kind': 'city', 'countries': ['Germany']}, 'nürnberg': {'kind': 'city', 'countries': ['Germany']}}
        with mock.patch('src.places.load', return_value=known):
            self.assertEqual(self.readers(), dict.fromkeys(('job boards', 'aggregator countries', 'pool tags', 'google jobs'), False))

    def test_the_towns_added_for_a_region_keep_its_country(self):
        """18 Oct 2026, rerun on main: "Franken" was expanded (places.expand) with its towns and states, among them Baden-Württemberg; the
        added fragment had no entry of its own, fell back to the Swiss town table, matched "Baden", and jobs.ch was searched for Nuremberg
        twice a press (355 s before the first board jobs). Google Jobs is not in this list: it reads the user's own Google locations,
        never the added fragments."""
        from src import places, pool_tags
        from src.sources import aggregators
        known = {'franken': {'kind': 'region', 'names': ['Nürnberg', 'Baden-Württemberg', 'Hof'], 'countries': ['Germany']}}
        added = places.expand(['Franken'], known)[1]
        search = {'locations': {'top_tier': [], 'country_wide': places.expand(['Franken'], known), 'abroad': []}}
        with mock.patch('src.places.load', return_value=known), mock.patch.object(pool_tags.meanings, 'labels', return_value=[]), \
                mock.patch('src.ai.meanings_pack.every', return_value=[]), mock.patch('src.ai.decide.decide', return_value=None), \
                mock.patch('builtins.print'):
            got = {'in_switzerland': places.in_switzerland(added, known), 'job boards': boards.swiss_place_word(search),
                   'aggregator countries': 'ch' in aggregators._countries(search), 'pool tags': 'ch' in pool_tags.places([added])[0]}
        self.assertEqual(got, {'in_switzerland': False, 'job boards': None, 'aggregator countries': False, 'pool tags': False})

    def test_before_the_ai_placed_it_the_fixed_table_still_answers(self):
        with mock.patch('src.places.load', return_value={}):
            got = self.readers()
        self.assertTrue(all(got.values()), got)


if __name__ == '__main__':
    unittest.main()
