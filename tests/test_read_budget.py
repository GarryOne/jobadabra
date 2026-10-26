"""The employer read inside the search's time (src/sources/read_budget.py; owner, 26 Oct 2026, of a pilot search that read 1,123 employers for
5 minutes: "it shouldn't just go brute force and check all the employers" / "Stop at 3 minutes and tell you what's left for the next run"),
and the board web search started with the run, before the first jobs (src/sources/board_web.py early; the 26 Oct pilot check started it at
265 s). Fake sites and fake AI only; the clock is real but short."""
import io
import sqlite3
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src import time_budget
from src.sources import feeds, read_budget

TABLE = 'CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))'


def job(i):
    return {'id': str(i), 'title': 'First Officer A320', 'location': 'Vienna, Austria', 'url': f'https://x.test/{i}', 'date_posted': '',
            'description': 'd', 'remote': False, 'salary': ''}


def sites(n=1123):
    return [{'company': f'Co{i}', 'ats': 'lever', 'slug': f's{i}'} for i in range(n)]


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for patch in (mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(read_budget, 'READ_SECONDS', 0.4)):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(time_budget.start, 0)

    def scan(self, sources, slow_from=60):
        read, db = [], sqlite3.connect(':memory:')
        db.execute(TABLE)

        def fetcher(source):   # the first sites answer fast, the long tail slowly (the pilot run's 1,123 sites)
            n = int(source['slug'][1:])
            read.append(n)
            time.sleep(0.01 if n < slow_from else 0.3)
            return [job(n)]
        out = io.StringIO()
        began = time.monotonic()
        with redirect_stdout(out):
            report = feeds.scan(sources, db, fetcher=fetcher, details={})
        return report, read, time.monotonic() - began, out.getvalue()


class ReadInTime(Base):
    def test_a_1123_site_list_with_a_slow_tail_ends_in_its_time_best_first_and_keeps_the_rest(self):
        time_budget.start(180)
        report, read, took, log = self.scan(sites())
        self.assertLess(took, 3, 'started no new site past its time: not 1,123 sites')
        self.assertGreaterEqual(len(read), read_budget.READ_FLOOR, 'the best READ_FLOOR whatever the clock')
        self.assertLess(len(read), 400)
        self.assertEqual(sorted(read), list(range(len(read))), 'read in the order given (best first), no site skipped ahead')
        self.assertEqual(len(report['sources']), len(read), 'the report holds the sites read')
        self.assertIn(f'the other {1123 - len(read)} are read first next time', log)
        kept = read_budget._left()
        self.assertEqual(kept[0], f'lever:s{len(read)}')
        self.assertEqual(len(kept), 1123 - len(read))

    def test_the_next_run_reads_the_best_then_what_was_left_then_the_rest(self):
        key = lambda s: f"lever:{s['slug']}"
        read_budget.keep_left(sites()[500:510], key, 500, 1123)
        order = [s['slug'] for s in read_budget.left_first(sites(), key)]
        floor = read_budget.READ_FLOOR
        self.assertEqual(order[:floor], [f's{i}' for i in range(floor)], 'the best first, always')
        self.assertEqual(order[floor:floor + 10], [f's{i}' for i in range(500, 510)], 'then what the last run did not reach')
        self.assertEqual(len(order), 1123)

    def test_a_read_that_ends_in_time_forgets_the_list(self):
        key = lambda s: f"lever:{s['slug']}"
        read_budget.keep_left(sites()[5:9], key, 5, 9)
        time_budget.start(180)
        _, read, _, _ = self.scan(sites(30))
        self.assertEqual(len(read), 30)
        self.assertEqual(read_budget._left(), [])

    def test_without_a_budget_every_site_is_read(self):
        time_budget.start(0)
        _, read, _, log = self.scan(sites(70), slow_from=70)
        self.assertEqual(len(read), 70)
        self.assertNotIn('next time', log)


class WebSearchWithTheRun(unittest.TestCase):
    def test_the_full_read_takes_the_search_started_with_the_run_and_keeps_what_it_found(self):
        from src.ai import board_ideas
        from src.sources import board_web
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        asked = ('k1', ['Austria'], ['first officer'], [], ['Vienna'])
        board = {'name': 'Crew Board', 'host': 'crew.example', 'search_url': 'https://crew.example/?q={role}', 'countries': ['Austria'],
                 'kinds': ['any'], 'source_kind': 'sector'}
        calls = []

        def search(config, known, now=None, fetch=None, data=None):
            calls.append(1)
            data.setdefault('web', {})['k1'] = '2026-10-26T10:00:00+00:00'
            data.setdefault('ideas', {})['k1'] = [{**board, 'origin': 'web'}]
            return [board]
        with mock.patch('src.paths.DATA', Path(tmp.name)), mock.patch.object(board_ideas, 'asked_for', return_value=asked), \
                mock.patch.object(board_web, 'search', side_effect=search):
            board_web.early({'role_keywords': ['first officer']})
            data = board_ideas.load()
            started = board_web.start({'role_keywords': ['first officer']}, data)
            found = board_web.finish(started, [], data=data)
        self.assertEqual(len(calls), 1, 'one search: the full read took the one started with the run')
        self.assertEqual([b['host'] for b in found], ['crew.example'])
        self.assertEqual(data['web']['k1'], '2026-10-26T10:00:00+00:00', 'its time is kept, so it rests')
        self.assertEqual([b['host'] for b in data['ideas']['k1']], ['crew.example'])


if __name__ == '__main__':
    unittest.main()
