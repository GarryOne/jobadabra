"""The AI judges each board the web search found, from the page it was found as, for THIS search's field, before it joins the list (owner's
yes, 26 Oct 2026, discovery sketch "AI judges the page"): on a copy of his First Officer search the web search's "trade boards" included a
recruiter, a news site's search page and boards that gave nothing. One fixed answer (src/sources/board_check.py field_kind): a field board is
marked 'sector'; a general board stays only with a keyword search page; one employer's site or anything else is left out; no answer: the
board stands. Fake AI client, fake pages and a fake judge only."""
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src.ai import board_ideas
from src.sources import board_check, board_web, careers

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def found(name, url, source_kind='sector'):
    return {'name': name, 'search_url': url, 'countries': ['Germany'], 'kinds': ['aviation_transport'], 'source_kind': source_kind}


ANSWER = [found('Crew Careers', 'https://crew-careers.example/site/en/job/list/category/1-flight-crew'),
          found('Every Job', 'https://every-job.example/jobs/all'),          # a general portal the search called a trade board
          found('Any Search', 'https://any-search.example/?q={role}'),       # a general portal with a keyword search
          found('An Airline', 'https://an-airline.example/careers'),
          found('Aviation News', 'https://aviation-news.example/search?q={role}'),
          found('Quiet Board', 'https://quiet.example/pilot-jobs')]          # the AI gives no answer for it
PAGES = {'https://crew-careers.example/site/en/job/list/category/1-flight-crew': '<title>Crew Careers</title><a>First Officer A320</a>',
         'https://every-job.example/jobs/all': '<title>Every Job</title><a>Nurse</a><a>Driver</a>',
         'https://any-search.example/': '<title>Any Search</title>', 'https://an-airline.example/careers': '<title>An Airline careers</title>',
         'https://aviation-news.example/': '<title>Aviation News</title>', 'https://quiet.example/pilot-jobs': '<title>Quiet</title>'}
KINDS = {'crew-careers.example': 'field board', 'every-job.example': 'job board', 'any-search.example': 'job board',
         'an-airline.example': 'one employer', 'aviation-news.example': 'other'}


class Client:
    def __init__(self, boards):
        self.boards, self.messages = boards, self

    def create(self, **kw):
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'boards': self.boards}))],
                               usage=SimpleNamespace(input_tokens=1, output_tokens=1), stop_reason='end_turn')


class PageJudge(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.ai.cost.side'), mock.patch('src.time_budget.BEGAN', None),
                      mock.patch.object(board_ideas, 'asked_for', return_value=('k1', ['Germany'], ['first officer', 'pilot'], [], ['Berlin']))):
            patch.start()
            self.addCleanup(patch.stop)
        board_ideas.save({'ideas': {'k1': []}, 'boards': {}})
        self.asked = []

    def ask(self, topic, key, text, answers, instructions):
        self.asked.append((topic, key, text, answers))
        return KINDS.get(key)

    def search(self):
        real = board_check.field_kind
        out = io.StringIO()
        with mock.patch.object(careers, 'READER', 'auto'), redirect_stdout(out), \
                mock.patch.object(board_check, 'field_kind', lambda board, fetch, roles: real(board, fetch, roles, ask=self.ask)):
            kept = board_web.search({'role_keywords': ['first officer']}, [], client=Client(ANSWER), fetch=lambda url: PAGES.get(url, ''))
        return kept, out.getvalue()

    def test_only_job_boards_join_and_a_field_board_is_marked_as_one(self):
        kept, said = self.search()
        self.assertEqual([(board['host'], board['source_kind']) for board in kept],
                         [('crew-careers.example', 'sector'), ('any-search.example', 'general'), ('quiet.example', 'sector')],
                         'a field board: sector; a general board with a keyword search: general; no answer: as the search gave it')
        self.assertIn('Every Job lists every kind of job, with no search by words: left out', said)
        self.assertIn("An Airline is one employer's own site: left out", said)
        self.assertIn('Aviation News is not a job board: left out', said)
        self.assertEqual([board['host'] for board in board_ideas.load()['ideas']['k1']], [board['host'] for board in kept])

    def test_the_ai_judges_the_page_the_board_was_found_as_for_this_search_s_roles(self):
        self.search()
        sent = {key: text for _, key, text, _ in self.asked}
        self.assertIn('First Officer A320', sent['crew-careers.example'], 'the category page itself, not the home page')
        self.assertIn('Any Search', sent['any-search.example'], "a search template: its home page")
        self.assertTrue(all(text.startswith('Looking for work as: first officer, pilot') for text in sent.values()))
        self.assertEqual({answers for *_, answers in self.asked}, {board_check.FIELD_KINDS})

    def test_nothing_is_judged_while_the_page_reader_is_off(self):
        self.assertIsNone(board_check.field_kind(board_ideas.valid(ANSWER[0]), lambda url: PAGES[url], ['pilot'], ask=self.ask))
        self.assertEqual(self.asked, [])


if __name__ == '__main__':
    unittest.main()
