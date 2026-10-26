"""Specialist and local job boards found with a web search when a full read had no trade or local board that gave a job (src/sources/board_web.py;
owner's yes 19 Oct 2026, step 3 of the local-sources sketch). Fake AI client only."""
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src.ai import board_ideas
from src.sources import board_web, careers, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'role_keywords': ['Tontechniker'], 'locations': {'top_tier': ['Berlin'], 'country_wide': ['Germany'], 'abroad': []}}
NOW = datetime(2026, 10, 19, 9, tzinfo=timezone.utc)
STAGE = {'name': 'Bühnenjobs Berlin', 'search_url': 'https://buehnenjobs.example/suche?q={role}&ort={place}', 'countries': ['Germany'],
         'kinds': ['creative_media'], 'source_kind': 'sector'}


def board(n, kind='general'):
    return {'name': f'Board {n}', 'host': f'b{n}.example', 'search_url': f'https://b{n}.example/?q={{role}}', 'countries': ['Germany'],
            'kinds': ['any'], 'source_kind': kind}


class Client:
    def __init__(self, boards):
        self.boards, self.asked = boards, []
        self.messages = self

    def create(self, **kw):
        self.asked.append(kw)
        text = json.dumps({'boards': self.boards})
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=text)], usage=SimpleNamespace(input_tokens=1, output_tokens=1),
                               stop_reason='end_turn')


class Base(unittest.TestCase):
    def setUp(self):
        careers.READER = 'auto'
        self.addCleanup(setattr, careers, 'READER', None)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.ai.cost.side'),
                      mock.patch.object(board_ideas, 'asked_for', return_value=('k1', ['Germany'], ['Tontechniker'], [], ['Berlin']))):
            patch.start()
            self.addCleanup(patch.stop)
        board_ideas.save({'ideas': {'k1': [board(1)]}, 'boards': {}})


class SearchTests(Base):
    def test_found_boards_join_the_proposal(self):
        client = Client([STAGE, {**board(1), 'search_url': 'https://b1.example/?q={role}'}, {'name': 'Broken', 'search_url': 'http://x'}])
        found = board_web.search(SEARCH, [board(1)], client=client, now=NOW)
        self.assertEqual([b['host'] for b in found], ['buehnenjobs.example'], 'new hosts only, validated')
        self.assertEqual(client.asked[0]['tools'][0]['type'], 'web_search_20250305')
        self.assertIn('Board 1', client.asked[0]['messages'][0]['content'], 'the known boards are named, so it looks past them')
        self.assertEqual([b['host'] for b in board_ideas.load()['ideas']['k1']], ['b1.example', 'buehnenjobs.example'])
        # its cadence (next run while thin, weekly after TRIES, monthly once working): tests/test_board_web_thin.py

    def test_a_board_found_as_a_plain_page_gets_its_home_page_s_search_link(self):
        crew = {'name': 'Crew Board', 'search_url': 'https://crew.example/', 'countries': ['Germany'], 'kinds': ['creative_media'],
                'source_kind': 'sector'}
        bare = {**crew, 'name': 'No Form', 'search_url': 'https://noform.example/jobs'}
        pages = {'https://crew.example/': '<form action="/jobs" method="get"><input name="was"><input name="wo"></form>',
                 'https://noform.example/': '<p>Jobs</p>'}
        with mock.patch('src.sources.board_pages.PAUSE_S', 0):
            found = board_web.search(SEARCH, [board(1)], client=Client([crew, bare]), now=NOW, fetch=lambda url: pages.get(url, ''))
        self.assertEqual([(b['host'], b['search_url']) for b in found], [('crew.example', 'https://crew.example/jobs?was={role}&wo={place}')],
                         'a page with no search form is not a board we can search')

    def test_off_with_the_page_reader_off_or_an_engine_that_cannot_search(self):
        careers.READER = None
        self.assertEqual(board_web.search(SEARCH, [], client=Client([STAGE]), now=NOW), [])
        careers.READER = 'auto'
        with mock.patch('src.ai.engine.choice', return_value='free'), mock.patch('src.ai.engine.client') as made:
            self.assertEqual(board_web.search(SEARCH, [], now=NOW), [])
            made.assert_not_called()

    def test_needed_only_without_two_working_trade_or_local_boards(self):
        kept = {'b1.example': {'source_kind': 'sector', 'state': 'ok', 'relevant': 3}, 'b2.example': {'source_kind': 'regional', 'state': 'ok', 'relevant': 1},
                'b3.example': {'source_kind': 'sector', 'state': 'browser', 'relevant': 0}, 'b4.example': {'source_kind': 'general', 'state': 'ok', 'relevant': 9}}
        self.assertFalse(board_web.needed(kept, [board(1), board(2), board(3), board(4)]))
        self.assertTrue(board_web.needed(kept, [board(1), board(3), board(4)]), 'a refusing or a general board does not count')


class ReadTests(Base):
    def test_a_full_read_without_trade_boards_reads_what_the_search_found_and_the_slice_never_searches(self):
        asked, searched = [], []

        def read_board(b, search, fetch, route=None, early=False, show=None):
            asked.append(b['host'])
            return [{'title': 'Tontechniker', 'url': f"https://{b['host']}/1", 'location': 'Berlin'}], 'ok', None
        with mock.patch.object(found_boards, 'read_board', read_board), mock.patch.object(found_boards, '_dead', return_value=set()), \
                mock.patch.object(found_boards.board_employers, 'note'), \
                mock.patch.object(board_web, 'search', side_effect=lambda s, known, **k: searched.append([b['host'] for b in known]) or [board_ideas.valid(STAGE)]), \
                mock.patch('builtins.print'):
            found_boards.read(SEARCH, [board(1)], early=True, is_relevant=list, dead=set())
            self.assertEqual(searched, [], 'the first-jobs slice never waits for a web search')
            jobs = found_boards.read(SEARCH, [board(1)], is_relevant=list, dead=set())
        self.assertEqual(len(searched), 1, 'the full read searches the web once, from its start')
        self.assertEqual(asked, ['b1.example', 'b1.example', 'buehnenjobs.example'], 'read in the same search, the others not again')
        self.assertIn('https://buehnenjobs.example/1', [job['url'] for job in jobs])


if __name__ == '__main__':
    unittest.main()
