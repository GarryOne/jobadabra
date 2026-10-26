"""A board web search that left fewer than WANT working boards for THIS search searches again on the very next run, told what it found
before so it tries other words, up to TRIES times in a row, then weekly; boards kept for another search never count (owner via the
coordinator, 26 Oct 2026: his pilot run said "no web search: searched lately, its boards are kept" after the 01:45 search found 1 working
board). Fake AI client only (src/sources/board_web.py)."""
import io
import unittest
from contextlib import redirect_stdout
from datetime import timedelta
from unittest import mock

from src import places, role_kinds, time_budget
from src.ai import board_ideas
from src.sources import board_web
from tests.test_board_web import NOW, SEARCH, STAGE, Base, Client, board, setUpModule, tearDownModule  # noqa: F401 — page reader off


def kept(host, kind, relevant=4, source_kind='sector'):
    return {host: {'name': host, 'source_kind': source_kind, 'state': 'ok', 'relevant': relevant, 'search_url': f'https://{host}/?q={{role}}',
                   'kinds': [kind], 'paid_for': [kind], 'countries': ['Germany']}}


class ThinSearch(Base):
    def setUp(self):
        super().setUp()
        for patch in (mock.patch.object(role_kinds, 'of_search', return_value={'creative_media'}),
                      mock.patch.object(places, 'countries', return_value=['Germany'])):
            patch.start()
            self.addCleanup(patch.stop)

    def search(self, client, at, run=None):
        out = io.StringIO()   # run: the search clock's start (time_budget.BEGAN); None: no run clock, as in the other tests
        with redirect_stdout(out), mock.patch.object(time_budget, 'BEGAN', run):
            found = board_web.search(SEARCH, [board(1)], client=client, now=at)
        return found, out.getvalue()

    def test_a_thin_search_searches_again_on_the_next_run_with_what_it_found_then_weekly(self):
        client = Client([STAGE])
        self.search(client, NOW)
        self.assertNotIn('searched before', client.asked[0]['messages'][0]['content'], 'the first search has nothing before it')
        client.boards = []
        _, said = self.search(client, NOW + timedelta(hours=1))
        self.assertEqual(len(client.asked), 2, 'fewer than 2 working boards: the very next run searches again')
        sent = client.asked[1]['messages'][0]['content']
        self.assertIn('searched before', sent)
        self.assertIn('Bühnenjobs Berlin', sent, 'it is told the boards it found before, so it looks past them with other words')
        self.assertIn('searching the web again', said)
        self.assertIn(f'0 of {board_web.WANT}', said, 'the log says why it searches again')
        self.search(client, NOW + timedelta(hours=2))
        self.assertEqual(len(client.asked), board_web.TRIES)
        found, said = self.search(client, NOW + timedelta(hours=3))
        self.assertEqual((found, len(client.asked)), ([], board_web.TRIES), f'{board_web.TRIES} thin searches in a row: then weekly')
        self.assertIn('searched 2026-10-19T11:00', said, 'the rest names when it searched last')
        self.assertIn('next after 2026-10-26T11:00', said, 'and when it searches next')
        self.search(client, NOW + timedelta(hours=2, days=board_web.RECENT))
        self.assertEqual(len(client.asked), board_web.TRIES + 1)

    def test_one_run_searches_the_web_once_even_when_its_full_read_asks_again(self):
        """Live on a copy of the owner's state (26 Oct 2026): the first-jobs search at 53 s, then the full read searched again at 170 s
        ("try 2 of 3") in the same run: two of the three thin tries spent in one run."""
        client = Client([STAGE])
        self.search(client, NOW, run=1.0)
        _, said = self.search(client, NOW + timedelta(minutes=2), run=1.0)
        self.assertEqual(len(client.asked), 1, 'the same run never searches the web twice for one search')
        self.assertIn('Job boards: no web search: searched in this run', said)
        self.search(client, NOW + timedelta(minutes=30), run=1800.0)
        self.assertEqual(len(client.asked), 2, 'the next run searches again')

    def test_boards_that_work_for_this_search_rest_a_month_and_another_search_s_boards_never_count(self):
        data = {'web': {'k1': NOW.isoformat()}, 'web_thin': {'k1': 1}}
        two = {**kept('s1.example', 'creative_media'), **kept('s2.example', 'creative_media', source_kind='regional')}
        self.assertEqual(board_web._next_search(data, 'k1', two, SEARCH), NOW + timedelta(days=board_web.DAYS))
        software = {**kept('it1.example', 'software'), **kept('it2.example', 'software')}
        self.assertEqual(board_web._next_search(data, 'k1', software, SEARCH), NOW,
                         'two working software boards kept for an earlier search: this search is still thin')
        self.assertIsNone(board_web._next_search({}, 'k1', two, SEARCH), 'never searched: due now')
        self.assertTrue(board_web._due(data, 'k1', NOW, software, SEARCH))
        self.assertFalse(board_web._due(data, 'k1', NOW + timedelta(days=29), two, SEARCH))

    def test_a_search_that_left_working_boards_starts_its_thin_count_again(self):
        board_ideas.save({'ideas': {'k1': [board(1)]}, 'boards': {}, 'web': {'k1': NOW.isoformat()}, 'web_thin': {'k1': board_web.TRIES}})
        data = board_ideas.load()
        data['boards'] = {**kept('s1.example', 'creative_media'), **kept('s2.example', 'creative_media')}
        board_ideas.save(data)
        self.search(Client([]), NOW + timedelta(days=board_web.DAYS))
        self.assertEqual(board_ideas.load()['web_thin']['k1'], 0)


if __name__ == '__main__':
    unittest.main()
