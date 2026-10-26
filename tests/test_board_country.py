"""A national job board whose list shows no places still counts in its country (owner, 26 Oct 2026, "AI names the board's country"): run
40362783223 read posao.hr's 40 Croatian jobs by rules, none with a place (it is only on each job's page), so the board pass scored it 0 and no
board ever became a fact. The AI names the country whose jobs the board lists (src/sources/board_check.py lists_country); place-less jobs count
there only when it answers 'this country'. Fake reads and a fake AI only."""
import sqlite3
import unittest
from unittest import mock

from src import scout_boards, scout_cells
from src.sources import board_check, careers

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def board(host):
    return {'name': host, 'host': host, 'search_url': f'https://{host}/search?q={{role}}', 'countries': ['Moldova'], 'kinds': ['any'], 'source_kind': 'general'}


def jobs(n, place=''):
    return [{'title': f'Vânzător {i}', 'location': place, 'url': f'https://x/{i}'} for i in range(n)]


class BoardCountry(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        scout_cells.keep(self.db, [{'countries': [c]} for c in scout_cells.EUROPE if c != 'md' for _ in range(5)])   # Moldova: the thinnest
        for patch in (mock.patch.object(scout_boards.pool_tags, 'countries', lambda texts: ['md'] if any('Chi' in t for t in texts) else []),
                      mock.patch.object(scout_boards.pool_tags, 'families', lambda titles: ['sales_retail'] if titles else [])):
            patch.start()
            self.addCleanup(patch.stop)
        self.asked = []

    def run_pass(self, reads, says):
        out = []

        def country_of(item, country):
            self.asked.append((item['host'], country))
            return says.get(item['host'])
        got = scout_boards.run(self.db, ideas=lambda search: [board(host) for host in reads], read_board=lambda item, *a: reads[item['host']],
                               out=out.append, google=lambda *a: [], country_of=country_of)
        return got, out[-1]

    def test_place_less_jobs_count_on_a_board_the_ai_names_as_this_country_s(self):
        got, said = self.run_pass({'national.md': (jobs(40), 'ok', None), 'everywhere.example': (jobs(40), 'ok', None),
                                   'unknown.example': (jobs(40), 'ok', None)},
                                  {'national.md': 'this country', 'everywhere.example': 'several countries or remote'})
        self.assertEqual([(fact['host'], fact['local_jobs']) for fact in got], [('national.md', 40)])
        self.assertIn('national.md 40/40 (no places; the AI: this country)', said)
        self.assertIn('everywhere.example 40/0', said, 'a board of many countries or remote jobs: its place-less jobs never count')
        self.assertIn('unknown.example 40/0', said, 'no answer: not counted on a guess')

    def test_the_ai_is_asked_only_when_place_less_jobs_could_decide_it(self):
        self.run_pass({'placed.md': (jobs(5, 'Chisinau'), 'ok', None), 'none.md': ([], 'empty', None), 'mixed.md': (jobs(2, 'Chisinau') + jobs(3), 'ok', None)},
                      {'mixed.md': 'this country'})
        self.assertEqual(self.asked, [('mixed.md', 'md')], 'enough placed jobs, or no jobs: no question')

    def test_the_question_names_the_country_and_has_fixed_answers(self):
        sent = []
        answer = board_check.lists_country(board('national.md'), lambda url: '<title>Posao</title><a>Prodavač</a>', 'Moldova',
                                           ask=lambda *question: sent.append(question) or 'this country')
        self.assertEqual(answer, 'this country')
        topic, key, text, answers, _ = sent[0]
        self.assertEqual((topic, key, answers), (board_check.COUNTRY_TOPIC, 'national.md', board_check.COUNTRY_ANSWERS))
        self.assertTrue(text.startswith('Country: Moldova\n') and 'Prodavač' in text)
        self.assertIsNone(board_check.lists_country(board('x.md'), lambda url: '', 'Moldova', ask=lambda *q: 'this country'), 'no page: unknown')

    def test_the_scout_asks_with_the_board_pass_s_own_allowance(self):
        asked = []
        with mock.patch('src.ai.decide.one', lambda *question, **options: asked.append(options) or 'this country'), \
                mock.patch('src.sources.careers.get_text', lambda url: '<title>Posao</title>'):
            self.assertEqual(scout_boards._country_of(board('national.md'), 'md'), 'this country')
        self.assertEqual(asked, [{'allowance': scout_boards.MAX_BOARDS}])


if __name__ == '__main__':
    unittest.main()
