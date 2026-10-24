"""The SQLite adapter passes the store contract, keeps its data across reopening, and lays its files out as the spec says."""
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import stores
from src.stores import sqlite
from tests.store_contract import JOB, StoreContract


class _Folder:
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.folder, True)
        self.env = {'JOB_PILOTTO_DATA_DIR': str(self.folder)}
        super().setUp()


class SqliteStoreTests(_Folder, StoreContract, unittest.TestCase):
    def make(self):
        return sqlite.open_store(self.env)


class SqliteOwnTests(_Folder, unittest.TestCase):
    def test_the_data_is_still_there_after_reopening_with_its_types(self):
        first = sqlite.open_store(self.env)
        app = first.applications.create(JOB, 'Saved')
        first.applications.update(app['id'], {'fit': 82})
        run = first.cron_runs.begin('search', 'mac')
        first.cron_runs.progress(run['id'], 'Reading feeds')
        first.events.add(app['id'], 'Interview', '2026-10-05')
        first.events.archive(app['id'], 'Interview')
        again = sqlite.open_store(self.env)
        self.assertEqual(again.applications.get(JOB['url'])['fit'], 82)
        self.assertEqual(again.cron_runs.get(run['id'])['progress'], ['Reading feeds'])
        self.assertEqual(again.events.list(), [])
        self.assertEqual(sqlite.connect(self.folder / 'tracker.sqlite').execute('PRAGMA user_version').fetchone()[0],
                         len(sqlite.MIGRATIONS))

    def test_a_first_layout_database_keeps_its_insights_through_the_later_migrations(self):
        path = self.folder / 'tracker.sqlite'
        old = sqlite3.connect(path)
        old.executescript(sqlite.MIGRATIONS[0] + '; PRAGMA user_version = 1;')
        old.execute("INSERT INTO insights (id, day, category, data) VALUES ('i1', '2026-10-01', 'daily', ?)",
                    ('{"id": "i1", "day": "2026-10-01", "category": "daily", "title": "Kept"}',))
        old.commit()
        old.close()
        s = sqlite.open_store(self.env)
        self.assertEqual([i['title'] for i in s.insights.list()], ['Kept'])
        s.insights.add({'day': '2026-10-01', 'category': 'daily', 'title': 'Second'})
        self.assertEqual(len(s.insights.list(category='daily')), 2)

    def test_files_live_under_the_job_folder_and_go_with_the_job(self):
        s = sqlite.open_store(self.env)
        app = s.applications.create(JOB, 'Saved')
        path = Path(s.applications.attach(app['id'], '../cv.pdf', b'%PDF', 'application/pdf'))
        self.assertEqual(path, self.folder / 'files' / app['id'] / 'cv.pdf')
        self.assertEqual(path.read_bytes(), b'%PDF')
        s.applications.delete(app['id'])
        self.assertFalse(path.parent.exists())

    def test_texts_are_the_apps_files_when_named_else_data_texts(self):
        profile = self.folder / 'app' / 'profile.md'
        knowledge = self.folder / 'app' / 'knowledge.md'
        s = sqlite.open_store({**self.env, 'JOB_PILOTTO_PROFILE_FILE': str(profile), 'JOB_PILOTTO_KNOWLEDGE_FILE': str(knowledge)})
        s.texts.set('profile', '# Igor')
        s.texts.set('knowledge', 'Workday: no cover letter')
        s.texts.set('answers', 'Notice: 3 months')
        self.assertEqual((profile.read_text(), knowledge.read_text()), ('# Igor', 'Workday: no cover letter'))
        self.assertEqual((self.folder / 'texts' / 'answers.md').read_text(), 'Notice: 3 months')

    def test_the_tracker_is_its_own_file_beside_the_jobs_cache(self):
        sqlite.open_store(self.env)
        tables = {r[0] for r in sqlite3.connect(self.folder / 'tracker.sqlite').execute("SELECT name FROM sqlite_master")}
        self.assertIn('applications', tables)
        self.assertFalse((self.folder / 'jobs.sqlite').exists())

    def test_a_second_process_opening_a_new_file_at_the_same_moment_does_not_fail(self):
        # 10 Oct 2026, Windows e2e: the app and a call of the engine opened a new tracker together; both read version 0 and the
        # second's CREATE TABLE failed with "table applications already exists". Here the first has finished, the second read is stale.
        path = self.folder / 'tracker.sqlite'
        sqlite.connect(path).close()
        real, reads = sqlite._version, []
        def stale_first(db):
            reads.append(1)
            return 0 if len(reads) == 1 else real(db)
        with mock.patch.object(sqlite, '_version', stale_first):
            db = sqlite.connect(path)
        self.assertEqual(real(db), len(sqlite.MIGRATIONS))
        self.assertIn('applications', {r[0] for r in db.execute("SELECT name FROM sqlite_master")})

    def test_a_locked_file_is_waited_for_not_failed_at_once(self):
        # Sentry JOB-PILOTTO-APP-2C (24 Oct 2026): `cron_runs list` at app start failed in 1 s with "database is locked" although the
        # connection waits 10 s: SQLite returns that at once while another process switches the journal mode or upgrades a read.
        path = self.folder / 'tracker.sqlite'
        sqlite.connect(path).close()
        real, calls = sqlite._version, []
        def locked_twice(db):
            calls.append(1)
            if len(calls) <= 2:
                raise sqlite.sqlite3.OperationalError('database is locked')
            return real(db)
        with mock.patch.object(sqlite, '_version', locked_twice):
            db = sqlite.connect(path)
        self.assertEqual(real(db), len(sqlite.MIGRATIONS))
        self.assertGreaterEqual(len(calls), 3)

    def test_open_stores_picks_it_by_default(self):
        self.assertEqual(stores.open_stores(self.env).name, 'sqlite')


if __name__ == '__main__':
    unittest.main()
