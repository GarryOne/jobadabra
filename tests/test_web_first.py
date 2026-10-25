"""The web search is a source of the run from its start (owner, 26 Oct 2026: "It should not read the web search last. It should probably start with
that."). 25 Oct 2026: a "First Officer, Europe" search read 1,025 employers and jobs.ch for 7 minutes and never searched the web; the web search
waited for a full board read that "found too few". Fake clients and pages only; no seed names a site."""
import threading
import unittest
from unittest import mock

from src.ai import board_ideas
from src.sources import board_web, careers, found_boards
from tests.test_board_web import Base, NOW

PILOT = {'role_keywords': ['first officer'], 'locations': {'top_tier': ['europe'], 'country_wide': [], 'abroad': []}}
# a field board as a web search shows one: its own host, a search link (the shape career.aero and the like have); made up, no real host
FIELD_BOARD = {'name': 'Flight Crew Board', 'search_url': 'https://flightcrew-board.example/jobs?q={role}', 'countries': ['Germany', 'Spain'],
               'kinds': ['other'], 'source_kind': 'sector'}
_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


GENERAL = {'name': 'General Board', 'host': 'general.example', 'search_url': 'https://general.example/?q={role}', 'countries': ['Germany'],
           'kinds': ['any'], 'source_kind': 'general'}


class WebSearchFirst(Base):
    def run_read(self, web_answer, proposal=(GENERAL,)):
        order, searched = [], threading.Event()

        def search(config, known, **kw):
            order.append('web search')
            searched.set()
            return [board_ideas.valid(board) for board in web_answer]

        def read_board(board, config, fetch, route=None, early=False, show=None):
            searched.wait(2)   # the web search started first: the first board read finds it asked already
            order.append(board['host'])
            title = 'First Officer A320' if board['host'] == 'flightcrew-board.example' else 'Accountant'
            return [{'title': title, 'url': f"https://{board['host']}/1", 'location': 'Frankfurt, Germany'}], 'ok', None
        with mock.patch.object(found_boards, 'read_board', read_board), mock.patch.object(found_boards, '_dead', return_value=set()), \
                mock.patch.object(found_boards.board_employers, 'note'), mock.patch.object(board_web, 'search', side_effect=search), \
                mock.patch('builtins.print'):
            jobs = found_boards.read(PILOT, list(proposal), is_relevant=lambda found: [j for j in found if 'Officer' in j['title']], dead=set(), now=NOW)
        return order, jobs

    def test_the_web_search_starts_before_any_board_is_read(self):
        order, _ = self.run_read([FIELD_BOARD])
        self.assertEqual(order[0], 'web search', 'at second 0, not after the read')

    def test_a_field_board_the_search_found_is_read_in_the_same_run_and_keeps_its_origin(self):
        order, jobs = self.run_read([FIELD_BOARD])
        self.assertIn('flightcrew-board.example', order)
        self.assertIn('https://flightcrew-board.example/1', [job['url'] for job in jobs])
        kept = board_ideas.load()['boards']['flightcrew-board.example']
        self.assertEqual(kept['origin'], 'web', 'the web search keeps its own yield')
        self.assertEqual(kept['relevant'], 1)

    def test_no_proposal_at_all_still_searches_the_web(self):
        order, jobs = self.run_read([FIELD_BOARD], proposal=())
        self.assertEqual(order, ['web search', 'flightcrew-board.example'], 'an empty list is the thinnest list')
        self.assertEqual(len(jobs), 1)

    def test_the_first_jobs_slice_never_waits_for_it(self):
        with mock.patch.object(board_web, 'start') as started, mock.patch.object(found_boards, 'read_board', return_value=([], 'ok', None)), \
                mock.patch.object(found_boards, '_dead', return_value=set()), mock.patch.object(found_boards.board_employers, 'note'), \
                mock.patch('builtins.print'):
            found_boards.read(PILOT, [GENERAL], early=True, is_relevant=list, dead=set(), now=NOW)
        started.assert_not_called()


class OneSkip(unittest.TestCase):
    def test_due_never_searched_weekly_while_thin_monthly_once_working(self):
        from datetime import timedelta
        data = {'web': {'k': NOW.isoformat()}}
        working = {'a.example': {'source_kind': 'sector', 'state': 'ok', 'relevant': 3}, 'b.example': {'source_kind': 'regional', 'state': 'ok', 'relevant': 1}}
        self.assertTrue(board_web._due({}, 'k', NOW, {}))
        self.assertFalse(board_web._due(data, 'k', NOW + timedelta(days=board_web.RECENT - 1), {}))
        self.assertTrue(board_web._due(data, 'k', NOW + timedelta(days=board_web.RECENT), {}))
        self.assertFalse(board_web._due(data, 'k', NOW + timedelta(days=board_web.DAYS - 1), working))
        self.assertTrue(board_web._due(data, 'k', NOW + timedelta(days=board_web.DAYS), working))


if __name__ == '__main__':
    unittest.main()
