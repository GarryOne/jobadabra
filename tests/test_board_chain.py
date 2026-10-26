"""The whole chain for a board whose home page is a list of fields (24 Oct 2026: three Chișinău runs found no job from a Moldovan board, one cause per
17-minute run): the AI picks the board's best field among many, its listing of slug-and-number cards is read through the JobPosting data of each job, the
jobs are located by a bare country code ("MD") and pass the real place check. One offline test, in seconds."""
import json
import re
import unittest
from unittest import mock

from src.sources import board_pages, careers, feeds, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = 'auto'


def tearDownModule():
    careers.READER = _READER


HOME = 'https://jobs.example/'
FIELDS = ['Achiziții', 'Aeronautic', 'Agricultură', 'Alimentație', 'IT, Programare', 'Imobiliare', 'Vânzări']
SLUGS = {name: re.sub(r'\W+', '-', name.lower()).strip('-') for name in FIELDS}
HOME_PAGE = '<html><body>' + 'Locuri de muncă în Moldova. ' * 40 + ''.join(f'<a href="/vacancies/category/{SLUGS[n]}">{n}</a>' for n in FIELDS) + '</body></html>'


def listing(field):
    cards = ''.join(f'<a href="/ro/locuri-de-munca/{SLUGS[field]}-{n}/{140000 + n}">Posting {n}</a>' for n in range(6))
    return '<html><body>' + 'Rezultate pentru domeniu. ' * 40 + cards + '</body></html>'


def job_page(number, title):
    posting = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': title, 'hiringOrganization': {'@type': 'Organization', 'name': 'Acme'},
               'jobLocation': {'@type': 'Place', 'address': {'@type': 'PostalAddress', 'addressCountry': 'MD'}}}
    return f'<html><script type="application/ld+json">{json.dumps(posting)}</script></html>'


def fetch(url):
    if url == HOME:
        return HOME_PAGE
    for field in FIELDS:
        if url.endswith('/category/' + SLUGS[field]):
            return listing(field)
    match = re.search(r'/(\d{6})$', url)
    return job_page(match.group(1), 'Python Developer ' + match.group(1)) if match else ''


def decide(topic, items, answers, instructions):
    """The AI stand-in: the IT field is the best match for a software engineer, a sales field is not."""
    return {key: 'best' if 'IT, Programare' in text else 'other' for key, text in items.items()}


class ChainTests(unittest.TestCase):
    def test_the_best_field_is_read_and_its_jobs_in_md_pass_the_place_check(self):
        read = []

        def seeing(url):
            read.append(url)
            return fetch(url)

        def judge(jobs):
            return [job for job in jobs if feeds.wanted_title(job['title']) and feeds.wanted_location(job)]
        board = {'name': 'Example', 'host': 'jobs.example', 'search_url': HOME + 'q?w={role}', 'countries': ['Moldova'], 'kinds': ['any']}
        search = {'jobs_board_search_queries': ['software engineer']}
        patches = (mock.patch('src.ai.decide.decide', decide),
                   mock.patch.object(feeds, 'PLACE', re.compile('moldova|chi.in', re.I)), mock.patch.object(feeds, 'place_of', return_value=None),
                   mock.patch.object(feeds, 'wanted_title', return_value=True))
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        entry = {}
        jobs, state, relevant = found_boards._another_way(board, entry, board['search_url'], search, seeing, judge, ([], 'empty', []))
        self.assertEqual((state, len(jobs), len(relevant)), ('ok', 6, 6), 'the six IT jobs, located MD, are all in the Moldova search')
        self.assertEqual({job['location'] for job in jobs}, {'Moldova'})
        self.assertTrue(any(url.endswith('/category/it-programare') for url in read))
        self.assertFalse(any('achizi' in url for url in read), 'no unrelated field is read')


if __name__ == '__main__':
    unittest.main()
