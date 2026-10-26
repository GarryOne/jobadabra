"""The found boards rest one by one, not as a whole (owner's pilot run 310b52400c0d, 26 Oct 2026: the board read was rested for 6 hours after a
read at 22:44, so the aviation boards proposed at 00:07 were never read and no web search ran, with no line saying so)."""
import contextlib
import io
import sqlite3
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from src.sources import aggregators, board_web, board_yield, boards_ahead, careers, found_boards

PILOT = {'role_keywords': ['first officer'], 'jobs_board_search_queries': ['first officer'], 'locations': {'top_tier': ['europe']}}
NOW = datetime(2026, 10, 26, 0, 49, tzinfo=timezone.utc)
_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def board(host):
    return {'host': host, 'name': host, 'search_url': f'https://{host}/jobs?q={{role}}'}


def kept():
    return {'old.test': {'name': 'old.test', 'last_read': (NOW - timedelta(hours=2)).isoformat(), 'state': 'ok'},
            'stale.test': {'name': 'stale.test', 'last_read': (NOW - timedelta(hours=8)).isoformat(), 'state': 'ok'}}


def lines(call):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        result = call()
    return result, out.getvalue()


class BoardsRestOneByOne(unittest.TestCase):
    def test_only_boards_read_since_are_skipped(self):
        boards = [board('old.test'), board('stale.test'), board('aviation.test')]
        fresh, said = lines(lambda: board_yield.not_read_since(boards, kept(), NOW - timedelta(hours=aggregators.SPACING_HOURS)))
        self.assertEqual([b['host'] for b in fresh], ['stale.test', 'aviation.test'])
        self.assertIn('Job boards: 1 read in the last 6 h skipped; reading 2 new ones', said)
        self.assertEqual(board_yield.not_read_since(boards, kept(), None), boards, 'outside the rest: every board')

    def test_the_scan_reads_new_boards_within_the_rest(self):
        db, asked = sqlite3.connect(':memory:'), []
        aggregators.mark_read(db, boards_ahead.NAME, NOW - timedelta(minutes=37), PILOT)
        aggregators.mark_read(db, 'Arbeitnow', NOW - timedelta(minutes=37), PILOT)
        reader = lambda search, since=None: asked.append(since) or []
        free_api = lambda search: self.fail('a free job API still rests 6 hours')
        aggregators.scan(db, PILOT, now=NOW, readers=[('Arbeitnow', free_api), (boards_ahead.NAME, reader)])
        self.assertEqual(asked, [NOW - timedelta(hours=aggregators.SPACING_HOURS)], 'the old code read no board at all here')

    def test_the_read_beside_the_employer_sites_starts_within_the_rest(self):
        db, asked = sqlite3.connect(':memory:'), []
        aggregators.mark_read(db, boards_ahead.NAME, NOW - timedelta(minutes=37), PILOT)
        reader = lambda search, since=None: asked.append(since) or []
        with mock.patch.object(aggregators, 'sources', return_value=[(boards_ahead.NAME, reader)]), \
                mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': ''}):
            ahead = boards_ahead.start(db, PILOT, now=NOW)
            self.assertIsNotNone(ahead, 'the old code returned None: no board read, so the early web search was never finished')
            ahead.wait()
        self.assertEqual(asked, [NOW - timedelta(hours=aggregators.SPACING_HOURS)])

    def test_the_read_skips_only_boards_read_since(self):
        data, read = {'boards': kept()}, []
        def read_board(one, *args, **kwargs):
            read.append(one['host'])
            return [], 'browser', None
        with mock.patch('src.ai.board_ideas.load', return_value=data), mock.patch('src.ai.board_ideas.save'), \
                mock.patch.object(found_boards, 'read_board', side_effect=read_board), mock.patch.object(board_web, 'start', return_value=None), \
                mock.patch.object(found_boards.board_employers, 'note'):
            lines(lambda: found_boards.read(PILOT, [board('old.test'), board('stale.test'), board('aviation.test')], fetch=lambda url: '',
                                            now=NOW, is_relevant=lambda jobs: [], dead=set(), since=NOW - timedelta(hours=6)))
        self.assertEqual(sorted(read), ['aviation.test', 'stale.test'])


class WebSearchSaysWhy(unittest.TestCase):
    def setUp(self):
        careers.READER = object()   # never used: the search stops before any page or model

    def tearDown(self):
        careers.READER = None

    def search(self, due=True, client=None):
        with mock.patch('src.ai.board_ideas.asked_for', return_value=('k', ['Austria'], ['first officer'], [], ['europe'])), \
                mock.patch.object(board_web, '_due', return_value=due), mock.patch.object(board_web, '_searcher', return_value=client), \
                mock.patch.object(board_web, 'disabled', return_value=False), mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': ''}):
            return lines(lambda: board_web.search(PILOT, [], now=NOW, data={'boards': {}}))

    def test_no_ai_that_searches_the_web_is_said(self):
        found, said = self.search()
        self.assertEqual(found, [])
        self.assertIn('Job boards: no web search: no AI here searches the web', said)

    def test_not_due_is_said(self):
        _, said = self.search(due=False)
        self.assertIn('Job boards: no web search: searched lately', said)

    def test_the_start_names_its_lane(self):
        with mock.patch('src.sources.web_search._claude_code', return_value=False), mock.patch('src.ai.engine.choice', return_value='api'), \
                mock.patch('src.ai.engine.ready', return_value=True), mock.patch('src.sources.web_search.free_ai', return_value=True), \
                mock.patch('src.ai.engine.client', return_value=object()):
            _, said = lines(board_web._searcher)
        self.assertIn("Job boards: searching the web for trade and local boards (Free AI's web search on the site)", said)


if __name__ == '__main__':
    unittest.main()
