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
from src.sources import aggregators, careers, eures  # noqa: E402

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER

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

        def get(url, data=None, headers=None, timeout=None):
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

    def test_it_runs_past_the_read_cut_and_stops_asking_after_its_own_time(self):
        from src.sources import read_budget
        self.assertIn('EURES', aggregators.CHEAP_PAST_CUT)
        asked = []
        with mock.patch.object(eures, 'out_of_time', lambda began, now=None: True):
            found = eures.eures(SEARCH, get=lambda *a, **k: asked.append(1) or {'jvs': []}, client=Client({'Brussels': 'BE10'}))
        self.assertEqual((found, asked), ([], []), 'past its own time it asks for nothing more')

    def test_scan_reads_eures_after_the_cut_but_queues_the_others(self):
        import sqlite3
        from src.sources import read_budget
        read = []
        db = sqlite3.connect(':memory:')
        with mock.patch.object(read_budget, 'past_cut', lambda now=None: True), mock.patch('builtins.print'), mock.patch('src.time_budget.later'):
            aggregators.scan(db, SEARCH, readers=[('Arbeitnow', lambda s: read.append('A') or []), ('EURES', lambda s: read.append('E') or [])])
        self.assertEqual(read, ['E'])


    def test_it_never_reads_into_the_ai_steps_share_of_the_180_seconds(self):
        from src import time_budget
        began = time_budget.BEGAN
        try:
            time_budget.start(180, now=1000.0)
            self.assertFalse(eures.out_of_time(1000.0 + 72, now=1000.0 + 80), 'at 80 s there is room')
            self.assertTrue(eures.out_of_time(1000.0 + 72, now=1000.0 + 100), '25 s after its start')
            self.assertTrue(eures.out_of_time(1000.0 + 90, now=1000.0 + 95), 'titles reserve (70 s) + tail (15 s) before 180 s')
        finally:
            time_budget.DEADLINE = time_budget.STARTED = time_budget.BEGAN = time_budget.STAGE_END = None

    def test_a_read_cut_short_by_its_clock_is_queued_not_marked_read_and_asks_nothing(self):
        import sqlite3
        asked = []
        db = sqlite3.connect(':memory:')

        def cut(search):
            with mock.patch.object(eures, 'out_of_time', lambda began, now=None: True):
                return eures.eures(search, get=lambda *a, **k: asked.append(1) or {'jvs': []}, client=Client({}))
        with mock.patch('builtins.print'), mock.patch('src.time_budget.later') as later:
            aggregators.scan(db, SEARCH, readers=[('EURES', cut)])
        self.assertEqual((asked, eures.CUT[0]), ([], True))
        self.assertIsNone(aggregators.read_lately(db, 'EURES', search=SEARCH), 'not marked read: the next search reads it')
        later.assert_called()

    def test_the_stage_takes_the_read_started_with_the_search_and_asks_nothing_itself(self):
        calls = []

        def get(url, data=None, headers=None, timeout=None):
            calls.append(1)
            return {'jvs': [jv('a', 'Carpenter', 'BE100')]}
        read = mock.Mock(return_value=[{'id': 'eures:a'}])
        with mock.patch.object(eures, 'eures', read), mock.patch('builtins.print'):
            future = eures.start_early(SEARCH)
            future.result(5)
            taken = eures.read(SEARCH)
        self.assertEqual((taken, read.call_count, calls), ([{'id': 'eures:a'}], 1, []), 'one read, started early; the stage only takes it')
        self.assertEqual(eures._early, {}, 'taken once')

    def test_the_early_read_is_not_started_in_the_fixture_mode(self):
        with mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': '/x'}):
            self.assertIsNone(eures.start_early(SEARCH))

    def test_the_search_starts_it_with_the_run(self):
        body = (Path(__file__).resolve().parents[1] / 'src' / 'daily_search.py').read_text()
        self.assertIn('eures.start_early(', body[body.index('board_web.early('):])


if __name__ == '__main__':
    unittest.main()
