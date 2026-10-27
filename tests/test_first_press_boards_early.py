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

SEARCH = {'locations': ['Zurich'], 'roles': ['Warehouse worker']}
_READER = careers.READER


def setUpModule():   # the guard in tests/test_found_boards_ai.py: no page read reaches a real model from this file
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


BOARDS = [{'name': f'Board {i}', 'host': f'b{i}.test', 'search_url': f'https://b{i}.test/?q={{role}}'} for i in range(8)]


class TheProposalIsAskedAtTheSearchsStart(unittest.TestCase):
    def setUp(self):
        self.addCleanup(first_jobs._early.clear)
        self.asked, self.release = [], threading.Event()

        def ideas(search, client=None, field=True):
            self.asked.append(search)
            self.release.wait(5)
            return list(BOARDS)
        for name, value in (('ideas', ideas), ('proven', lambda search, limit=2: []), ('load', lambda: {'boards': {}})):
            patcher = mock.patch.object(board_ideas, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.read = mock.patch('src.sources.found_boards.read', side_effect=lambda search, top, **kw: [b['host'] for b in top]).start()
        self.addCleanup(mock.patch.stopall)

    def test_the_slice_reads_the_early_proposal_without_asking_again(self):
        self.assertTrue(first_jobs.propose_early(SEARCH), 'started in the background')
        self.release.set()
        hosts = first_jobs.board_jobs(lambda line: None, SEARCH)
        self.assertEqual(len(self.asked), 1, 'the slice took the early answer, no second call')
        self.assertEqual(hosts, [b['host'] for b in BOARDS[:first_jobs.SLICE_BOARDS]])

    def test_it_returns_before_the_answer_comes(self):
        started = time.monotonic()
        first_jobs.propose_early(SEARCH)
        self.assertLess(time.monotonic() - started, 1, 'the search goes on while the proposal is asked')
        self.release.set()

    def test_another_search_asks_its_own(self):
        first_jobs.propose_early(SEARCH)
        self.release.set()
        first_jobs.board_jobs(lambda line: None, {**SEARCH, 'locations': ['Geneva']})
        self.assertEqual(len(self.asked), 2)

    def test_proven_boards_need_no_proposal(self):
        with mock.patch.object(board_ideas, 'proven', lambda search, limit=2: BOARDS[:2]):
            self.assertIsNone(first_jobs.propose_early(SEARCH))
        self.assertEqual(self.asked, [])

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
