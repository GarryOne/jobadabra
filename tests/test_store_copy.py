"""Moving the user's data between stores: everything arrives, links between records hold, a second run adds nothing."""
import tempfile
import unittest
from pathlib import Path

from src.stores import copy, memory

URL = 'https://jobs.example.com/sre-1'


def filled():
    s = memory.open_store()
    s.texts.set('profile', '# Me')
    s.texts.set('knowledge', '- Workday wants a phone')
    app = s.applications.create({'url': URL, 'title': 'SRE', 'company': 'Acme'}, 'Applied')
    s.applications.update(app['id'], {'applied_on': '2026-09-01'})
    s.applications.set_section(app['id'], 'Kit', '## Letter')
    s.applications.attach(app['id'], 'cv.pdf', b'%PDF', 'application/pdf')
    s.events.add(app['id'], 'Applied', '2026-09-01', source='app')
    s.interviews.save(None, {'app_id': app['id'], 'title': 'First call', 'transcript': 'A: hi'})
    s.matches.upsert({'url': URL, 'title': 'SRE', 'fit': 81, 'status': 'Saved'})
    s.insights.save('2026-09-02', 'daily', 'Tip', 'Apply earlier')
    s.employers.add({'name': 'Acme'})
    s.employers.add({'name': 'Gone', 'active': False})
    s.agent_runs.add({'url': URL, 'ats': 'workday', 'outcome': 'filled'})
    run = s.cron_runs.begin('search', 'mac')
    s.cron_runs.finish(run['id'], 'Done', summary='3 new jobs')
    return s


class CopyTests(unittest.TestCase):
    def test_everything_arrives_and_events_and_interviews_follow_their_job(self):
        source, target = filled(), memory.open_store()
        copy.copy(source, target)
        app = target.applications.get(URL)
        self.assertEqual((app['stage'], app['applied_on']), ('Applied', '2026-09-01'))
        self.assertEqual(target.applications.sections(app['id']), {'Kit': '## Letter'})
        self.assertEqual(target.applications.files(app['id']), [('cv.pdf', b'%PDF', 'application/pdf')])
        self.assertEqual([e['kind'] for e in target.events.list(app_id=app['id'])], ['Applied'])
        self.assertEqual([i['title'] for i in target.interviews.list(app_id=app['id'])], ['First call'])
        self.assertEqual(target.matches.list()[0]['fit'], 81)
        self.assertEqual((target.texts.get('profile'), target.texts.get('answers')), ('# Me', ''))
        self.assertEqual(len(target.insights.list()), 1)
        self.assertEqual(sorted(e['name'] for e in target.employers.list(active=None)), ['Acme', 'Gone'])
        self.assertEqual(target.agent_runs.list()[0]['ats'], 'workday')
        self.assertEqual(target.cron_runs.list()[0]['summary'], '3 new jobs')

    def test_the_source_is_left_as_it_was(self):
        source = filled()
        before = (source.applications.list(), source.events.list(), source.texts.get('profile'))
        copy.copy(source, memory.open_store())
        self.assertEqual((source.applications.list(), source.events.list(), source.texts.get('profile')), before)

    def test_a_second_run_with_the_journal_adds_nothing(self):
        source, target = filled(), memory.open_store()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'move.json'
            copy.copy(source, target, copy.Journal(path))
            again = copy.copy(source, target, copy.Journal(path))
        self.assertEqual({k: v for k, v in again.items() if k != 'matches'}, {})
        self.assertEqual((len(target.applications.list()), len(target.events.list()), len(target.cron_runs.list())), (1, 1, 1))

    def test_a_move_cut_off_halfway_finishes_without_duplicates(self):
        source, target = filled(), memory.open_store()
        source.applications.create({'url': 'https://jobs.example.com/2', 'title': 'Two'}, 'Saved')
        real_put = target.events.put

        def lost_connection(record):
            raise ConnectionError('Notion went away')
        target.events.put = lost_connection
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'move.json'
            with self.assertRaises(ConnectionError):
                copy.copy(source, target, copy.Journal(path))
            target.events.put = real_put
            copy.copy(source, target, copy.Journal(path))
        self.assertEqual(len(target.applications.list()), 2)
        self.assertEqual(len(target.events.list()), 1)

    def test_a_job_already_in_the_target_without_a_journal_line_is_not_copied_twice(self):
        source, target = filled(), memory.open_store()
        copy.copy(source, target)  # no journal: as if it was lost
        copy.copy(source, target)
        self.assertEqual(len(target.applications.list()), 1)

    def test_a_text_the_target_already_has_is_kept_and_named(self):
        source, target = filled(), memory.open_store()
        target.texts.set('profile', '# Written in Notion before')
        counts = copy.copy(source, target)
        self.assertEqual(target.texts.get('profile'), '# Written in Notion before')
        self.assertEqual(target.texts.get('knowledge'), '- Workday wants a phone')
        self.assertEqual(counts['kept'], ['profile'])

    def test_a_kept_text_is_still_named_after_a_move_cut_off_and_resumed(self):
        source, target = filled(), memory.open_store()
        target.texts.set('profile', '# Written in Notion before')
        real_put = target.events.put
        target.events.put = lambda record: (_ for _ in ()).throw(ConnectionError('Notion went away'))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'move.json'
            with self.assertRaises(ConnectionError):
                copy.copy(source, target, copy.Journal(path))
            target.events.put = real_put
            counts = copy.copy(source, target, copy.Journal(path))
        self.assertEqual(counts['kept'], ['profile'])
        self.assertEqual(target.texts.get('profile'), '# Written in Notion before')

    def test_a_workspace_just_built_takes_the_source_texts_over_its_placeholder(self):
        source, target = filled(), memory.open_store()
        target.texts.set('profile', 'Filled in by Jobadabra.')
        counts = copy.copy(source, target, source_texts_win=True)
        self.assertEqual(target.texts.get('profile'), '# Me')
        self.assertNotIn('kept', counts)

    def test_progress_is_reported_per_entity(self):
        seen = []
        copy.copy(filled(), memory.open_store(), progress=lambda entity, done, total: seen.append((entity, done, total)))
        self.assertIn(('applications', 1, 1), seen)
        self.assertIn(('cron_runs', 1, 1), seen)


if __name__ == '__main__':
    unittest.main()
