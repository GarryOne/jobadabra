"""No read holds a timed search past its cut (src/sources/read_budget.py cut_at; owner's run d4561921e533, 26 Oct 2026: no new employer site
after 2 minutes, but ~22 slow ones already open held the read until 5 min 37 s). One loop over every reader inside a run: employer sites,
job boards (also the boards the web search found, read the same way), the web search itself. A site that hangs is left, never waited for."""
import io
import sqlite3
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src import time_budget
from src.sources import board_web, careers, feeds, found_boards, read_budget

TABLE = 'CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))'
CUT = 0.6   # seconds from the test's start
HANG = 4    # a site that answers only after this long: the old code waited for it
_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER


def job(i):
    return {'id': str(i), 'title': 'First Officer A320', 'location': 'Vienna, Austria', 'url': f'https://x.test/{i}', 'date_posted': '',
            'description': 'd', 'remote': False, 'salary': ''}


def employer_sites(hang):
    db = sqlite3.connect(':memory:')
    db.execute(TABLE)

    def fetcher(source):
        n = int(source['slug'][1:])
        if n == 3:
            hang.wait(HANG)
        return [job(n)]
    report = feeds.scan([{'company': f'Co{i}', 'ats': 'lever', 'slug': f's{i}'} for i in range(8)], db, fetcher=fetcher, details={})
    return sorted(source['company'] for source in report['sources'])


def job_boards(hang, web=True):
    def read_board(board, *args, **kwargs):
        if board['host'] == 'b3.test':
            hang.wait(HANG)
        return [job(board['host'])], 'ok', None
    boards = [{'host': f'b{i}.test', 'name': f'b{i}.test', 'search_url': f'https://b{i}.test/?q={{role}}'} for i in range(6)]
    with mock.patch('src.ai.board_ideas.load', return_value={'boards': {}}), mock.patch('src.ai.board_ideas.save'), \
            mock.patch.object(found_boards, 'read_board', side_effect=read_board), mock.patch.object(board_web, 'start', return_value=None), \
            mock.patch.object(found_boards.board_employers, 'note'):
        jobs = found_boards.read({'role_keywords': ['first officer']}, boards, fetch=lambda url: '', is_relevant=lambda found: found,
                                 dead=set(), web=web)
    return sorted(str(item['id']) for item in jobs)


def web_search(hang):
    pool = ThreadPoolExecutor(max_workers=1)
    future = pool.submit(lambda: hang.wait(HANG) and [])
    pool.shutdown(wait=False)
    return board_web.finish((future, None), [])


READERS = {   # every reader a run waits for; a new one goes here with the site it leaves
    'employer sites': (employer_sites, lambda got: 'Co3' not in got and len(got) == 7),
    'job boards': (job_boards, lambda got: 'b3.test' not in got and len(got) == 5),
    "the web search's boards": (lambda hang: job_boards(hang, web=False), lambda got: 'b3.test' not in got and len(got) == 5),
    'the web search': (web_search, lambda got: got == []),
}


class NoReadHoldsTheRun(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(read_budget, 'READ_SECONDS', CUT / 2),
                      mock.patch.object(read_budget, 'READ_GRACE', CUT / 2, create=True)):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(time_budget.start, 0)

    def test_every_reader_leaves_a_hanging_site_at_the_cut(self):
        for name, (read, expected) in READERS.items():
            with self.subTest(name):
                hang = threading.Event()
                time_budget.start(180)
                began = time.monotonic()
                with redirect_stdout(io.StringIO()):
                    got = read(hang)
                took = time.monotonic() - began
                hang.set()
                self.assertLess(took, CUT + 1.5, f'{name}: waited {took:.1f} s for a site that hangs (the old code waited for it)')
                self.assertTrue(expected(got), f'{name}: {got}')

    def test_without_a_budget_every_site_is_waited_for(self):
        time_budget.start(0)
        hang = threading.Event()
        threading.Timer(0.3, hang.set).start()
        with redirect_stdout(io.StringIO()):
            got = employer_sites(hang)
        self.assertEqual(len(got), 8)

    def test_the_cut_counts_from_the_search_start_in_the_runs_own_budget(self):
        time_budget.start(180, now=100.0)
        self.assertEqual(read_budget.cut_at(), 100.0 + read_budget.READ_SECONDS + read_budget.READ_GRACE)
        time_budget.start(3, now=0.0)   # a 3-second run reads for the same part of its budget (time_budget.part)
        self.assertAlmostEqual(read_budget.cut_at(), (read_budget.READ_SECONDS + read_budget.READ_GRACE) * 3 / 180)


if __name__ == '__main__':
    unittest.main()
