"""Which country, metro or region a place is in is the AI's judgement; the seed's place patterns answer only with no AI at all (owner, 26 Oct
2026: "The AI decides"; audit PR 3, owner: "Spread over runs"). The seed reads "London, Ontario" as the UK and Europe and "Paris, Texas" as
France: a word in the text, not the place. One loop over every path that labels a place; past the AI's cap a place stays unknown, never a word's guess."""
import json
import sqlite3
import unittest
from types import SimpleNamespace
from unittest import mock

from src import contribute, pool_tags
from src.ai import decide, meanings, meanings_pack
from src.sources import aggregators, google_jobs

PLACES = ['London, Ontario', 'Paris, Texas']
TOPICS = ('pool-country', 'pool-metro', 'pool-region', 'job-region', 'place-country')
WRONG = {'gb', 'fr', 'gb-london', 'fr-paris', 'europe'}   # what the seed's words give these two places


def answer(allowed):
    """A stand-in AI that knows both places are in North America."""
    for right in ('ca', 'north_america', 'none', 'other'):
        if right in allowed:
            return right
    return allowed[-1]


class FakeClient:
    def __init__(self):
        self.calls = 0
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.calls += 1
        content = kwargs['messages'][0]['content']
        allowed = content.split('Allowed answers: ', 1)[1].split('\n', 1)[0].split(', ')
        items = content.split('### Item ')[1:]
        results = [{'index': i, 'answer': answer(allowed)} for i, _ in enumerate(items)]
        return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text=json.dumps({'results': results}))])


SEARCH = {'role_keywords': ['pilot'], 'locations': {'top_tier': PLACES, 'country_wide': [], 'abroad': []}}
PATHS = {
    'pool_tags.countries (a search or an employer)': lambda: set(pool_tags.countries(PLACES)),
    'pool_tags.places metros': lambda: set(pool_tags.places(PLACES)[1]),
    'contribute.tags regions': lambda: set(contribute.tags({**SEARCH, 'role_keywords': []})[1]),
    'contribute.regions_of (a feed)': lambda: set(contribute.regions_of(PLACES)),
    'aggregators._countries (Adzuna)': lambda: set(aggregators._countries(SEARCH)),
}


class PlacesAiFirst(unittest.TestCase):
    def setUp(self):
        decide._calls['n'] = 0
        self.client = FakeClient()
        for patch in (mock.patch.object(decide, '_db', lambda: sqlite3.connect(':memory:')),
                      mock.patch.object(decide.engine, 'ready', return_value=True),
                      mock.patch.object(decide.engine, 'client', lambda **k: self.client),
                      mock.patch.object(meanings, 'engine', decide.engine, create=True),
                      mock.patch.object(meanings_pack, 'queue', lambda *a, **k: None),
                      mock.patch.object(meanings_pack, 'tables', lambda: (meanings_pack._load(meanings_pack.SEED_FILE.read_text(), ''))),
                      mock.patch('src.places.countries', lambda *a, **k: []),
                      mock.patch('src.places.load', lambda *a, **k: {})):
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_seed_still_reads_these_places_by_their_words_so_the_test_proves_something(self):
        self.assertEqual(meanings_pack.every('pool-country', 'London, Ontario'), ['gb'])
        self.assertEqual(meanings_pack.first('place-country', 'Paris, Texas'), 'fr')

    def test_every_place_topic_asks_the_ai_first(self):
        for topic in TOPICS:
            with self.subTest(topic=topic):
                self.assertTrue(meanings_pack.ai_first(topic))

    def test_no_path_that_labels_a_place_answers_with_the_seeds_words(self):
        for name, path in PATHS.items():
            with self.subTest(path=name):
                decide._calls['n'] = 0
                self.assertFalse(path() & WRONG, name)
        self.assertGreater(self.client.calls, 0, 'the AI was asked')

    def test_past_the_cap_a_place_is_unknown_never_a_words_guess(self):
        for name, path in PATHS.items():
            with self.subTest(path=name):
                decide._calls['n'] = decide.MAX_CALLS_PER_RUN
                self.assertFalse(path() & WRONG, name)

    def test_google_jobs_keeps_a_drafted_place_the_ai_has_not_placed_yet(self):
        decide._calls['n'] = decide.MAX_CALLS_PER_RUN
        config = {'locations': [{'location': 'Toronto', 'language': 'en'}], 'country': 'ca'}
        with mock.patch.object(aggregators, '_countries', lambda search: ['ca']):
            kept = google_jobs.within_places(config, SEARCH)
        self.assertEqual(kept['locations'], config['locations'], 'not placed this run: left as drafted (the setup AI drafted it)')

    def test_with_no_ai_at_all_the_seeds_words_are_the_floor(self):
        with mock.patch.object(decide.engine, 'ready', return_value=False):
            self.assertIn('de', pool_tags.countries(['Berlin']))
            self.assertIn('europe', contribute.regions_of(['Berlin']))
            self.assertIn('de', aggregators._countries({'locations': {'top_tier': ['Berlin']}}))


if __name__ == '__main__':
    unittest.main()
