"""A board's declared feed of news is not its job list (26 Oct 2026: a pilot board's search page showed no readable jobs, its RSS gave 10
articles, "Why should you work for Wizz Air UK?", kept as 10 jobs and as the board's route, so the page reader never read the page). A feed
becomes the route only with jobs the search wants; else the page reader reads the page. Fixture pages, no network, no model."""
import unittest
from unittest import mock

from src.sources import careers, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


SEARCH = {'role_keywords': ['first officer'], 'jobs_board_search_queries': ['first officer'], 'locations': {'top_tier': ['europe']}}
BOARD = {'name': 'crew.test', 'host': 'crew.test', 'search_url': 'https://crew.test/pilot-jobs?q={role}'}
HEAD = '<html><head><link rel="alternate" type="application/rss+xml" href="https://crew.test/feed"></head><body>'
SCRIPTS = HEAD + '<div id="jobs"></div><script>loadJobs()</script></body></html>'   # cards built by scripts
TEXT = HEAD + '<h1>Pilot jobs</h1>' + '<p>Airline, charter and business aviation jobs for pilots across Europe, by type rating and base.</p>' * 12 + '</body></html>'


def feed(titles):
    items = ''.join(f'<item><title>{t}</title><link>https://crew.test/news/{n}</link><description>{t}</description></item>' for n, t in enumerate(titles))
    return f'<?xml version="1.0"?><rss version="2.0"><channel><title>crew.test</title>{items}</channel></rss>'


NEWS = feed(['Why should you work for Example Air?', 'Crew roadshow in Dublin', 'Airline awards announced'])
JOBS = feed(['First Officer A320 (m/w/d)', 'First Officer B737 Vienna'])
wants = lambda jobs: [job for job in jobs if 'first officer' in job['title'].lower()]


class NewsFeedIsNotTheJobList(unittest.TestCase):
    def read(self, feed_text, page=TEXT):
        pages = {'https://crew.test/feed': feed_text}
        asked = []
        with mock.patch.object(careers, 'READER', object()), mock.patch.object(found_boards.board_yield, 'is_relevant', side_effect=wants), \
                mock.patch.object(careers, '_asked', side_effect=lambda url, page, jobs, fetch: asked.append(url) or []):
            jobs, state, route = found_boards.read_board(BOARD, SEARCH, lambda url: pages.get(url, page if 'pilot-jobs' in url else ''))
        return jobs, state, route, asked

    def test_a_news_feed_is_not_kept_and_the_page_reader_reads_the_page(self):
        jobs, state, route, asked = self.read(NEWS)
        self.assertIsNone(route, 'the news feed did not become the route')
        self.assertFalse(any('Example Air' in job['title'] for job in jobs), jobs)
        self.assertTrue(asked, 'the page reader was asked (the old code returned the 3 articles first)')

    def test_a_news_feed_beside_a_page_built_by_scripts_goes_to_the_browser_step(self):
        jobs, state, route, _ = self.read(NEWS, SCRIPTS)
        self.assertEqual((jobs, state, route), ([], 'browser', None), 'read by the headless browser or a visit, not as 3 articles')

    def test_a_job_feed_is_still_the_route(self):
        jobs, state, route, _ = self.read(JOBS)
        self.assertEqual((route or {}).get('kind'), 'feed')
        self.assertEqual([job['title'] for job in jobs], ['First Officer A320 (m/w/d)', 'First Officer B737 Vienna'])


if __name__ == '__main__':
    unittest.main()
