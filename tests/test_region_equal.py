"""A region is all its countries, at equal weight (owner, 26 Oct 2026: ""Europe" is read as Switzerland, so jobs.ch is picked first" This is wrong.
It should not counted as Switzerland. Europe should be europe. All countries should have equal weight.").

25 Oct 2026: the owner's "europe" was kept as 10 countries with Switzerland among them; places.in_switzerland said yes, so the Swiss board pass
(jobs.ch) ran first, the pool labelled the search 'ch' only, and the board proposal asked for the first 5 countries alone. Every check below
loops over every region the cache can hold, so a new region or a new place check is held to the same rule."""
import json
import unittest
from unittest import mock

from src import places, pool_tags
from src.ai import board_ideas
from src.sources import boards

EUROPE = ['United Kingdom', 'Germany', 'France', 'Spain', 'Italy', 'Portugal', 'Netherlands', 'Belgium', 'Switzerland', 'Austria', 'Poland',
          'Sweden', 'Denmark', 'Norway', 'Finland', 'Ireland', 'Czechia', 'Romania', 'Greece', 'Hungary']
REGIONS = {
    'europe': EUROPE,
    'dach': ['Germany', 'Austria', 'Switzerland'],
    'nordics': ['Sweden', 'Denmark', 'Norway', 'Finland', 'Iceland'],
    'benelux': ['Belgium', 'Netherlands', 'Luxembourg'],
}
CACHE = {word: {'word': word, 'kind': 'region', 'names': [], 'countries': countries, 'every': True, 'at': '2026-10-26'}
         for word, countries in REGIONS.items()}
CACHE['zurich'] = {'word': 'zurich', 'kind': 'city', 'names': [], 'countries': ['Switzerland'], 'at': '2026-10-26'}
CACHE['geneva region'] = {'word': 'geneva region', 'kind': 'state', 'names': ['Geneva'], 'countries': ['Switzerland'], 'at': '2026-10-26'}


def search(word):
    return {'role_keywords': ['first officer'], 'locations': {'top_tier': [word], 'country_wide': [], 'abroad': []}}


class RegionIsAllItsCountries(unittest.TestCase):
    def setUp(self):
        for patch in (mock.patch.object(places, 'load', return_value=CACHE),
                      mock.patch('src.ai.meanings.labels', return_value=[])):   # no AI: a region names no single country
            patch.start()
            self.addCleanup(patch.stop)

    def test_no_region_is_read_as_one_of_its_countries(self):
        for word in REGIONS:
            with self.subTest(word):
                self.assertFalse(places.in_switzerland(word, CACHE), 'a region with Switzerland in it is not a Swiss place')
                self.assertIsNone(boards.swiss_place_word(search(word)), 'so the Swiss-only boards do not run first')

    def test_a_swiss_place_is_still_swiss(self):
        for word in ('zurich', 'geneva region'):
            with self.subTest(word):
                self.assertTrue(places.in_switzerland(word, CACHE))

    def test_a_region_gives_every_country_and_no_country_leads(self):
        for word, countries in REGIONS.items():
            with self.subTest(word):
                self.assertEqual(sorted(places.countries(search(word), CACHE, limit=None)), sorted(countries))

    def test_the_pool_label_is_every_listed_country_of_the_region(self):
        for word, countries in REGIONS.items():
            with self.subTest(word):
                ids = {code for code, name in pool_tags.COUNTRIES.items() if name in countries}
                self.assertEqual(set(pool_tags.countries([word])), ids, 'never Switzerland alone')

    def test_the_board_proposal_covers_every_country_in_equal_slices(self):
        for word, countries in REGIONS.items():
            with self.subTest(word):
                asked = board_ideas.slices(search(word))
                covered = [country for _, slice_countries, *_ in asked for country in slice_countries]
                self.assertEqual(sorted(covered), sorted(countries), 'every country, once')
                self.assertTrue(all(len(s[1]) <= board_ideas.SLICE for s in asked))
                sizes = [len(s[1]) for s in asked]
                self.assertLessEqual(max(sizes) - min(sizes), 1, 'equal slices: no country group gets more weight')

    def test_a_region_kept_before_every_country_was_asked_is_asked_again(self):
        old = {'europe': {'word': 'europe', 'kind': 'region', 'names': ['London'], 'countries': EUROPE[:10], 'at': '2026-10-25'}}
        self.assertEqual(places.stale_words(search('europe'), old), ['europe'])
        self.assertEqual(places.stale_words(search('europe'), CACHE), [])


class AskKeepsEveryCountry(unittest.TestCase):
    def test_the_model_s_countries_of_a_region_are_all_kept(self):
        answer = {'places': [{'word': 'europe', 'kind': 'region', 'names': ['London'], 'countries': EUROPE}]}
        response = mock.Mock(stop_reason='end_turn', usage=mock.Mock(), content=[mock.Mock(type='text', text=json.dumps(answer))])
        client = mock.Mock()
        client.messages.create.return_value = response
        with mock.patch('src.ai.cost.side'):
            kept = places.ask(client, ['europe'])
        self.assertEqual(kept['europe']['countries'], EUROPE)
        self.assertTrue(kept['europe']['every'])
        self.assertIn('every country it covers', client.messages.create.call_args.kwargs['system'][0]['text'])


if __name__ == '__main__':
    unittest.main()
