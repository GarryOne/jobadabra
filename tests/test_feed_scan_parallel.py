"""feeds.scan downloads feeds in parallel (a big employer index must fit the job's time) but reports in source order."""
import sqlite3
import sys
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import feeds  # noqa: E402


def job(i):
    return {'id': str(i), 'title': 'Site Reliability Engineer', 'location': 'Zurich, Switzerland', 'url': f'https://x.test/{i}',
            'date_posted': '', 'description': 'd', 'remote': False, 'salary': ''}


class ParallelScanTest(unittest.TestCase):
    def test_parallel_download_keeps_order_and_isolates_failures(self):
        sources = [{'company': f'Co{i}', 'ats': 'lever', 'slug': f's{i}'} for i in range(12)]
        active, peak, lock = [0], [0], threading.Lock()

        def fetcher(source):
            with lock:
                active[0] += 1
                peak[0] = max(peak[0], active[0])
            time.sleep(0.05)
            with lock:
                active[0] -= 1
            if source['slug'] == 's3':
                raise RuntimeError('feed down')
            return [job(int(source['slug'][1:]))]

        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))')
        report = feeds.scan(sources, db, fetcher=fetcher, details={})
        self.assertGreater(peak[0], 1)   # downloads overlapped
        self.assertEqual([s['company'] for s in report['sources']], [f'Co{i}' for i in range(12)])
        self.assertFalse(report['sources'][3]['ok'])
        self.assertIn('feed down', report['sources'][3]['error'])
        self.assertEqual(len(report['jobs']), 11)

    def test_the_downloads_never_move_the_runs_deadline(self):
        # 17 Oct 2026 the clock restarted after the downloads (a crawl outlasted 3 min, nothing scored for a week); 26 Oct 2026 that made
        # runs of 12-23 min. The reads now end at their cut, and the deadline stays the run's (tests/test_three_minutes.py).
        import tempfile
        import time
        from pathlib import Path
        from unittest import mock
        from src import time_budget
        began = time.monotonic()
        time_budget.start(180, now=began)
        try:
            db = sqlite3.connect(':memory:')
            db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))')
            with tempfile.TemporaryDirectory() as tmp, mock.patch('src.paths.DATA', Path(tmp)):
                feeds.scan([{'company': 'Co', 'ats': 'lever', 'slug': 's1'}], db, fetcher=lambda source: [job(1)], details={})
            self.assertEqual((time_budget.STARTED, time_budget.DEADLINE), (began, began + 180), 'the downloads leave the run\'s clock alone')
        finally:
            time_budget.start(0)


    def test_matches_are_counted_per_site_as_it_is_read(self):
        # 19 Oct 2026: the card said 0 matches until every site was downloaded; the words-sure hits now count as each site is read.
        import io
        from contextlib import redirect_stdout
        from src import run_counts
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE feed_jobs (board TEXT, id TEXT, fingerprint TEXT, first_seen TEXT, last_seen TEXT, PRIMARY KEY(board, id))')
        seen = []

        def on_jobs(found):
            seen.append(run_counts.line())
        run_counts.reset()
        out = io.StringIO()
        with redirect_stdout(out):
            feeds.scan([{'company': f'Co{i}', 'ats': 'lever', 'slug': f's{i}'} for i in range(3)], db,
                       fetcher=lambda source: [job(int(source['slug'][1:]))], details={}, on_jobs=on_jobs)
        self.assertEqual([line.split(' matches=')[1].split()[0] for line in seen], ['1', '2', '3'], 'rises site by site, during the read')


if __name__ == '__main__':
    unittest.main()
