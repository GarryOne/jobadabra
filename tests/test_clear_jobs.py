"""Clear my job list: found and scored jobs go, what the person acted on stays (src/clear_jobs.py), on every store adapter."""
import tempfile
import unittest
from pathlib import Path

from src import clear_jobs, store
from src.stores import memory, sqlite


def job(name):
    return {'url': f'https://jobs.example/{name}', 'title': name, 'company': 'Acme', 'location': 'Zurich'}


class ClearJobs(unittest.TestCase):
    def stores(self):
        return [memory.open_store(), sqlite.open_store({'JOBADABRA_DATA_DIR': tempfile.mkdtemp()})]

    def setup(self, stores):
        db = store.connect(Path(tempfile.mkdtemp()) / 'jobs.sqlite')
        ids = {}
        for name in ('found', 'applied', 'saved_local', 'mine_dismissed', 'imported'):
            ids[name], _ = store.upsert_job(db, job(name), 'Acme feed')
            stores.matches.upsert({**job(name), 'fit': 70, 'status': 'Open'})
        db.execute("UPDATE jobs SET notes='imported' WHERE id=?", (ids['imported'],))
        store.set_application_status(db, ids['saved_local'], 'saved')
        store.set_application_status(db, ids['mine_dismissed'], 'dismissed')
        stores.applications.create(job('applied'), 'Applied')
        stores.applications.set_section(stores.applications.get(job('applied')['url'])['id'], 'Kit', 'my kit')
        return db, ids

    def test_a_clear_keeps_what_the_person_acted_on_on_every_adapter(self):
        for stores in self.stores():
            with self.subTest(stores.name):
                db, ids = self.setup(stores)
                self.assertEqual(clear_jobs.plan(db, stores), {'clear': 1, 'keep': 4, 'dismissed': 1})
                self.assertEqual(clear_jobs.clear(db, stores), {'cleared': 1, 'kept': 4})
                self.assertEqual({r['title'] for r in db.execute('SELECT title FROM jobs')},
                                 {'applied', 'saved_local', 'mine_dismissed', 'imported'})
                self.assertEqual({m['title'] for m in stores.matches.list()}, {'applied', 'saved_local', 'mine_dismissed', 'imported'})
                self.assertEqual(stores.applications.sections(stores.applications.get(job('applied')['url'])['id']), {'Kit': 'my kit'})
                job_id, _ = store.upsert_job(db, job('found'), 'Acme feed')
                row = db.execute('SELECT first_seen_at, last_seen_at FROM jobs WHERE id=?', (job_id,)).fetchone()
                self.assertEqual(row[0], row[1], 'found again, it is new')

    def test_clearing_the_persons_own_dismissals_too_is_a_choice(self):
        for stores in self.stores():
            with self.subTest(stores.name):
                db, ids = self.setup(stores)
                stores.applications.create(job('gone'), 'Dismissed')
                self.assertEqual(clear_jobs.plan(db, stores, keep_dismissed=False)["clear"], 2)
                clear_jobs.clear(db, stores, keep_dismissed=False)
                self.assertIsNone(stores.applications.get(job('gone')['url']))
                self.assertNotIn('mine_dismissed', {r['title'] for r in db.execute('SELECT title FROM jobs')})
                self.assertIsNotNone(stores.applications.get(job('applied')['url']))

    def test_settings_and_other_tables_are_not_touched(self):
        db, _ = self.setup(memory.open_store())
        before = [db.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in ('companies', 'sources')]
        clear_jobs.clear(db, memory.open_store())
        self.assertEqual(before, [db.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in ('companies', 'sources')])


if __name__ == '__main__':
    unittest.main()
