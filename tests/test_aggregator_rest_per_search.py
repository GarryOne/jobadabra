"""A changed search reads the job boards at once: the 6-hour rest of src/sources/aggregators.py is kept per search (25 Oct 2026, owner's pilot
search 8 minutes after a software one read no board, asked for no board proposal and ran no web search)."""
import sqlite3
import unittest
from datetime import datetime, timedelta, timezone

from src.sources import aggregators, boards_ahead, careers

_READER = careers.READER


def setUpModule():   # no test here reaches a real model through a page read (guard: tests/test_found_boards_ai.py)
    careers.READER = None


def tearDownModule():
    careers.READER = _READER

SOFTWARE = {'role_keywords': ['software engineer'], 'jobs_board_search_queries': ['software engineer'], 'locations': {'top_tier': ['chisinau']}}
PILOT = {'role_keywords': ['pilot first officer'], 'jobs_board_search_queries': ['pilot first officer'], 'locations': {'top_tier': ['europe']}}


class RestPerSearch(unittest.TestCase):
    def setUp(self):
        self.db, self.now = sqlite3.connect(':memory:'), datetime(2026, 10, 25, 22, 52, tzinfo=timezone.utc)

    def test_every_reader_reads_again_for_a_changed_search(self):
        names = [name for name, _ in aggregators.sources({})] + [boards_ahead.NAME]
        for name in names:
            aggregators.mark_read(self.db, name, self.now - timedelta(minutes=8), SOFTWARE)
        for name in names:
            with self.subTest(name):
                self.assertIsNotNone(aggregators.read_lately(self.db, name, self.now, SOFTWARE), 'the same search rests')
                self.assertIsNone(aggregators.read_lately(self.db, name, self.now, PILOT), 'a changed search reads now')

    def test_the_search_key_ignores_order_and_other_settings(self):
        reordered = {**SOFTWARE, 'role_keywords': list(SOFTWARE['role_keywords']), 'digest_min_score': 70}
        self.assertEqual(aggregators.search_key(SOFTWARE), aggregators.search_key(reordered))
        self.assertNotEqual(aggregators.search_key(SOFTWARE), aggregators.search_key(PILOT))

    def test_a_read_from_before_the_key_counts_as_the_same_search(self):
        self.db.execute(aggregators.TABLE)
        self.db.execute('INSERT INTO aggregator_runs VALUES (?, ?)', ('Arbeitnow', (self.now - timedelta(minutes=5)).isoformat()))
        self.assertIsNotNone(aggregators.read_lately(self.db, 'Arbeitnow', self.now, PILOT), 'no key kept: rested as before')

    def test_scan_reads_a_reader_again_when_the_search_changed(self):
        reads = []
        reader = lambda search: reads.append(search['role_keywords'][0]) or []
        aggregators.scan(self.db, SOFTWARE, now=self.now - timedelta(minutes=8), readers=[('Arbeitnow', reader)])
        aggregators.scan(self.db, SOFTWARE, now=self.now, readers=[('Arbeitnow', reader)])
        aggregators.scan(self.db, PILOT, now=self.now, readers=[('Arbeitnow', reader)])
        self.assertEqual(reads, ['software engineer', 'pilot first officer'])


if __name__ == '__main__':
    unittest.main()
