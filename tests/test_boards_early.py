"""Job boards read early (owner, 19 Oct 2026: music's only paying board, XING, was 7th of the proposal and its jobs came at 351 s): the
first-jobs slice reads 6 boards at once and replaces each one that refuses automated reading by the next proposed one, at once and in the
same read (src/first_jobs.py, src/sources/found_boards.py spare); the app's board step after the search does not read them again;
the full search reads the found boards beside the employer sites, not after them, and shows their jobs as soon as they are read
(src/sources/boards_ahead.py), and the board scan takes them instead of reading again (src/sources/aggregators.py)."""
import sqlite3
import threading
import unittest
from unittest import mock

from src import first_jobs
from src.ai import board_ideas
from src.sources import aggregators, board_yield, boards_ahead, found_boards
from src.sources import careers

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER

SEARCH = {'role_keywords': ['tontechniker'], 'locations': {'top_tier': ['berlin'], 'country_wide': [], 'abroad': []}}


def board(n):
    return {'name': f'Board {n}', 'host': f'b{n}.example', 'search_url': f'https://b{n}.example/?q={{role}}', 'countries': ['Germany'],
            'kinds': ['any'], 'source_kind': 'general'}


class SliceTests(unittest.TestCase):
    def test_six_boards_are_read_at_once_with_the_next_six_as_spares(self):
        self.assertLessEqual(first_jobs.SLICE_BOARDS, board_yield.MAX_UNTRIED, 'one read takes this many untried boards')
        reads = []

        def read(search, boards, early=False, workers=found_boards.BOARD_WORKERS, spare=()):
            reads.append(([b['host'] for b in boards], workers, [b['host'] for b in spare]))
            return []
        with mock.patch.object(board_ideas, 'proven', return_value=[]), mock.patch.object(board_ideas, 'ideas', return_value=[board(n) for n in range(1, 14)]), \
                mock.patch.object(board_ideas, 'load', return_value={'boards': {}}), mock.patch.object(found_boards, 'read', read):
            first_jobs.board_jobs(lambda line: None, SEARCH)
        self.assertEqual(reads, [([f'b{n}.example' for n in range(1, 7)], 6, [f'b{n}.example' for n in range(7, 13)])], 'one read, no second wave')

    def test_a_second_wave_reads_the_given_boards_only(self):
        kept = {'paid.example': {'state': 'ok', 'relevant': 4, 'search_url': 'https://paid.example/?q={role}', 'countries': ['Germany'],
                                 'last_read': '2026-10-18'}}
        self.assertIn('paid.example', [b['host'] for b in board_yield.pick([board(7)], kept)])
        self.assertEqual([b['host'] for b in board_yield.pick([board(7)], kept, remember=False)], ['b7.example'])


class SpareTests(unittest.TestCase):
    """found_boards.read(spare=...): a board that refuses gives its place to the next spare board at once, while the others are still read."""
    def read(self, refusing, slow=None):
        data, order, said = {'boards': {}}, [], []
        spare_started = threading.Event()

        def read_board(board, search, fetch, route=None, early=False, show=None):
            if board['host'] == slow:   # the slowest first board: still being read when the spare one starts
                self.assertTrue(spare_started.wait(5), 'the spare board is read while the first ones are, not after them')
            if int(board['host'][1:].split('.')[0]) > 6:
                spare_started.set()
            return ([], 'browser', None) if board['host'] in refusing else ([{'title': 'Tontechniker', 'url': f"https://{board['host']}/1"}], 'ok', None)

        def judge(jobs):
            return list(jobs)
        with mock.patch.object(board_ideas, 'load', return_value=data), mock.patch.object(board_ideas, 'save'), \
                mock.patch.object(found_boards, 'read_board', read_board), mock.patch.object(found_boards, '_dead', return_value=set()), \
                mock.patch.object(found_boards.board_employers, 'note'), mock.patch('builtins.print', lambda *a, **k: said.append(' '.join(map(str, a)))):
            jobs = found_boards.read(SEARCH, [board(n) for n in range(1, 7)], early=True, workers=6, spare=[board(n) for n in range(7, 10)],
                                     is_relevant=judge, dead=set())
        found = [line.split(': ', 1)[1].split(' ')[0:2] for line in said if line.startswith('Job boards found:')]
        return jobs, [' '.join(name) for name in found], said

    def test_each_refusing_board_is_replaced_at_once_and_kept_after_the_others(self):
        jobs, kept_order, said = self.read(refusing={'b1.example', 'b3.example', 'b7.example'}, slow='b2.example')
        self.assertEqual(kept_order, [f'Board {n}' for n in range(1, 10)], 'the first boards in their order, then the spares in theirs')
        self.assertEqual(sorted(job['url'] for job in jobs), sorted(f'https://b{n}.example/1' for n in (2, 4, 5, 6, 8, 9)))
        self.assertTrue(any('Board 7 refuses automated reading; reading Board 9 in its place' in line or
                            'Board 7 refuses automated reading; reading Board 8 in its place' in line for line in said), said)

    def test_no_refusal_reads_no_spare(self):
        jobs, kept_order, _ = self.read(refusing=set())
        self.assertEqual(kept_order, [f'Board {n}' for n in range(1, 7)])


class OnceTests(unittest.TestCase):
    """The app's 'Searching job boards' step after a first search (desktop/lib/search-steps.js) does not read the boards that search read."""
    def step(self, read_lately):
        reads = []
        kept = {'b1.example': {'name': 'Board 1', 'last_read': '2026-10-19T00:05:00+00:00', 'jobs': 38, 'relevant': 14, 'state': 'ok'}}
        with mock.patch.object(board_ideas, 'ideas', return_value=[board(1)]), mock.patch.object(board_ideas, 'load', return_value={'boards': kept}), \
                mock.patch.object(found_boards, 'read', lambda *a, **k: reads.append(1) or []), \
                mock.patch.object(board_yield, '_read_by_the_search', return_value=read_lately):
            lines = board_yield.step(SEARCH)
        return reads, lines

    def test_boards_the_search_read_are_not_read_again(self):
        reads, lines = self.step(read_lately=True)
        self.assertEqual(reads, [])
        self.assertEqual(lines, [{'source': 'Board 1', 'status': '38 listed, 14 relevant (your roles, your places)'}], 'what that read gave')

    def test_boards_not_read_lately_are_read(self):
        reads, _ = self.step(read_lately=False)
        self.assertEqual(reads, [1])

    def test_read_lately_follows_the_board_scans_spacing(self):
        from datetime import datetime, timedelta, timezone
        db, now = sqlite3.connect(':memory:'), datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)
        self.assertIsNone(aggregators.read_lately(db, boards_ahead.NAME, now))
        db.execute('INSERT INTO aggregator_runs VALUES (?, ?)', (boards_ahead.NAME, (now - timedelta(minutes=5)).isoformat()))
        self.assertIsNotNone(aggregators.read_lately(db, boards_ahead.NAME, now))
        self.assertIsNone(aggregators.read_lately(db, boards_ahead.NAME, now + timedelta(hours=aggregators.SPACING_HOURS)))


class SoFar:
    def __init__(self):
        self.seen = []

    def listener(self, where):
        return lambda jobs: self.seen.append((where, [job['title'] for job in jobs]))


class BesideTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.board_reads = 0
        self.board_read = threading.Event()

        self.since = []

        def read(search, since=None):
            self.since.append(since)
            self.board_reads += 1
            self.board_read.set()
            return [{'title': 'Tontechniker'}]
        for patch in (mock.patch.object(aggregators, 'sources', lambda env=None: [(boards_ahead.NAME, read)]),
                      mock.patch.object(aggregators, 'kept', lambda db, name, found, now=None: list(found))):
            patch.start()
            self.addCleanup(patch.stop)

    def scan(self, sources, db, on_jobs=None):   # employer sites: the boards' read ends while they are still being read
        on_jobs([{'title': 'Site job 1'}])
        self.assertTrue(self.board_read.wait(5), 'the boards are read while the employer sites are')
        if self.ahead_box:
            self.ahead_box.wait()
        on_jobs([{'title': 'Site job 2'}])
        self.so_far.seen.append(('employer sites ended', []))
        return {'jobs': [], 'sources': []}

    def test_the_boards_jobs_are_shown_during_the_employer_sites_read_and_not_read_again(self):
        so_far = self.so_far = SoFar()
        self.ahead_box = None
        real_start = boards_ahead.start

        def start(db, search, env=None, now=None):
            self.ahead_box = real_start(db, search, env, now)
            return self.ahead_box
        with mock.patch.object(boards_ahead, 'start', start):
            report, ahead = boards_ahead.scan_beside([], self.db, SEARCH, so_far, due=True, scan=self.scan)
        where = [entry[0] for entry in so_far.seen]
        self.assertLess(where.index('job boards'), where.index('employer sites ended'), 'shown in the list before the employer sites end')
        self.assertEqual(where.count('job boards'), 1)
        shown = []
        found = aggregators.scan(self.db, SEARCH, on_jobs=shown.append, ahead=ahead)
        self.assertEqual(self.board_reads, 1, 'taken, not read again')
        self.assertEqual([job['title'] for job in found['jobs']], ['Tontechniker'])
        self.assertEqual(shown, [], 'shown once')

    def test_a_search_that_reads_no_boards_starts_none(self):
        report, ahead = boards_ahead.scan_beside([], self.db, SEARCH, SoFar(), due=False, scan=lambda sources, db, on_jobs=None: {'jobs': []})
        self.assertIsNone(ahead)
        self.assertEqual(self.board_reads, 0)

    def test_boards_read_in_the_last_hours_are_not_read_again(self):
        """Within the rest the read still starts, for the boards not read since (owner's pilot run, 26 Oct 2026; tests/test_board_spacing.py)."""
        self.db.execute(aggregators.TABLE)
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        self.db.execute('INSERT INTO aggregator_runs VALUES (?, ?)', (boards_ahead.NAME, now.isoformat()))
        ahead = boards_ahead.start(self.db, SEARCH, now=now)
        ahead.wait()
        self.assertEqual(self.since, [now - timedelta(hours=aggregators.SPACING_HOURS)])
        with mock.patch.dict('os.environ', {'JOB_PILOTTO_FIXTURE_DIR': '/x'}):
            self.assertIsNone(boards_ahead.start(sqlite3.connect(':memory:'), SEARCH), 'the fixture mode never reaches a live site')


if __name__ == '__main__':
    unittest.main()
