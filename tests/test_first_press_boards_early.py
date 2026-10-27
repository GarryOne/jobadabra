"""A first press asks its slice's board proposal at the search's start, and the scout's employer lists end with its names' time (27 Oct 2026,
benchmark run 40446066828: the proposal's 2 AI calls, asked inside the slice, waited for Claude's 2 slots behind the employer titles and the
web search, so the slice's boards started at 41-63 s and the read cut (67 s) left them 5-26 s, 0 board jobs for every persona; then the
scout's lists (a Wikidata 504) took 77-138 s of its 45 s share and every press ran 180-251 s)."""
import sqlite3
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from src import first_jobs, scout_core, scout_candidates
from src.ai import board_ideas
from src.sources import careers

_READER = careers.READER


def setUpModule():   # the guard in tests/test_found_boards_ai.py: no page read reaches a real model from this file
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'locations': ['Zurich'], 'role_keywords': ['Warehouse worker']}
ASKED = ('k1', ['Switzerland'], ['Warehouse worker'], ['logistics'], ['zurich'])
OWN = [{'name': f'Board {i}', 'search_url': f'https://b{i}.test/?q={{role}}', 'countries': ['Switzerland'], 'kinds': ['logistics'],
        'source_kind': 'general'} for i in range(3)]
SHARED = {'name': 'shared.test', 'host': 'shared.test', 'search_url': 'https://shared.test/jobs', 'countries': ['Switzerland'],
          'kinds': ['any'], 'source_kind': 'general'}


class TheProposalIsAskedAtTheSearchsStart(unittest.TestCase):
    """The AI's answers are asked early and cached; the slice's list is built when it reads (run 40449103205: an early list lost the
    pool's shared boards, downloaded after it)."""
    def setUp(self):
        self.addCleanup(first_jobs._early.clear)
        self.asks, self.release, self.downloaded, store = [], threading.Event(), [], {}

        def ask(system, content, client=None):
            self.asks.append(system)
            self.release.wait(5)
            return list(OWN)
        for name, value in (('_ask', ask), ('proven', lambda search, limit=2: []), ('slices', lambda search: [ASKED]),
                            ('asked_for', lambda search: ASKED), ('load', lambda: store), ('save', lambda data: None),
                            ('served', lambda countries: [dict(SHARED)] if self.downloaded else [])):
            patcher = mock.patch.object(board_ideas, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = mock.patch('src.sources.found_boards.read', side_effect=lambda search, top, **kw: [b['host'] for b in top])
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.release.set)

    def read_slice(self, search=SEARCH):
        with mock.patch('builtins.print'):
            return first_jobs.board_jobs(lambda line: None, search)

    def test_the_slice_asks_the_ai_nothing_twice_and_keeps_the_shared_boards(self):
        with mock.patch('builtins.print'):
            self.assertTrue(first_jobs.propose_early(SEARCH), 'started in the background')
            self.release.set()
            first_jobs._early['future'].result(5)
        asked = len(self.asks)
        self.downloaded.append(True)   # the pool's index comes after the early ask
        hosts = self.read_slice()
        self.assertEqual(len(self.asks), asked, 'the slice took the cached answers')
        self.assertIn('shared.test', hosts, "the pool's boards, served when the slice reads")
        self.assertIn('b0.test', hosts)

    def test_the_slice_waits_for_an_answer_still_coming(self):
        with mock.patch('builtins.print'):
            first_jobs.propose_early(SEARCH)
        threading.Timer(0.2, self.release.set).start()
        hosts = self.read_slice()
        self.assertEqual(len(self.asks), 2, 'field + one slice of countries, asked once each')
        self.assertIn('b0.test', hosts)

    def test_it_returns_before_the_answer_comes(self):
        started = time.monotonic()
        with mock.patch('builtins.print'):
            first_jobs.propose_early(SEARCH)
        self.assertLess(time.monotonic() - started, 1, 'the search goes on while the proposal is asked')

    def test_proven_boards_need_no_proposal(self):
        with mock.patch.object(board_ideas, 'proven', lambda search, limit=2: [SHARED]):
            self.assertIsNone(first_jobs.propose_early(SEARCH))
        self.assertEqual(self.asks, [])

    def test_the_search_starts_it_before_picking_its_employers(self):
        body = (Path(__file__).resolve().parents[1] / 'src' / 'daily_search.py').read_text()
        body = body[body.index('def search('):]
        self.assertIn('first_jobs.propose_early(', body)
        self.assertLess(body.index('first_jobs.propose_early('), body.index('scout.active_sources('),
                        'asked while the employers are picked (one AI slot is free then), not inside the slice')


class TheScoutsListsEndWithItsNamesTime(unittest.TestCase):
    def test_no_list_starts_past_its_time(self):
        called = []
        with mock.patch('builtins.print'):
            added = scout_candidates.harvest(sqlite3.connect(':memory:'), {}, [lambda: called.append(1) or []], until=time.monotonic() - 1)
        self.assertEqual((added, called), (0, []))

    def test_a_list_read_waits_at_most_the_time_left(self):
        seen = []

        def opened(request, timeout):
            seen.append(timeout)
            raise OSError('stub')
        with mock.patch.object(scout_core.host_pace, 'open', opened), mock.patch('builtins.print'):
            scout_candidates.harvest(sqlite3.connect(':memory:'), {}, [lambda: scout_core._get_json('https://query.wikidata.org/x')], until=time.monotonic() + 5)
        self.assertEqual(len(seen), 1)
        self.assertLessEqual(seen[0], 5, 'a Wikidata 504 took 93 s of a 45 s scout')
        self.assertIsNone(scout_core._reads_end[0], 'the bound ends with the lists: the checks read as before')

    def test_a_read_past_the_time_raises_at_once(self):
        scout_core._reads_end[0] = time.monotonic() - 1
        self.addCleanup(scout_core._reads_end.__setitem__, 0, None)
        with self.assertRaises(TimeoutError):
            scout_core._get_text('https://example.test/')


if __name__ == '__main__':
    unittest.main()
