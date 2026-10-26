"""A board's own section for the user's kind of work (src/sources/board_sections.py), opened when its home page gave no relevant job (24 Oct 2026:
a Moldovan board's home page was news and its IT section listed 100 jobs). Fixture shapes: a static section page, a hub of sections, a section built by scripts."""
import unittest
from unittest import mock

from src.sources import board_pages, board_sections, careers, found_boards

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


HOME = 'https://jobs.example/'
NAV = ('<a href="/stiri">Știri</a><a href="/angajatori">Angajatori</a><a href="/it">Tech și programare</a><a href="/vanzari">Vânzări</a>'
       '<a href="https://other.example/x">Partener</a><a href="/lucrari" >Toate joburile</a>')


def posting(n):
    return ('<script type="application/ld+json">{"@type":"JobPosting","title":"Software Engineer %d","hiringOrganization":{"name":"Acme"},'
            '"jobLocation":{"address":{"addressLocality":"Chișinău","addressCountry":"MD"}},"url":"https://jobs.example/job/%d"}</script>' % (n, n))


SECTION = '<html>' + ''.join(posting(n) for n in range(3)) + '</html>'
SHELL = '<html><body><div id="app"></div><script src="/app.js"></script></body></html>'


def decider(by_text):
    """A stand-in for the AI: the answer is chosen from the link text it is given (a language the code knows nothing of)."""
    def decide(topic, items, answers, instructions):
        return {key: by_text.get(text.split('\n')[0].removeprefix('Link text: '), 'other') for key, text in items.items()}
    return decide


def fetcher(pages):
    return lambda url: pages.get(url, '')


class PickTests(unittest.TestCase):
    def test_the_links_of_the_boards_own_site_only_one_per_path(self):
        found = board_sections.candidates(NAV + '<a href="/it?page=2">Tech</a>', HOME)
        self.assertEqual([text for _, text in found], ['Știri', 'Angajatori', 'Tech și programare', 'Vânzări', 'Toate joburile'])

    def test_the_ai_answer_picks_sections_and_hubs(self):
        decide = decider({'Tech și programare': 'best', 'Toate joburile': 'hub'})
        self.assertEqual(board_sections.pick(NAV, HOME, 'software engineer', decide), (['https://jobs.example/it'], ['https://jobs.example/lucrari']))


    def test_the_exact_field_comes_before_near_ones_whatever_the_page_order(self):
        """24 Oct 2026: the AI marked 21 of a board's fields as sections and the first two in page order (acquisitions, naval) were read, never IT."""
        decide = decider({'Știri': 'near', 'Angajatori': 'near', 'Vânzări': 'near', 'Tech și programare': 'best'})
        sections, _ = board_sections.pick(NAV, HOME, 'software engineer', decide)
        self.assertEqual(sections, ['https://jobs.example/it', 'https://jobs.example/stiri'])

    def test_no_ai_answer_picks_nothing(self):
        self.assertEqual(board_sections.pick(NAV, HOME, 'software engineer', lambda *a: None), ([], []))

    def test_the_cache_key_names_the_role_so_another_role_asks_again(self):
        seen = []
        board_sections.pick(NAV, HOME, 'nurse', lambda t, items, a, i: seen.append(list(items)) or {})
        self.assertTrue(all(key.startswith('nurse|') for key in seen[0]))


class ReadTests(unittest.TestCase):
    def read(self, pages, decide, home=NAV):
        with mock.patch.object(board_pages, 'PAUSE_S', 0):
            return board_sections.read(home, HOME, 'software engineer', fetcher(pages), decide, lambda jobs: jobs)

    def test_a_static_section_page_gives_its_jobs(self):
        jobs, url = self.read({'https://jobs.example/it': SECTION}, decider({'Tech și programare': 'best'}))
        self.assertEqual((len(jobs), url), (3, 'https://jobs.example/it'))

    def test_a_hub_is_opened_and_its_section_read(self):
        hub = '<a href="/it">Tech și programare</a><a href="/vanzari">Vânzări</a>'
        jobs, url = self.read({'https://jobs.example/lucrari': hub, 'https://jobs.example/it': SECTION},
                              decider({'Toate joburile': 'hub', 'Tech și programare': 'best'}))
        self.assertEqual((len(jobs), url), (3, 'https://jobs.example/it'))

    def test_a_hub_of_hubs_is_followed_down_to_the_section(self):
        """24 Oct 2026: a board's home page links its jobs page, which links its categories, which link the IT field."""
        jobs, url = self.read({'https://jobs.example/lucrari': '<a href="/categorii">Toate domeniile</a>', 'https://jobs.example/categorii': '<a href="/it">Tech și programare</a>',
                               'https://jobs.example/it': SECTION}, decider({'Toate joburile': 'hub', 'Toate domeniile': 'hub', 'Tech și programare': 'best'}))
        self.assertEqual((len(jobs), url), (3, 'https://jobs.example/it'))

    def test_a_section_of_job_cards_is_read_by_its_job_links_before_the_ai_reads_the_page(self):
        """24 Oct 2026, a Zagreb nurse: a board's health section listed ~35 cards linking single job pages; the AI page reader came first, saw the top of the
        page (12 items, one with the section's own address) and the job pages were never read. A page whose cards link job pages is read by those links."""
        cards = ''.join('<a href="/oglasi/medicinska-sestra-%d/%d/"><div class="title">Medicinska sestra %d</div></a>' % (n, 100000 + n, n) for n in range(6))
        pages = {'https://jobs.example/zdravlje': cards}
        pages.update({'https://jobs.example/oglasi/medicinska-sestra-%d/%d/' % (n, 100000 + n): posting(n) for n in range(6)})
        asked = []
        reader, careers.READER = careers.READER, lambda url, markup: asked.append(url) or [{'id': url, 'url': url, 'title': 'Section heading', 'location': '', 'employer': ''}]
        try:
            jobs, url = self.read(pages, decider({'Zdravlje': 'best'}), home='<a href="/zdravlje">Zdravlje</a>')
        finally:
            careers.READER = reader
        self.assertEqual((len(jobs), url, asked), (6, 'https://jobs.example/zdravlje', []))

    def test_a_section_built_by_scripts_gives_nothing_and_breaks_nothing(self):
        self.assertEqual(self.read({'https://jobs.example/it': SHELL}, decider({'Tech și programare': 'best'})), ([], None))

    def test_a_section_built_by_scripts_is_read_in_the_browser_and_marked(self):
        rendered, shown = [], []
        with mock.patch.object(board_pages, 'PAUSE_S', 0):
            jobs, url = board_sections.read(NAV, HOME, 'software engineer', fetcher({'https://jobs.example/it': SHELL}), decider({'Tech și programare': 'best'}),
                                            lambda jobs: jobs, show=lambda page: shown.append(page) or SECTION, rendered=rendered)
        self.assertEqual((len(jobs), url, rendered, shown), (3, 'https://jobs.example/it', ['https://jobs.example/it'], ['https://jobs.example/it']))

    def test_a_section_whose_plain_page_is_only_a_menu_of_job_words_is_read_in_the_browser_first(self):
        menu = '<a href="/jobs/by/remote/">Remote</a><a href="/jobs/by/part-time/">Part time</a><a href="/jobs/by/new/">New</a>'
        cards = ''.join(f'<a href="/job/engineer-{n}/1{n}345/">Engineer {n}</a>' for n in range(4))

        def show(page):
            return cards
        with mock.patch.object(board_pages, 'PAUSE_S', 0):
            plain_menu = fetcher({'https://jobs.example/it': menu})
            plain_cards = fetcher({'https://jobs.example/it': cards})
            self.assertEqual(board_sections._ways('https://jobs.example/it', plain_menu, show), (show, plain_menu))
            self.assertEqual(board_sections._ways('https://jobs.example/it', plain_cards, show), (plain_cards, show))
            self.assertEqual(board_sections._ways('https://jobs.example/it', plain_cards, None), (plain_cards,))

    def test_a_static_section_does_not_open_the_browser(self):
        shown, rendered = [], []
        with mock.patch.object(board_pages, 'PAUSE_S', 0):
            board_sections.read(NAV, HOME, 'software engineer', fetcher({'https://jobs.example/it': SECTION}), decider({'Tech și programare': 'best'}),
                                lambda jobs: jobs, show=lambda page: shown.append(page) or SHELL, rendered=rendered)
        self.assertEqual((shown, rendered), ([], []))

    def test_a_section_is_read_whatever_robots_txt_says(self):
        pages = {'https://jobs.example/robots.txt': 'User-agent: *\nDisallow: /', 'https://jobs.example/it': SECTION}
        asked = []
        def fetch(url):
            asked.append(url)
            return pages[url]
        board_sections.read(NAV, HOME, 'x', fetch, decider({'Tech și programare': 'best'}), lambda jobs: jobs)
        self.assertIn('https://jobs.example/it', asked)


class WiredTests(unittest.TestCase):
    def test_another_way_reads_the_section_when_the_proposed_link_gave_nothing(self):
        board = {'name': 'Example', 'host': 'jobs.example', 'search_url': HOME + 'q?w={role}'}
        search = {'jobs_board_search_queries': 'software engineer'}
        careers.READER = 'auto'
        try:
            with mock.patch('src.ai.decide.decide', decider({'Tech și programare': 'best'})):
                entry = {}
                jobs, state, relevant = found_boards._another_way(board, entry, board['search_url'], search, fetcher({HOME: NAV, HOME + 'it': SECTION}),
                                                                  lambda found: found, ([], 'empty', []))
        finally:
            careers.READER = None
        self.assertEqual((len(jobs), state, entry['search_url']), (3, 'ok', HOME + 'it'))

    def test_a_list_with_few_relevant_jobs_gives_way_to_a_section_with_more(self):
        board = {'name': 'Example', 'host': 'jobs.example', 'search_url': HOME + 'q?w={role}'}
        search = {'jobs_board_search_queries': 'software engineer'}
        before = ([{'title': 'a'}], 'ok', [{'title': 'a'}])
        careers.READER = 'auto'
        try:
            with mock.patch('src.ai.decide.decide', decider({'Tech și programare': 'best'})):
                entry = {}
                got = found_boards._fuller_section(board, entry, board['search_url'], search, fetcher({HOME: NAV, HOME + 'it': SECTION}), lambda found: found, before)
                none = found_boards._fuller_section(board, {}, board['search_url'], search, fetcher({HOME: NAV}), lambda found: found, before)
        finally:
            careers.READER = None
        self.assertEqual((len(got[0]), got[1], entry['search_url'], entry['few_for']), (3, 'ok', HOME + 'it', board['search_url'] + '|' + str(found_boards.LADDER)))
        self.assertEqual(none, before, 'a section that gives no more keeps the list the board gave')


class OwnCountryTests(unittest.TestCase):
    def test_a_general_board_proposed_for_one_country_places_the_jobs_that_name_no_place(self):
        found = [{'id': '1', 'url': 'https://a.example/1', 'title': 'Dev', 'location': ''}, {'id': '2', 'url': 'https://a.example/2', 'title': 'Dev', 'location': 'Bălți'}]
        board = {'name': 'A', 'host': 'a.example', 'countries': ['Moldova'], 'source_kind': 'general'}
        self.assertEqual([job['location'] for job in found_boards._shaped(board, found)], ['Moldova', 'Bălți'])

    def test_a_sector_or_multi_country_board_does_not_invent_a_place(self):
        found = [{'id': '1', 'url': 'https://a.example/1', 'title': 'Dev', 'location': ''}]
        for board in ({'countries': ['Moldova'], 'source_kind': 'sector'}, {'countries': ['Moldova', 'Ukraine'], 'source_kind': 'general'}, {'source_kind': 'general'}):
            with self.subTest(board=board):
                self.assertEqual(found_boards._shaped({'name': 'A', 'host': 'a.example', **board}, found)[0]['location'], '')


class RetryTests(unittest.TestCase):
    def test_a_board_with_nothing_relevant_is_tried_again_when_the_title_time_was_spent(self):
        for over, relevant, kept in ((True, [], False), (False, [], True), (True, [{'title': 'Dev'}], True)):
            with self.subTest(over=over, relevant=bool(relevant)), mock.patch('src.time_budget.over', return_value=over):
                entry = {'form_for': 'https://a.example/q?w={role}'}
                found_boards._retry_when_unjudged(entry, relevant)
                self.assertEqual('form_for' in entry, kept)

    def test_a_board_whose_ai_call_failed_is_tried_again_too(self):
        """Check #10 (24 Oct 2026), Rabota: the link pick failed (CliError), nothing was relevant, and the board was marked tried for good."""
        for failed, relevant, kept in ((True, [], False), (False, [], True), (True, [{'title': 'Dev'}], True)):
            with self.subTest(failed=failed, relevant=bool(relevant)), mock.patch('src.time_budget.over', return_value=False):
                entry = {'form_for': 'https://a.example/q?w={role}'}
                found_boards._retry_when_unjudged(entry, relevant, failed)
                self.assertEqual('form_for' in entry, kept)

    def test_a_board_that_went_up_an_older_ladder_goes_up_the_new_one_once(self):
        link = 'https://a.example/q?w={role}'
        for entry, went in (({'form_for': link, 'ladder': found_boards.LADDER}, True), ({'form_for': link}, False), ({'form_for': link, 'ladder': 1}, False),
                            ({'form_for': 'https://a.example/other', 'ladder': found_boards.LADDER}, False), ({}, False)):
            with self.subTest(entry=entry):
                self.assertEqual(found_boards._went_up(entry, link), went)


if __name__ == '__main__':
    unittest.main()
