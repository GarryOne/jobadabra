"""A job board built by scripts is read by the headless browser, and a board whose page rules read a menu gets one AI page read (owner,
19 Oct 2026: Arbeitsagentur, Kimeta and 3 more of the 10 boards most often unreadable are script-built; a music board's menu was read as
30 jobs). src/sources/found_boards.py. Fake browser and fake model only."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import ats, careers, found_boards, page_recipes, render  # noqa: E402
from tests.test_found_boards_ai import ANSWER, BOARD, SEARCH, SHELL, TEXT, TITLES  # noqa: E402

MENU = [ats._job(f'https://empregos.example/jobs/{c}/', f'Berufe beginnend mit {c}:', '', f'https://empregos.example/jobs/{c}/') for c in 'abc']


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        saved = careers.READER, careers.RENDER, careers.CHOOSER
        careers.READER, careers.RENDER, careers.CHOOSER = 'auto', None, None
        self.addCleanup(lambda: (setattr(careers, 'READER', saved[0]), setattr(careers, 'RENDER', saved[1]), setattr(careers, 'CHOOSER', saved[2])))
        self.asked, self.shown = [], []
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch('src.places.load', return_value={}),
                      mock.patch.object(careers, 'reader', return_value=lambda url, markup, **kw: self.asked.append(url) or ANSWER),
                      mock.patch.object(page_recipes, 'load', return_value=None), mock.patch.object(page_recipes, 'save'),
                      mock.patch.object(page_recipes, 'mark_broken')):
            patch.start()
            self.addCleanup(patch.stop)

    def show(self, page):
        return lambda url: self.shown.append(url) or page


class ScriptBuiltTests(Base):
    def test_a_script_built_board_is_read_by_the_headless_browser(self):
        jobs, state, _ = found_boards.read_board(BOARD, SEARCH, fetch=lambda url: SHELL, show=self.show(TEXT))
        self.assertEqual((state, sorted({job['title'] for job in jobs})), ('ok', sorted(TITLES)))
        self.assertTrue(self.shown and all('empregos.example' in url for url in self.shown))
        self.assertGreater(len(self.shown), 1, "the board's other searches are read by the browser too")

    def test_a_refusal_in_the_browser_or_no_browser_is_a_visit(self):
        def refuse(url):
            raise render.Refused('HTTP 403')
        careers.REFUSALS.clear()
        self.assertEqual(found_boards.read_board(BOARD, SEARCH, fetch=lambda url: SHELL, show=refuse)[:2], ([], 'browser'))
        self.assertEqual(careers.REFUSALS.get('empregos.example'), 'HTTP 403')
        self.assertEqual(found_boards.read_board(BOARD, SEARCH, fetch=lambda url: SHELL)[:2], ([], 'browser'))

    def test_the_browser_reads_the_real_web_only_and_never_with_the_page_reader_off(self):
        given = []
        def read_board(board, search, fetch, route=None, early=False, show=None):
            given.append(show)
            return [], 'empty', None
        with mock.patch.object(found_boards, 'read_board', read_board), mock.patch.object(careers, 'renderer', return_value='browser'), \
                mock.patch.object(found_boards, '_another_way', side_effect=lambda *a: a[-1]), mock.patch.object(found_boards.board_check, 'kind', return_value=(None, '')):
            found_boards.read(SEARCH, [BOARD], is_relevant=list, dead=set(), early=True)
            found_boards.read(SEARCH, [BOARD], fetch=lambda url: '', is_relevant=list, dead=set(), early=True)
            careers.READER = None
            found_boards.read(SEARCH, [BOARD], is_relevant=list, dead=set(), early=True)
        self.assertEqual(given, ['browser', None, None])


class EmptyFirstPageTests(Base):
    """19 Oct 2026, Music Berlin: Arbeitsagentur had 0 jobs for the first words ("audio producer") and 5 for "sound engineer"; the one AI read
    was spent on the empty page and the rules could not read the list, so the board gave 0."""
    NONE = '<html><body>' + '<p>Keine Ergebnisse für diese Suche. Andere suchten auch nach anderen Berufen.</p>' * 20 + '</body></html>'

    def read(self, pages):
        self.asked = []
        with mock.patch.object(careers, 'reader', return_value=lambda url, markup, **kw: self.asked.append(url) or (ANSWER if 'card' in markup else [])):
            return found_boards.read_board(BOARD, SEARCH, fetch=lambda url: pages(url))

    def test_an_empty_ai_answer_is_asked_again_on_the_next_search(self):
        jobs, state, _ = self.read(lambda url: self.NONE if 'programador' in url else TEXT)
        self.assertEqual((state, sorted({job['title'] for job in jobs})), ('ok', sorted(TITLES)))
        self.assertEqual(len(self.asked), 2)

    def test_the_ai_is_asked_at_most_twice_on_a_board_with_no_jobs(self):
        self.assertEqual(self.read(lambda url: self.NONE)[:2], ([], 'empty'))
        self.assertEqual(len(self.asked), 2)

    def test_after_an_answer_with_jobs_the_ai_is_not_asked_again(self):
        self.read(lambda url: TEXT)
        self.assertEqual(len(self.asked), 1)


class HomeFormTests(Base):
    def test_a_script_built_home_page_s_search_form_is_found_in_the_browser(self):
        form = '<form action="/suche" method="get"><input name="was"><input name="wo"></form>'
        shown = {'https://empregos.example/': form}
        judge = lambda jobs: [job for job in jobs if job['title'] in TITLES]   # noqa: E731
        entry = {}
        with mock.patch('src.sources.board_pages.PAUSE_S', 0):
            jobs, state, relevant = found_boards._another_way(BOARD, entry, BOARD['search_url'], SEARCH, lambda url: SHELL, judge, ([], 'empty', []),
                                                              show=lambda url: self.shown.append(url) or shown.get(url, TEXT))
        self.assertEqual(sorted(job['title'] for job in relevant), sorted(TITLES))
        self.assertTrue(entry['search_url'].startswith('https://empregos.example/suche?was={role}'), entry)


class MenuTests(Base):
    def judge(self, jobs):
        return [job for job in jobs if job['title'] in TITLES]

    def another_way(self, before, fetch):
        entry = {}
        with mock.patch.object(found_boards.board_forms, 'home', return_value=('https://empregos.example/', '')), \
                mock.patch.object(found_boards.board_forms, 'home_templates', return_value=[]):
            return found_boards._another_way(BOARD, entry, BOARD['search_url'], SEARCH, fetch, self.judge, before), entry

    def test_jobs_none_relevant_get_one_ai_page_read(self):
        (jobs, state, relevant), entry = self.another_way((found_boards._shaped(BOARD, MENU), 'ok', []), lambda url: TEXT)
        self.assertEqual((state, sorted(job['title'] for job in relevant)), ('ok', sorted(TITLES)))
        self.assertEqual(len(self.asked), 1)
        self.assertIn('programador', self.asked[0], "the board's own search page, with the first search words")
        self.assertEqual(entry['form_for'], BOARD['search_url'], 'once per proposed link')

    def test_nothing_read_or_the_reader_off_asks_no_ai(self):
        fetched = []
        self.another_way(([], 'empty', []), lambda url: fetched.append(url) or TEXT)
        careers.READER = None
        before = (found_boards._shaped(BOARD, MENU), 'ok', [])
        self.assertEqual(self.another_way(before, lambda url: fetched.append(url) or TEXT)[0], before)
        self.assertEqual((self.asked, [url for url in fetched if 'procura' in url]), ([], []))


if __name__ == '__main__':
    unittest.main()
