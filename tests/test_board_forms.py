"""A job board's own search link from the search form on its home page (src/sources/board_forms.py), tried when the proposed link gave no
relevant job: kept and used from then on when it gives relevant ones (18 Oct 2026: a finance search's boards ignored the guessed links and
listed warehouse jobs, or German student jobs, for "financial analyst" in Amsterdam)."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.sources import board_forms, board_pages, careers, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


HOME = 'https://vacatures.example/'


def form(body, action='/zoeken', method='get'):
    return f'<html><body><form action="{action}" method="{method}">{body}<button>Zoek</button></form></body></html>'


class TemplateTests(unittest.TestCase):
    def test_a_get_form_with_two_text_boxes_gives_role_and_place(self):
        page = form('<input name="wat" type="text"><input name="waar"><input type="hidden" name="lang" value="nl">')
        self.assertEqual(board_forms.templates(page, HOME), ['https://vacatures.example/zoeken?lang=nl&wat={role}&waar={place}'])

    def test_one_text_box_gives_the_role_only(self):
        self.assertEqual(board_forms.templates(form('<input type="search" name="q">'), HOME), ['https://vacatures.example/zoeken?q={role}'])

    def test_a_form_that_posts_or_asks_a_password_is_never_used(self):
        self.assertEqual(board_forms.templates(form('<input name="q">', method='post'), HOME), [])
        self.assertEqual(board_forms.templates(form('<input name="user"><input type="password" name="pw">'), HOME), [])

    def test_a_form_that_sends_to_another_site_is_left_alone(self):
        self.assertEqual(board_forms.templates(form('<input name="q">', action='https://elsewhere.example/s'), HOME), [])

    def test_a_subdomain_of_the_board_is_its_own(self):
        self.assertEqual(board_forms.templates(form('<input name="q">', action='https://www.vacatures.example/s'), HOME),
                         ['https://www.vacatures.example/s?q={role}'])

    def test_an_action_with_its_own_query_keeps_it(self):
        self.assertEqual(board_forms.templates(form('<input name="q">', action='/s?src=home'), HOME), ['https://vacatures.example/s?src=home&q={role}'])

    def test_a_page_with_no_form_gives_nothing(self):
        self.assertEqual(board_forms.templates('<html><body><a href="/x">Jobs</a></body></html>', HOME), [])


GUESSED = 'https://vacatures.example/vacatures?q={role}&location={place}'
LEARNED = 'https://vacatures.example/zoeken?wat={role}&waar={place}'
SEARCH = {'jobs_board_search_queries': ['financial analyst'], 'role_keywords': ['financial analyst'],
          'locations': {'top_tier': ['amsterdam'], 'country_wide': [], 'abroad': []}}
BOARD = {'name': 'Vacatures', 'host': 'vacatures.example', 'search_url': GUESSED, 'countries': ['Netherlands'], 'kinds': ['any']}


def posting(title, n):
    job = {'@context': 'https://schema.org', '@type': 'JobPosting', 'title': title, 'url': f'https://vacatures.example/v/{n}',
           'hiringOrganization': {'@type': 'Organization', 'name': 'Acme'},
           'jobLocation': {'@type': 'Place', 'address': {'addressLocality': 'Amsterdam', 'addressCountry': 'NL'}}}
    return f'<html><script type="application/ld+json">{json.dumps(job)}</script><body>x</body></html>'


class LearnedLinkTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={})):
            patch.start()
            self.addCleanup(patch.stop)
        self.asked = []
        self.robots = ''

    def fetch(self, url):
        self.asked.append(url)
        if url.endswith('/robots.txt'):
            return self.robots
        if url == HOME:
            return form('<input name="wat"><input name="waar">')
        if url.startswith('https://vacatures.example/zoeken?'):
            return posting('Financial Analyst', 1)
        return posting('Magazijnmedewerker', 2)   # the guessed link: the board ignores its words

    def read(self):
        relevant = lambda jobs: [job for job in jobs if 'Financial' in job['title']]
        return found_boards.read(SEARCH, [BOARD], fetch=self.fetch, is_relevant=relevant, dead=set())

    def test_a_board_that_ignores_the_guessed_link_is_read_through_its_own_form_and_keeps_it(self):
        jobs = self.read()
        self.assertEqual([job['title'] for job in jobs], ['Financial Analyst'])
        from src.ai import board_ideas
        entry = board_ideas.load()['boards']['vacatures.example']
        self.assertEqual((entry['search_url'], entry['relevant']), (LEARNED, 1), 'kept: the pool share sends it (src/contribute.py)')
        self.asked.clear()
        with mock.patch.object(found_boards, '_retry_due', return_value=True), mock.patch.object(found_boards.board_yield, 'pick', lambda boards, *a, **k: boards):
            self.read()
        self.assertTrue(self.asked and self.asked[0].startswith('https://vacatures.example/zoeken?'), self.asked)
        self.assertNotIn(HOME, self.asked, 'learned once: the home page is not read again')

    def test_robots_txt_that_disallows_the_form_link_does_not_stop_it(self):
        self.robots = 'User-agent: *\nDisallow: /zoeken'
        self.read()
        self.assertIn('https://vacatures.example/zoeken?wat=financial+analyst&waar=amsterdam', self.asked)

    def test_a_board_with_no_form_is_checked_once_for_this_link(self):
        home = []
        def fetch(url):
            home.append(url) if url == HOME else None
            return '<html><body>none</body></html>' if url == HOME else posting('Magazijnmedewerker', 2)
        self.fetch = fetch
        with mock.patch.object(found_boards, '_retry_due', return_value=True), mock.patch.object(found_boards.board_yield, 'pick', lambda boards, *a, **k: boards):
            self.read()
            self.read()
        self.assertEqual(home, [HOME])

    def test_with_no_form_the_board_s_own_job_sitemap_is_read_and_kept_as_its_route(self):
        """18 Oct 2026: Randstad listed warehouse jobs for "financial analyst" in Amsterdam; its robots.txt names a job sitemap."""
        sitemap = ('<urlset><url><loc>https://vacatures.example/vaga/26051177-magazijnmedewerker</loc></url>'
                   '<url><loc>https://vacatures.example/vaga/26051178-financial-analyst</loc></url></urlset>')
        def fetch(url):
            self.asked.append(url)
            pages = {HOME: '<html><body>no form here</body></html>', 'https://vacatures.example/robots.txt': 'Sitemap: https://vacatures.example/jobs.xml',
                     'https://vacatures.example/jobs.xml': sitemap, 'https://vacatures.example/vaga/26051178-financial-analyst': posting('Financial Analyst', 78)}
            return pages.get(url, posting('Magazijnmedewerker', 2))
        self.fetch = fetch
        self.assertEqual([job['title'] for job in self.read() if 'Financial' in job['title']], ['Financial Analyst'])
        from src.ai import board_ideas
        entry = board_ideas.load()['boards']['vacatures.example']
        self.assertEqual((entry['route_kind'], entry['relevant'], entry['search_url']), ('sitemap', 1, GUESSED))
        self.asked.clear()
        with mock.patch.object(found_boards, '_retry_due', return_value=True), mock.patch.object(found_boards.board_yield, 'pick', lambda boards, *a, **k: boards):
            self.read()
        self.assertEqual(self.asked[0], 'https://vacatures.example/jobs.xml', 'its route is read first from then on')
        self.assertNotIn(HOME, self.asked)

    def test_a_job_list_that_refuses_us_leaves_the_board_readable(self):
        import urllib.error
        def fetch(url):
            if url == 'https://vacatures.example/robots.txt':
                return 'Sitemap: https://vacatures.example/jobs.xml'
            if url == 'https://vacatures.example/jobs.xml':
                raise urllib.error.HTTPError(url, 403, 'Forbidden', None, None)
            return '<html><body>no form</body></html>' if url == HOME else posting('Magazijnmedewerker', 2)
        self.fetch = fetch
        self.read()
        from src.ai import board_ideas
        entry = board_ideas.load()['boards']['vacatures.example']
        self.assertEqual((entry['state'], entry.get('route')), ('ok', None), 'the search page still answers: not marked for a visit')

    def _behind_a_refusal(self, answer):
        """The guessed link is a 404; the board's own search form is refused: the board ends as a visit, not as "0 jobs"."""
        import urllib.error

        def fetch(url):
            if url.endswith('/robots.txt'):
                return ''
            if url == HOME:
                return form('<input name="wat"><input name="waar">')
            if url.startswith('https://vacatures.example/zoeken?'):
                return answer(url)
            raise urllib.error.HTTPError(url, 404, 'Not Found', None, None)
        self.fetch = fetch
        self.read()
        from src.ai import board_ideas
        self.assertEqual(board_ideas.load()['boards']['vacatures.example']['state'], 'browser')

    def test_a_search_form_behind_a_bot_check_page_is_offered_as_a_visit_not_read_as_empty(self):
        """24 Oct 2026: a Luxembourg board's guessed link was a 404 and its own search form answered a "Challenge Validation" page: the ladder
        dropped that and the board showed "0 jobs" instead of "only your browser reads it". Every way up the ladder that is refused counts."""
        self._behind_a_refusal(lambda url: '<html><head><title>Challenge Validation</title><script src="/c.js"></script></head><body><iframe src="/c"></iframe></body></html>')

    def test_a_search_form_that_answers_403_is_offered_as_a_visit_not_read_as_empty(self):
        import urllib.error

        def forbidden(url):
            raise urllib.error.HTTPError(url, 403, 'Forbidden', None, None)
        self._behind_a_refusal(forbidden)

    def test_the_first_jobs_slice_never_reads_a_form(self):
        relevant = lambda jobs: [job for job in jobs if 'Financial' in job['title']]
        found_boards.read(SEARCH, [BOARD], fetch=self.fetch, is_relevant=relevant, dead=set(), early=True)
        self.assertNotIn(HOME, self.asked)


if __name__ == '__main__':
    unittest.main()
