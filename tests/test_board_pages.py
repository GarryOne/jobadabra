"""A board's search results read past page 1 (src/sources/board_pages.py): the page's own next link or numbered pages, while each page still
gives a new relevant job, at most MAX_PAGES, within robots.txt; a refusal ends the paging and keeps what was read. 18 Oct 2026: StepStone
listed 148 truck-driver jobs in Nuremberg over 11 pages and the board read took 3 from page 1."""
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import board_pages, careers, found_boards  # noqa: E402

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'jobs_board_search_queries': ['fahrer'], 'role_keywords': ['fahrer'],
          'locations': {'top_tier': ['Nürnberg'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Stellen', 'host': 'stellen.example', 'search_url': 'https://stellen.example/jobs/{role}', 'countries': ['Germany'], 'kinds': ['any']}
FIRST = 'https://stellen.example/jobs/fahrer'


def _page(number, titles, nav=''):
    jobs = [{'@context': 'https://schema.org', '@type': 'JobPosting', 'title': title, 'url': f'https://stellen.example/job/{number}-{i}',
             'hiringOrganization': {'@type': 'Organization', 'name': 'Spedition'},
             'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Nürnberg', 'addressCountry': 'DE'}}} for i, title in enumerate(titles)]
    data = ''.join(f'<script type="application/ld+json">{json.dumps(job)}</script>' for job in jobs)
    return f'<html><head>{nav}</head><body>{data}</body></html>'


def _numbered(count, titles=('LKW Fahrer',), robots=''):
    """A board of `count` result pages linked as ?page=N, each page with these titles; robots.txt as given."""
    def url(n):
        return FIRST if n == 1 else f'{FIRST}?page={n}'
    nav = ''.join(f'<a href="{url(n)}">{n}</a>' for n in range(1, count + 1))
    pages = {url(n): _page(n, titles, nav) for n in range(1, count + 1)}
    pages['https://stellen.example/robots.txt'] = robots
    return pages


def relevant(jobs):   # the role and place judges, without the AI triage
    return [job for job in jobs if 'fahrer' in job['title'].lower()]


class BoardPagesTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}),
                      mock.patch.object(board_pages, 'PAUSE_S', 0), mock.patch('src.sources.board_yield.is_relevant', relevant)):
            patch.start()
            self.addCleanup(patch.stop)

    def _read(self, pages, early=False):
        asked = []

        def fetch(url):
            asked.append(url)
            if url not in pages:
                raise urllib.error.HTTPError(url, 404, 'Not Found', None, None)
            if isinstance(pages[url], Exception):
                raise pages[url]
            return pages[url]
        jobs, state, _ = found_boards.read_board(BOARD, SEARCH, fetch=fetch, early=early)
        return jobs, state, [url for url in asked if not url.endswith('robots.txt')]

    def test_the_numbered_pages_are_read_up_to_the_cap(self):
        jobs, state, asked = self._read(_numbered(9))
        self.assertEqual(state, 'ok')
        self.assertEqual(len(asked), board_pages.MAX_PAGES)
        self.assertEqual(len(jobs), board_pages.MAX_PAGES)

    def test_a_next_link_is_followed_page_after_page(self):
        pages = {FIRST: _page(1, ['LKW Fahrer'], '<link rel="next" href="/jobs/fahrer/2">'),
                 'https://stellen.example/jobs/fahrer/2': _page(2, ['CE Fahrer'], '<link rel="next" href="/jobs/fahrer/3">'),
                 'https://stellen.example/jobs/fahrer/3': _page(3, ['Kraftfahrer'])}
        jobs, _, asked = self._read(pages)
        self.assertEqual(len(asked), 3)
        self.assertEqual(len(jobs), 3)

    def test_paging_stops_after_a_page_with_no_new_relevant_job(self):
        pages = _numbered(5)
        pages[f'{FIRST}?page=2'] = _page(2, ['Pflegefachfrau'], ''.join(f'<a href="{FIRST}?page={n}">{n}</a>' for n in range(1, 6)))
        _, _, asked = self._read(pages)
        self.assertEqual(asked, [FIRST, f'{FIRST}?page=2'])

    def test_a_first_page_with_no_relevant_job_is_not_paged(self):
        _, _, asked = self._read(_numbered(5, titles=('Pflegefachfrau',)))
        self.assertEqual(asked, [FIRST])

    def test_robots_that_disallow_the_pages_do_not_stop_the_paging(self):
        _, _, asked = self._read(_numbered(5, robots='User-agent: *\nDisallow: /'))
        self.assertGreater(len(asked), 1)

    def test_a_refusal_on_page_two_keeps_page_one_and_the_board(self):
        pages = _numbered(5)
        pages[f'{FIRST}?page=2'] = urllib.error.HTTPError(f'{FIRST}?page=2', 429, 'Too Many Requests', None, None)
        jobs, state, asked = self._read(pages)
        self.assertEqual((len(jobs), state), (1, 'ok'))
        self.assertEqual(asked, [FIRST, f'{FIRST}?page=2'])

    def test_a_next_link_to_another_site_is_not_followed(self):
        pages = {FIRST: _page(1, ['LKW Fahrer'], '<link rel="next" href="https://elsewhere.example/jobs/2">')}
        _, _, asked = self._read(pages)
        self.assertEqual(asked, [FIRST])

    def test_a_next_link_with_raw_spaces_is_asked_encoded(self):
        """18 Oct 2026: a board's next link carried '?q=senior financial analyst&page=2'; the request raised InvalidURL and the read died."""
        raw = f'{FIRST}?q=lkw fahrer&page=2'
        pages = {FIRST: _page(1, ['LKW Fahrer'], f'<link rel="next" href="{raw}">'), f'{FIRST}?q=lkw%20fahrer&page=2': _page(2, ['CE Fahrer'])}
        jobs, _, asked = self._read(pages)
        self.assertEqual(asked, [FIRST, f'{FIRST}?q=lkw%20fahrer&page=2'])
        self.assertEqual(len(jobs), 2)

    def test_any_error_on_a_later_page_ends_the_paging_and_keeps_the_board(self):
        import http.client
        pages = _numbered(5)
        pages[f'{FIRST}?page=2'] = http.client.InvalidURL('control characters')
        jobs, state, _ = self._read(pages)
        self.assertEqual((len(jobs), state), (1, 'ok'))

    def test_the_first_jobs_slice_reads_page_one_only(self):
        _, _, asked = self._read(_numbered(5), early=True)
        self.assertEqual(asked, [FIRST])


if __name__ == '__main__':
    unittest.main()
