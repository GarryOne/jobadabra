"""The boards of the search's own field are asked once for all its places and read first (owner's yes, 26 Oct 2026, discovery sketch "Field
first"): a First Officer in Europe was asked as 10 slices of 5 countries with "public service first, then general boards": 111 boards, 14 for
aviation, 2 of them read, because the slices' general boards filled the list. Fake AI client only (src/ai/board_ideas.py)."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src.ai import board_ideas

COUNTRIES = ['Austria', 'Belgium', 'Croatia', 'Czechia', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Ireland']
EUROPE = {'role_keywords': ['first officer'], 'locations': {'top_tier': ['Europe'], 'country_wide': [], 'abroad': []}}
FIELD = [{'name': f'Flight Crew Board {n}', 'search_url': f'https://crew{n}.example/jobs?q={{role}}', 'countries': ['Europe'],
          'kinds': ['aviation_transport'], 'source_kind': 'sector'} for n in range(3)]
FIELD += [{'name': 'Crew Careers', 'search_url': 'https://crew-careers.example/site/en/job/list/category/1-flight-crew', 'countries': ['Germany'],
           'kinds': ['aviation_transport']},   # unmarked: a board of the field
          {'name': 'Every Job', 'search_url': 'https://every-job.example/jobs/all', 'countries': ['Germany'], 'kinds': ['any'],
           'source_kind': 'general'}]   # marked general by the AI: no keyword search page, so not read


def general(n):
    return {'name': f'General {n}', 'search_url': f'https://general{n}.example/?q={{role}}', 'countries': ['Germany'], 'kinds': ['any'],
            'source_kind': 'general'}


class Client:
    """The field instruction gets the field's boards; each country slice gets 12 general boards of its own."""
    def __init__(self):
        self.asked, self.messages = [], self

    def create(self, **kw):
        self.asked.append(kw)
        if kw['system'][0]['text'] == board_ideas.FIELD_SYSTEM:
            boards = FIELD
        else:
            first = len(self.asked) * 100
            boards = [general(first + n) for n in range(12)]
        return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text=json.dumps({'boards': boards}))])


class FieldBoards(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.ai.cost.side'),
                      mock.patch('src.places.countries', return_value=COUNTRIES), mock.patch('src.places.words_of', return_value=['Europe']),
                      mock.patch('src.role_kinds.of_search', return_value={'aviation_transport'})):
            patch.start()
            self.addCleanup(patch.stop)

    def test_the_field_s_boards_are_asked_once_for_every_place_and_come_first(self):
        client = Client()
        found = board_ideas.ideas(EUROPE, client)
        field_calls = [kw for kw in client.asked if kw['system'][0]['text'] == board_ideas.FIELD_SYSTEM]
        self.assertEqual(len(field_calls), 1, 'one call for the field, besides the per-country slices')
        sent = json.loads(field_calls[0]['messages'][0]['content'])
        self.assertEqual((sent['countries'], sent['roles'], sent['kinds']), (COUNTRIES, ['first officer'], ['aviation_transport']),
                         'every country of the region at once, the roles and the kind of work; never the CV')
        hosts = [board['host'] for board in found]
        self.assertEqual(hosts[:4], ['crew0.example', 'crew1.example', 'crew2.example', 'crew-careers.example'],
                         "the field's boards lead the list, before the slices' general boards fill its cap")
        self.assertEqual({board['source_kind'] for board in found[:4]}, {'sector'}, 'each is a board of the field')
        self.assertNotIn('every-job.example', hosts, 'one the AI marked general, with no keyword search page: not read')
        self.assertEqual(len(found), board_ideas.MAX_BOARDS * 2)
        calls = len(client.asked)
        self.assertEqual(board_ideas.ideas(EUROPE, client), found)
        self.assertEqual(len(client.asked), calls, 'kept: asked again only for another search')

    def test_without_ai_nothing_is_asked_and_a_failed_field_call_leaves_the_slices(self):
        with mock.patch('src.ai.engine.ready', return_value=False):
            self.assertEqual(board_ideas.ideas(EUROPE), [])
        broken = Client()
        real = broken.create

        def create(**kw):
            if kw['system'][0]['text'] == board_ideas.FIELD_SYSTEM:
                raise RuntimeError('busy')
            return real(**kw)
        broken.create = create
        found = board_ideas.ideas(EUROPE, broken)
        self.assertTrue(found and all(board['host'].startswith('general') for board in found), "the slices' boards still come")


if __name__ == '__main__':
    unittest.main()
