"""EURES reader (src/sources/eures.py): a job counts only where its region code lies in the user's place; the region comes from the AI, validated. No network."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import geo  # noqa: E402
from src.sources import aggregators, eures  # noqa: E402

SEARCH = {'role_keywords': ['carpenter'], 'locations': {'top_tier': ['Brussels'], 'country_wide': [], 'abroad': []}}


class Client:
    """Answers the region question with a fixed NUTS-2 code per place word."""
    def __init__(self, answers):
        self.answers, self.messages = answers, SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        words = [line.split('. ', 1)[1] for line in kwargs['messages'][0]['content'].splitlines()[1:]]
        body = {'regions': [{'n': n, 'nuts2': self.answers.get(word, '')} for n, word in enumerate(words, 1)]}
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(body))], usage=SimpleNamespace(input_tokens=0, output_tokens=0))


def jv(id, title, code, employer='Acme'):
    return {'id': id, 'title': title, 'description': '<p>Join us</p>', 'creationDate': 1792768562000, 'employer': {'name': employer}, 'locationMap': {code[:2]: [code]}}


class EuresTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        for target in ('src.sources.eures.STORE', 'src.geo.STORE'):
            mock.patch(target, Path(self.tmp.name) / (target.split('.')[-2] + '.json')).start()
        self.addCleanup(mock.patch.stopall)
        self.addCleanup(self.tmp.cleanup)
        mock.patch.object(geo, 'resolve', lambda words, client=None, ask=True, share=False: {geo.norm(w): {'kind': 'city', 'cc': 'BE', 'lat': 50.8, 'lon': 4.4, 'r': 30} for w in words}).start()

    def test_keeps_only_jobs_whose_region_is_the_places_with_the_place_as_location(self):
        calls = []

        def get(url, data=None, headers=None):
            calls.append(json.loads(data))
            return {'jvs': [jv('a', 'Carpenter', 'BE100'), jv('b', 'Carpenter', 'BE255')]}   # Brussels region; West Flanders
        found = eures.eures(SEARCH, get=get, client=Client({'Brussels': 'BE10'}))
        self.assertEqual([(j['id'], j['location']) for j in found], [('eures:a', 'Brussels, Belgium')])
        self.assertEqual(calls[0]['locationCodes'], ['be'])

    def test_a_region_code_of_another_country_is_dropped_and_the_place_not_read(self):
        read = []
        found = eures.eures(SEARCH, get=lambda *a, **k: read.append(1) or {'jvs': []}, client=Client({'Brussels': 'FR10'}))
        self.assertEqual((found, read), ([], []), 'an unvalidated region is unknown, never read on a guess')

    def test_registered_as_a_free_api_and_off_by_its_switch(self):
        self.assertIn('EURES', [name for name, _ in aggregators.sources({})])
        self.assertNotIn('EURES', [name for name, _ in aggregators.sources({'JOB_PILOTTO_DISABLE': 'eures'})])


if __name__ == '__main__':
    unittest.main()
