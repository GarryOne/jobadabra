"""Acceptance: "First Officer · Europe" on an install with old state gets First Officer jobs from the boards its web search found, on screen
before any employer site (src/sources/boards_first.py; owner, 26 Oct 2026: "START A JOB SEARCH WITH SEARCHING ON GOOGLE!"). Old state = the
boards rested less than 6 h ago, an old board list read for another search. Offline: the web search's answer is a fixed fake, the boards are
fixture pages in two shapes seen on real boards (job links by id, job cards by slug), fake jobs only; no model, no network.
The role kind on old state ("First Officer" -> aviation_transport): tests/test_kind_seed_floor.py AnInstallWithStateTests."""
import io
import json
import sqlite3
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import time_budget
from src.sources import aggregators, board_web, boards_ahead, boards_first, careers, feeds, found_boards, read_budget

SEARCH = {'role_keywords': ['first officer'], 'jobs_board_search_queries': ['first officer'], 'locations': {'top_tier': ['europe']}}
ASKED = ('k-pilot', ['Austria', 'Germany'], ['first officer'], ['any'], ['europe'])
_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


INTRO = ('<p>Every flying job on one page: airlines, charter and business aviation across Europe, updated each day by our team. Filter by aircraft '
         'type, base and contract, or read the rules of each operator before you apply. Type rating, hours and licence are listed on every post.</p>')
FOOTER = '<footer><p>About us · Contact · Privacy · Terms · Cookie settings · Advertise a job · Newsletter for pilots and cabin crew</p></footer>'


def by_id(n):   # a list of job links by id (a crew board)
    rows = ''.join(f'<li class="job-row"><a href="/site/de/job/show/id/{100 + i}">First Officer A320 (m/w/d) {i}</a> <span class="company">Example Air {i}</span> '
                   f'<span class="place">Vienna, Austria</span> <span class="date">posted 2 days ago</span> <span class="type">full time, base Vienna</span></li>'
                   for i in range(n))
    return f'<html><body><header><nav>Jobs · Companies · Pilot career</nav></header><h1>Pilot jobs</h1>{INTRO}<ul class="jobs">{rows}</ul>{FOOTER}</body></html>'


def by_card(n):   # job cards with a slug link each (an aviation CV board)
    cards = ''.join(f'<div class="job-teaser"><div class="job-teaser-title"><a href="/job/b737-first-officer-{200 + i}">B737 First Officer {i}</a></div>'
                    f'<div class="job-teaser-company">Example Air {i}</div><div class="job-teaser-place">Berlin, Germany</div>'
                    f'<div class="job-teaser-info">Permanent contract, 500 hours on type, valid EASA licence</div></div>' for i in range(n))
    return f'<html><body><header><nav>Aviation jobs · Employers · CV</nav></header><h1>Aviation jobs</h1>{INTRO}<section>{cards}</section>{FOOTER}</body></html>'


PAGES = {'crew-board.test': by_id(8), 'cv-board.test': by_card(6), 'quiet-board.test': f'<html><body><h1>Jobs</h1>{INTRO}<p>No jobs today.</p>{FOOTER}</body></html>'}
ANSWER = {'boards': [{'name': host, 'search_url': f'https://{host}/jobs?q={{role}}', 'countries': ['Austria'], 'kinds': ['any'], 'source_kind': 'sector'}
                     for host in PAGES]}


def job_page(url):   # each job's own page: its heading is the title, as on the real boards
    import re
    slug = url.rstrip('/').rsplit('/', 1)[-1]
    number = int(re.findall(r'\d+', slug)[-1])
    title = f'First Officer A320 (m/w/d) {number - 100}' if '/show/id/' in url else f'B737 First Officer {number - 200}'
    return (f'<html><body><h1>{title}</h1><p>Example Air is hiring a {title} for its European bases. Valid EASA licence, type rating and 500 hours '
            f'on type. Full time, permanent contract.</p>{INTRO}{FOOTER}</body></html>')


def fetch(url):
    host = url.split('/')[2]
    if host not in PAGES:
        raise OSError(f'not a fixture: {url}')
    return job_page(url) if '/job/' in url else PAGES[host]


class FakeClient:
    def __init__(self, delay=0.0):
        self.delay = delay

    @property
    def messages(self):
        return self

    def create(self, **kwargs):
        time.sleep(self.delay)
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(ANSWER))], usage=None)


class OldState(unittest.TestCase):
    """The owner's install as his pilot runs found it: boards read 37 minutes ago for an older search, no search key kept."""

    def setUp(self):
        self.addCleanup(self.no_search_thread_left)   # runs last
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.data = Path(tmp.name)
        read = (datetime.now(timezone.utc) - timedelta(minutes=37)).isoformat(timespec='seconds')
        (self.data / 'found_boards.json').write_text(json.dumps({'boards': {
            'jobber.test': {'name': 'jobber.test', 'last_read': read, 'state': 'ok', 'relevant': 0},
            'rabota.test': {'name': 'rabota.test', 'last_read': read, 'state': 'ok', 'relevant': 0}}, 'ideas': {}, 'web': {}}))
        self.db = sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))')
        self.db.execute(aggregators.TABLE)
        self.db.execute('INSERT INTO aggregator_runs VALUES (?, ?)', (boards_ahead.NAME, read))
        wanted = lambda title: 'first officer' in str(title or '').lower()
        fake_careers = SimpleNamespace(READER=object(), get_text=fetch)   # the web search's own check only; the page reader stays off
        for patch in (mock.patch('src.paths.DATA', self.data), mock.patch('src.ai.board_ideas.asked_for', return_value=ASKED),
                      mock.patch.object(board_web, 'careers', fake_careers), mock.patch.object(board_web, 'disabled', return_value=False),
                      mock.patch('src.ai.cost.side'), mock.patch.object(found_boards.careers, 'get_text', fetch),
                      mock.patch.object(feeds, 'wanted_title', wanted), mock.patch.object(feeds, 'wanted_location', lambda job: True),
                      mock.patch.object(found_boards.board_employers, 'note'), mock.patch.object(aggregators.board_employers, 'note'),
                      mock.patch.object(aggregators.board_employers, 'fill_missing'), mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': ''})):
            patch.start()
            self.addCleanup(patch.stop)
        board_web._early.clear()
        self.addCleanup(board_web._early.clear)
        self.addCleanup(read_budget.short, False)
        self.addCleanup(time_budget.start, 0)
        time_budget.start(180)

    def no_search_thread_left(self):
        """No web search thread outlives its test (26 Oct 2026: one printed into test_desktop_tracker_commands' output on CI)."""
        for thread in [t for t in threading.enumerate() if t.name.startswith('board-web')]:
            thread.join(2)   # a worker ends just after its last answer
        left = [thread.name for thread in threading.enumerate() if thread.name.startswith('board-web') and thread.is_alive()]
        self.assertEqual(left, [], 'a web search thread outlived its test')

    def run_first(self, delay=0.0, wait=boards_first.WEB_WAIT):
        shown = []
        with mock.patch.object(board_web, '_searcher', return_value=FakeClient(delay)):
            searching = board_web.early(SEARCH, fetch=fetch)
            began = time.monotonic()
            with redirect_stdout(io.StringIO()) as out:
                matched = boards_first.run(self.db, SEARCH, lambda jobs: shown.append((time.monotonic() - began, jobs)), wait=wait)
            with redirect_stdout(io.StringIO()):   # a web search still searching ends inside this test: its line never lands in another test's output
                searching.exception(timeout=10)
        return matched, shown, out.getvalue()

    def test_first_officer_jobs_from_the_found_boards_are_on_screen_first(self):
        matched, shown, log = self.run_first()
        titles = [job['title'] for job in matched]
        self.assertTrue(any('First Officer' in title for title in titles), log)
        self.assertEqual(len(matched), 14, 'both board shapes read: 8 links by id, 6 cards')
        self.assertTrue(shown and shown[0][0] < 60, 'on screen within 60 s')
        self.assertIn('Job boards first: reading the 3 the web search found, before the employer sites', log)

    def test_enough_jobs_from_the_boards_keep_the_employer_read_to_its_best_sites(self):
        self.run_first()
        self.assertEqual(read_budget.deadline(now=50.0), 50.0, 'no employer site past the floor')

    def test_the_full_board_read_does_not_read_them_again(self):
        self.run_first()
        data = json.loads((self.data / 'found_boards.json').read_text())
        data['boards']['stepstone.test'] = {'name': 'stepstone.test', 'state': 'ok', 'relevant': 1,
                                           'last_read': (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat(timespec='seconds')}
        (self.data / 'found_boards.json').write_text(json.dumps(data))
        read = []
        with mock.patch.object(found_boards, 'read_board', side_effect=lambda board, *a, **k: read.append(board['host']) or ([], 'empty', None)), \
                mock.patch.object(board_web, 'start', return_value=None), redirect_stdout(io.StringIO()):
            found_boards.read(SEARCH, [{'name': h, 'host': h, 'search_url': f'https://{h}/?q={{role}}'} for h in [*PAGES, 'stepstone.test']],
                              fetch=fetch, is_relevant=lambda jobs: jobs, dead=set())
        self.assertEqual(read, ['stepstone.test'])

    def test_a_web_search_still_searching_is_left_to_the_full_read(self):
        matched, shown, log = self.run_first(delay=1.0, wait=0.2)
        self.assertEqual(matched, [])
        self.assertIn('the web search is still searching', log)
        self.assertEqual(len(board_web._early), 1, 'the full read takes it')

    def test_no_web_search_this_run_reads_nothing_first(self):
        shown = []
        with redirect_stdout(io.StringIO()):
            self.assertEqual(boards_first.run(self.db, SEARCH, shown.append), [])
        self.assertEqual(shown, [])


class RunOrder(unittest.TestCase):
    def test_the_found_boards_come_before_the_first_jobs_slice_and_the_employer_sites(self):
        source = (Path(__file__).resolve().parents[1] / 'src' / 'daily_search.py').read_text()
        early, first, slice_, sites = (source.index(text) for text in ('board_web.early(', 'boards_first.run(', 'first_jobs.run(', 'boards_ahead.scan_beside('))
        self.assertLess(early, first)
        self.assertLess(first, slice_)
        self.assertLess(slice_, sites)


if __name__ == '__main__':
    unittest.main()
