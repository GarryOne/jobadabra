"""A board of the user's field that lists its jobs by category, with no keyword search, is kept and read by its category page (owner's yes,
26 Oct 2026, discovery sketch decision 1: on a copy of his First Officer search, two pilot boards (one found by the web search) list their
jobs only as a category page, e.g. /site/en/job/list/category/1-flight-crew, so board_ideas.valid() dropped them for having no {role}).
Only a board the AI marked as a field board (source_kind 'sector') may come without {role}: its category page IS the field's list; a
general board's unfiltered list would be every job. A field board's home page is kept too: the read finds the field's section on it
(src/sources/board_sections.py). Fake AI client and fake pages only."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src.ai import board_ideas
from src.sources import board_web, careers, found_boards

CATEGORY = {'name': 'Crew Careers', 'search_url': 'https://crew-careers.example/site/en/job/list/category/1-flight-crew',
            'countries': ['Germany'], 'kinds': ['aviation_transport'], 'source_kind': 'sector'}
GENERAL_LIST = {**CATEGORY, 'name': 'All Jobs', 'search_url': 'https://all-jobs.example/jobs/all', 'source_kind': 'general'}
HOME = {**CATEGORY, 'name': 'Pilot Home', 'search_url': 'https://pilot-home.example/'}
GENERAL_HOME = {**HOME, 'name': 'Any Jobs', 'search_url': 'https://any-jobs.example/', 'source_kind': 'general'}
JOB = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': 'First Officer A320', 'url': 'https://crew-careers.example/job/1',
       'hiringOrganization': {'@type': 'Organization', 'name': 'An Airline'},
       'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Berlin', 'addressCountry': 'DE'}}, 'datePosted': '2026-10-24'}
LIST_PAGE = f'<html><script type="application/ld+json">{json.dumps(JOB)}</script><body>First Officer</body></html>'
NO_FORM = '<html><body><a href="/site/en/job/list/category/1-flight-crew">Flight crew</a></body></html>'
_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


class Client:
    def __init__(self, boards):
        self.boards, self.asked = boards, []
        self.messages = self

    def create(self, **kw):
        self.asked.append(kw)
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps({'boards': self.boards}))],
                               usage=SimpleNamespace(input_tokens=1, output_tokens=1), stop_reason='end_turn')


class CategoryPages(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.ai.cost.side'), mock.patch('src.places.load', return_value={}),
                      mock.patch('src.time_budget.BEGAN', None), mock.patch.object(careers, 'READER', None)):
            patch.start()
            self.addCleanup(patch.stop)

    def test_a_field_board_s_category_or_home_page_is_kept_but_not_a_general_board_s(self):
        kept = board_ideas.valid(CATEGORY)
        self.assertIsNotNone(kept, 'a field board that lists its jobs by category, with no keyword search: kept')
        self.assertEqual((kept['host'], kept['search_url'], kept['source_kind']),
                         ('crew-careers.example', CATEGORY['search_url'], 'sector'))
        self.assertIsNone(board_ideas.valid(GENERAL_LIST), "a general board's list without {role} is every job, not the field's")
        self.assertEqual(board_ideas.valid(HOME)['search_url'], 'https://pilot-home.example/', "a field board's home page: its section is found there")
        self.assertIsNone(board_ideas.valid(GENERAL_HOME), "a general board's home page is no search")
        self.assertIsNone(board_ideas.valid({**CATEGORY, 'search_url': 'http://crew-careers.example/site/en/job/list'}), 'https only')

    def test_the_ai_s_own_list_keeps_a_field_board_given_by_its_category_page(self):
        search = {'role_keywords': ['first officer'], 'locations': {'top_tier': ['Berlin'], 'country_wide': [], 'abroad': []}}
        with mock.patch('src.places.load', return_value={'berlin': {'kind': 'city', 'countries': ['Germany']}}):
            found = board_ideas.ideas(search, Client([CATEGORY, GENERAL_LIST, HOME, GENERAL_HOME]))
        self.assertEqual([board['host'] for board in found], ['crew-careers.example', 'pilot-home.example'])

    def test_the_web_search_keeps_a_field_board_seen_only_as_a_category_page(self):
        board_ideas.save({'ideas': {'k1': []}, 'boards': {}})
        client = Client([CATEGORY, GENERAL_HOME])
        with mock.patch.object(careers, 'READER', 'auto'), \
                mock.patch('src.sources.board_check.field_kind', return_value=None), \
                mock.patch.object(board_ideas, 'asked_for', return_value=('k1', ['Germany'], ['first officer'], [], ['Berlin'])):
            found = board_web.search({'role_keywords': ['first officer']}, [], client=client, fetch=lambda url: NO_FORM)
        self.assertEqual([(board['host'], board['search_url']) for board in found], [('crew-careers.example', CATEGORY['search_url'])],
                         "the category page is the address the search showed: kept; a general board's home page without a search form: dropped")
        self.assertEqual(board_ideas.load()['ideas']['k1'][0]['origin'], 'web')

    def test_a_category_page_is_read_once_not_once_per_search_word(self):
        search = {'jobs_board_search_queries': ['first officer', 'pilot', 'co-pilot', 'captain'],
                  'locations': {'top_tier': ['Berlin'], 'country_wide': [], 'abroad': []}}
        asked = []
        jobs, state, _ = found_boards.read_board(board_ideas.valid(CATEGORY), search, fetch=lambda url: asked.append(url) or LIST_PAGE)
        self.assertEqual(asked, [CATEGORY['search_url']], 'the same page for every word: fetched once')
        self.assertEqual((state, [job['title'] for job in jobs]), ('ok', ['First Officer A320']))


if __name__ == '__main__':
    unittest.main()
