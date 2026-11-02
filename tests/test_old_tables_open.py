"""A database made by an older build must open through EVERY reader that touches its tables, not only the one that happened to add the
column (17 Oct 2026: "More employers" failed with "no such column: checked_with" because only harvest() added it and run() skipped harvest
while more than 100 names waited). Each table is built in its oldest shape; each reader runs against it."""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import contribute, scout, scout_core, scout_index, store as job_store
from src.sources import page_recipes

OLD_CANDIDATES = """CREATE TABLE scout_candidates (key TEXT PRIMARY KEY, name TEXT NOT NULL, origin TEXT NOT NULL, priority INTEGER NOT NULL,
    tier TEXT NOT NULL DEFAULT 'Standard', ats TEXT, slug TEXT, careers TEXT, status TEXT NOT NULL DEFAULT 'pending', quality INTEGER,
    stats_json TEXT, added_at TEXT NOT NULL, checked_at TEXT, next_check TEXT)"""   # before 3 Oct 2026: no website, no checked_with
OLD_FEED_HEALTH = 'CREATE TABLE feed_health (ats TEXT NOT NULL, slug TEXT NOT NULL, first_checked TEXT NOT NULL, last_relevant TEXT, PRIMARY KEY (ats, slug))'
OLD_RECIPES = 'CREATE TABLE page_recipes (url TEXT PRIMARY KEY, recipe_json TEXT NOT NULL, learned_at TEXT NOT NULL, source TEXT NOT NULL)'
OLD_JOBS = ('CREATE TABLE jobs (id INTEGER PRIMARY KEY, canonical_key TEXT NOT NULL UNIQUE, source_id INTEGER NOT NULL, company_id INTEGER NOT NULL, '
            'title TEXT NOT NULL, url TEXT NOT NULL, location TEXT, city TEXT, work_mode TEXT, first_seen_at TEXT NOT NULL, '
            "last_seen_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', classification TEXT, confidence REAL, salary_json TEXT, notes TEXT)")


def columns(db, table):
    return {row[1] for row in db.execute(f'PRAGMA table_info({table})')}


def old_candidates_db(rows):
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    db.execute(OLD_CANDIDATES)
    for i in range(rows):
        db.execute("INSERT INTO scout_candidates (key, name, origin, priority, added_at) VALUES (?, ?, 'AI idea', 50, '2026-10-01')", (f'co{i}', f'Co{i}'))
    return db


class OldTablesOpen(unittest.TestCase):
    def test_run_with_a_long_queue_on_a_table_from_before_checked_with(self):
        """The crash itself (17 Oct 2026): a long queue on a table from before checked_with reached next_batch without harvest()."""
        db = old_candidates_db(105)
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict('os.environ', {'JOBADABRA_FIXTURE_DIR': tmp}), \
                mock.patch.object(scout.employer_index, 'central_nofeed', return_value=set()):
            scout.run(db, batch=3, seeds={}, probe=lambda *a, **k: None, static=[], workers=1)
        self.assertLessEqual({'website', 'checked_with'}, columns(db, 'scout_candidates'))

    def test_every_reader_of_scout_candidates_opens_the_oldest_table(self):
        readers = {
            'next_batch': lambda db: scout.next_batch(db, 5),
            'harvest': lambda db: scout.harvest(db, {}, sources=[]),
            'dead_ends (contribute)': lambda db: contribute.dead_ends(db),
            'build_index': lambda db: scout_index.build_index(db, fetch=lambda *a, **k: None),
            'ensure_tables': scout_core.ensure_tables,
        }
        for name, read in readers.items():
            with self.subTest(reader=name):
                db = old_candidates_db(3)
                read(db)
                self.assertLessEqual({'website', 'checked_with'}, columns(db, 'scout_candidates'))
                db.execute('SELECT website, checked_with FROM scout_candidates').fetchall()

    def test_every_column_added_after_a_table_shipped_is_listed_in_one_place(self):
        """A new ALTER TABLE ... ADD COLUMN for scout_candidates must go into ADDED_COLUMNS (and TABLES), or this fails."""
        db = sqlite3.connect(':memory:')
        db.executescript(scout_core.TABLES)
        created = columns(db, 'scout_candidates')
        for table, added in scout_core.ADDED_COLUMNS.items():
            self.assertTrue({name for name, _ in added} <= created, f'{table}: TABLES must create every added column')

    def test_the_other_tables_with_added_columns_open_in_their_oldest_shape(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = sqlite3.connect(':memory:')
            db.execute(OLD_FEED_HEALTH)
            scout_index.health(db, [], '2026-10-17')
            self.assertLessEqual({'last_ok', 'fails', 'jobs', 'last_new', 'last_listed'}, columns(db, 'feed_health'), 'feed_health')
            db = sqlite3.connect(':memory:')
            db.execute(OLD_RECIPES)
            page_recipes._ready(db)
            self.assertIn('broken_at', columns(db, 'page_recipes'), 'page_recipes')
            path = Path(tmp) / 'jobs.sqlite'
            old = sqlite3.connect(path)
            old.execute(OLD_JOBS)
            old.commit()
            old.close()
            with job_store.connect(path) as db:
                self.assertLessEqual({'posted_at', 'description', 'identity'}, columns(db, 'jobs'), 'jobs')


if __name__ == '__main__':
    unittest.main()
