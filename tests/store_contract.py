"""The store contract: what every adapter (memory, sqlite, notion, any later one) must do, as one test mixin.

An adapter's own test file subclasses it with `make()` returning a fresh, empty `Stores`:
    class SqliteStoreTests(StoreContract, unittest.TestCase):
        def make(self): return sqlite.open_store({...a temp folder...})
Spec: docs/superpowers/specs/2026-10-09-store-adapters.md. Not a test file itself (no test_ prefix).
"""
import datetime
import inspect
from pathlib import Path
from unittest import mock

from src.stores import base
from tests.store_contract_runs import RunsContract

JOB = {'url': 'https://jobs.example.com/sre-1', 'title': 'Senior SRE', 'company': 'Acme', 'location': 'Zurich'}


def scored(url, score):
    """A job as the search scores it (src/ai/score.py): what every store's Matches.sync takes."""
    return {'url': url, 'title': 'SRE', 'company': 'Example', 'location': 'Zurich', 'first_seen_at': '2026-10-01T08:00:00+00:00',
            'fit': {'score': score, 'tier': 'Strong', 'confidence': 'High', 'reason': 'Kubernetes on call',
                    'strengths': ['Kubernetes', 'on call'], 'gaps': ['Go'],
                    'components': {'role_fit': 30, 'location': 20, 'compensation': 10, 'growth': 10, 'risk': 10}}}


AI = {'seniority': {'value': 'senior'}, 'work_mode': {'value': 'hybrid', 'remote_scope': 'Switzerland'}, 'english_is_enough': {'value': 'yes'},
      'languages': [{'language': 'German', 'level': 'nice_to_have'}, {'language': 'Spanish', 'level': 'nice_to_have'}],
      'salary': {'stated': True, 'text': 'CHF 140-160k'}, 'employer_type': {'value': 'recruiter'},
      'technologies': ['Kubernetes', 'Terraform'], 'role_family': 'SRE', 'workload': '80-100%', 'on_call': 'no',
      'visa_sponsorship': {'value': 'not_offered'}, 'contract': 'permanent', 'deadline': '2026-11-01', 'posted': '2026-10-03',
      'responsibilities': ['Keep production reliable', 'Run on-call and incidents']}


class StoreContract(RunsContract):
    def make(self):
        raise NotImplementedError

    def setUp(self):
        self.s = self.make()

    def assertRecord(self, row, fields):
        self.assertEqual(set(row), set(fields), 'a record has exactly its fields')

    def test_every_method_takes_the_interfaces_parameter_names(self):
        """Callers (and `python -m src.stores call`) pass arguments by name: an adapter must use the same ones."""
        for entity in ('applications', 'events', 'matches', 'interviews', 'insights', 'employers', 'agent_runs',
                       'cron_runs', 'texts'):
            protocol = getattr(base, ''.join(part.title() for part in entity.split('_')))
            for name, method in vars(protocol).items():
                if name.startswith('_') or not callable(method):
                    continue
                want = [p for p in inspect.signature(method).parameters if p != 'self']
                have = getattr(getattr(self.s, entity), name, None)
                self.assertIsNotNone(have, f'{entity}.{name} is missing')
                self.assertEqual([p for p in inspect.signature(have).parameters], want, f'{entity}.{name}')

    # Applications

    def test_an_application_is_created_found_by_any_url_form_and_listed(self):
        row = self.s.applications.create(JOB, 'Saved')
        self.assertRecord(row, base.APPLICATION_FIELDS)
        self.assertTrue(row['id'])
        self.assertTrue(row['created_at'])
        self.assertEqual(row['stage'], 'Saved')
        self.assertEqual(self.s.applications.get(JOB['url'] + '/')['id'], row['id'])
        self.assertIsNone(self.s.applications.get('https://jobs.example.com/other'))
        self.assertEqual([r['id'] for r in self.s.applications.list()], [row['id']])
        self.assertEqual(self.s.applications.list(stages=['Applied']), [])

    def test_an_application_is_found_by_its_id(self):
        row = self.s.applications.create(JOB, 'Saved')
        self.assertEqual(self.s.applications.by_id(row['id'])['url'], row['url'])
        self.s.applications.delete(row['id'])
        self.assertIsNone(self.s.applications.by_id(row['id']))

    def test_creating_the_same_job_twice_keeps_one_row(self):
        self.s.applications.create(JOB, 'Saved')
        self.s.applications.create({**JOB, 'url': JOB['url'] + '/'}, 'Saved')
        self.assertEqual(len(self.s.applications.list()), 1)

    def test_applied_on_is_the_local_day_after_midnight(self):
        # 00:12 in Zurich is still yesterday in UTC: Applied on is the person's day (base.local_today), as the Notion tracker always wrote it.
        class Local(datetime.date):
            @classmethod
            def today(cls): return cls(2026, 10, 10)
        self.s.applications.set_stage(JOB, 'Saved')
        with mock.patch.object(base, 'date', Local):
            row, _ = self.s.applications.set_stage(JOB, 'Applied')
        self.assertEqual(row['applied_on'], '2026-10-10')

    def test_set_stage_creates_changes_then_writes_nothing(self):
        row, outcome = self.s.applications.set_stage(JOB, 'Saved')
        self.assertEqual(outcome, base.CREATED)
        row, outcome = self.s.applications.set_stage(JOB, 'Applied', today='2026-10-09')
        self.assertEqual((outcome, row['stage'], row['applied_on']), (base.CHANGED, 'Applied', '2026-10-09'))
        row, outcome = self.s.applications.set_stage(JOB, 'Applied', today='2026-10-10')
        self.assertEqual((outcome, row['applied_on']), (base.UNCHANGED, '2026-10-09'))
        self.assertEqual(self.s.applications.stages(), {base.url_key(JOB['url']): 'Applied'})

    def test_update_changes_only_the_given_fields_and_refuses_unknown_ones(self):
        row = self.s.applications.create(JOB, 'Saved')
        row = self.s.applications.update(row['id'], {'next_step': 'Call Anna', 'fit': 82})
        self.assertEqual((row['next_step'], row['fit'], row['title']), ('Call Anna', 82, 'Senior SRE'))
        with self.assertRaises(KeyError):
            self.s.applications.update(row['id'], {'no such field': 1})
        with self.assertRaises(KeyError):
            self.s.applications.update('missing', {'notes': 'x'})

    def test_updated_at_is_stamped_on_every_change_and_never_taken_from_the_caller(self):
        row = self.s.applications.create(JOB, 'Saved')
        self.assertTrue(row['updated_at'] >= row['created_at'][:19], row)
        for changed in (self.s.applications.update(row['id'], {'notes': 'x', 'updated_at': '2001-01-01T00:00:00+00:00'}),
                        self.s.applications.set_stage(JOB, 'Applied')[0], self.s.applications.get(JOB['url'])):
            self.assertTrue(changed['updated_at'] >= row['updated_at'][:19], changed)
            self.assertNotEqual(changed['updated_at'][:4], '2001')

    def test_sections_and_files_belong_to_their_job_and_go_with_it(self):
        row = self.s.applications.create(JOB, 'Saved')
        self.assertIsNone(self.s.applications.section(row['id'], 'Kit'))
        self.s.applications.set_section(row['id'], 'Kit', '## Cover letter\n\nDear Acme,')
        self.assertEqual(self.s.applications.section(row['id'], 'Kit'), '## Cover letter\n\nDear Acme,')
        self.s.applications.set_section(row['id'], 'Kit', 'v2')
        self.assertEqual(self.s.applications.section(row['id'], 'Kit'), 'v2')
        self.assertTrue(self.s.applications.attach(row['id'], 'cv.pdf', b'%PDF', 'application/pdf'))
        with self.assertRaises(KeyError):
            self.s.applications.set_section('missing', 'Kit', 'x')
        self.s.applications.delete(row['id'])
        self.assertIsNone(self.s.applications.get(JOB['url']))
        self.assertIsNone(self.s.applications.section(row['id'], 'Kit'))

    def test_a_job_only_answers_section_keeps_its_lines_on_every_store(self):
        """An answer given for one job only (desktop/lib/job-answers.js) is a section of that job's record: the shared sample comes back whole."""
        sample = (Path(__file__).parent / 'fixtures' / 'stores' / 'job-answers.md').read_text()
        row = self.s.applications.create(JOB, 'Saved')
        self.s.applications.set_section(row['id'], base.JOB_ANSWERS_SECTION, sample)
        back = self.s.applications.section(row['id'], base.JOB_ANSWERS_SECTION)
        self.assertEqual([line.strip() for line in back.strip().splitlines() if line.strip()],
                         [line.strip() for line in sample.strip().splitlines() if line.strip()])
        self.assertIsNone(self.s.applications.section(row['id'], base.KIT_SECTION), 'it never lands in the kit')

    def test_logged_entries_grow_one_section_in_order(self):
        """append_entry (src/ai/inbox.py's log): each entry is a '### {title}' in base.LOGGED, oldest first, beside the other sections."""
        row, _ = self.s.applications.set_stage(JOB, 'Applied')
        self.s.applications.set_section(row['id'], '🧾 Job description', 'Kubernetes on call.')
        self.s.applications.append_entry(row['id'], base.LOGGED, '📥 29 Sep 2026 · LinkedIn · They asked for a call', '> Are you free Monday?')
        self.s.applications.append_entry(row['id'], base.LOGGED, '📥 30 Sep 2026 · Email · Interview booked', '> Monday 10:00 works.')
        logged = self.s.applications.sections(row['id'])[base.LOGGED]
        self.assertEqual([line for line in logged.splitlines() if line.startswith('### ')],
                         ['### 📥 29 Sep 2026 · LinkedIn · They asked for a call', '### 📥 30 Sep 2026 · Email · Interview booked'])
        self.assertIn('Are you free Monday?', logged)
        self.assertEqual(self.s.applications.section(row['id'], base.LOGGED), logged)
        self.assertEqual(self.s.applications.section(row['id'], '🧾 Job description'), 'Kubernetes on call.')   # untouched by the log

    def test_a_logged_entrys_screenshots_are_kept_with_the_job(self):
        """append_entry(files=…): the screenshots of a log stay with the job (its files on this Mac, inside the fold on Notion)."""
        row, _ = self.s.applications.set_stage(JOB, 'Applied')
        self.s.applications.append_entry(row['id'], base.LOGGED, '📥 29 Sep 2026 · LinkedIn · A call?', '> Free Monday?',
                                         files=[('chat.png', b'png bytes', 'image/png')])
        self.assertIn('📥 29 Sep 2026 · LinkedIn · A call?', self.s.applications.section(row['id'], base.LOGGED))
        self.assertIn(b'png bytes', [data for _, data, _ in self.s.applications.files(row['id'])])

    def test_sections_and_files_are_listed_for_a_move(self):
        row = self.s.applications.create(JOB, 'Saved')
        self.s.applications.set_section(row['id'], 'Kit', 'k')
        self.s.applications.set_section(row['id'], 'Prep', 'p')
        self.s.applications.attach(row['id'], 'cv.pdf', b'%PDF', 'application/pdf')
        self.assertEqual(self.s.applications.sections(row['id']), {'Kit': 'k', 'Prep': 'p'})
        self.assertEqual(self.s.applications.files(row['id']), [('cv.pdf', b'%PDF', 'application/pdf')])

    def test_put_keeps_a_copied_records_fields_and_dates_under_a_new_id(self):
        app = self.s.applications.put({**JOB, 'id': 'elsewhere-1', 'stage': 'Applied', 'applied_on': '2026-09-01',
                                       'created_at': '2026-08-30T10:00:00+00:00'})
        self.assertNotEqual(app['id'], 'elsewhere-1')
        self.assertEqual((app['stage'], app['applied_on'], app['created_at'][:10]), ('Applied', '2026-09-01', '2026-08-30'))
        event = self.s.events.put({'app_id': app['id'], 'kind': 'Applied', 'at': '2026-09-01', 'created_at': '2026-09-01T09:00:00+00:00'})
        self.assertEqual(self.s.events.list(app_id=app['id'])[0]['created_at'][:10], '2026-09-01')
        self.assertEqual(event['kind'], 'Applied')
        run = self.s.cron_runs.put({'kind': 'search', 'where': 'mac', 'status': 'Done', 'started_at': '2026-09-02T08:00:00+00:00',
                                    'finished_at': '2026-09-02T08:05:00+00:00', 'summary': '2 new jobs', 'progress': []})
        self.assertEqual((self.s.cron_runs.get(run['id'])['started_at'][:10], run['summary']), ('2026-09-02', '2 new jobs'))
        for table, values in ((self.s.interviews, {'app_id': app['id'], 'title': 'Call'}),
                              (self.s.insights, {'day': '2026-09-03', 'category': 'daily', 'title': 'T', 'body': 'b'}),
                              (self.s.employers, {'name': 'Acme', 'active': True}),
                              (self.s.agent_runs, {'url': JOB['url'], 'ats': 'workday'})):
            put = table.put({**values, 'created_at': '2026-09-04T00:00:00+00:00'})
            self.assertEqual({k: put[k] for k in values}, values)

    # Events

    def test_events_are_listed_by_job_and_kind_and_archived(self):
        app = self.s.applications.create(JOB, 'Applied')
        first = self.s.events.add(app['id'], 'Applied', '2026-10-01', source='app')
        self.assertRecord(first, base.EVENT_FIELDS)
        self.s.events.add(app['id'], 'Interview', '2026-10-05', interview_at='2026-10-08T10:00')
        self.assertEqual(len(self.s.events.list(app_id=app['id'])), 2)
        self.assertEqual([e['kind'] for e in self.s.events.list(kind='Interview')], ['Interview'])
        self.assertEqual(self.s.events.archive(app['id'], 'Interview'), 1)
        self.assertEqual([e['kind'] for e in self.s.events.list(app_id=app['id'])], ['Applied'])

    def test_an_event_with_a_source_id_is_added_once(self):
        app = self.s.applications.create(JOB, 'Applied')
        one = self.s.events.add(app['id'], 'Rejected', '2026-10-02', source='gmail', source_id='mail-1')
        two = self.s.events.add(app['id'], 'Rejected', '2026-10-02', source='gmail', source_id='mail-1')
        self.assertEqual(one['id'], two['id'])
        self.assertEqual(len(self.s.events.list(source_id='mail-1')), 1)

    def test_an_event_is_updated_and_keeps_what_it_moved_beside_its_interview_time(self):
        app = self.s.applications.create(JOB, 'Applied')
        event = self.s.events.add(app['id'], 'Interview scheduled', '2026-10-02', source='Notion edit',
                                  interview_at='2026-10-08T10:00:00+02:00')
        moved = {'fields': {'stage': ['Applied', 'Interview scheduled']}, 'from': 'Ana <ana@acme.test>', 'subject': 'Our call'}
        updated = self.s.events.update(event['id'], {'source_id': 'mail-2', 'source': 'Gmail', 'changes': moved})
        self.assertRecord(updated, base.EVENT_FIELDS)
        again = self.s.events.list(source_id='mail-2')[0]
        self.assertEqual((again['id'], again['source'], again['changes'], again['interview_at']),
                         (event['id'], 'Gmail', moved, '2026-10-08T10:00:00+02:00'))
        with self.assertRaises(KeyError):
            self.s.events.update(event['id'], {'not_a_field': 1})

    def test_a_question_on_no_job_is_found_by_its_source_id_and_listed_under_no_job(self):
        app = self.s.applications.create(JOB, 'Applied')
        self.s.events.add(app['id'], 'Applied', '2026-10-01')
        first = self.s.events.add('', 'Interview invite', '2026-10-03', source='Gmail', source_id='mail-9', needs_you=True)
        again = self.s.events.add('', 'Interview invite', '2026-10-03', source='Gmail', source_id='mail-9', needs_you=True)
        self.assertEqual(first['id'], again['id'])
        self.assertEqual([e['id'] for e in self.s.events.list(app_id='')], [first['id']])

    def test_an_event_is_read_by_its_id_and_a_missing_or_archived_one_is_none(self):
        app = self.s.applications.create(JOB, 'Applied')
        asked = self.s.events.add('', 'Interview invite', '2026-10-03T09:00:00+00:00', source='Gmail', source_id='mail-4', needs_you=True,
                                  changes={'fields': {}, 'from': 'Ana <ana@acme.test>', 'subject': 'Our call'})
        found = self.s.events.get(asked['id'])
        self.assertRecord(found, base.EVENT_FIELDS)
        self.assertEqual((found['id'], found['kind'], found['changes']['subject']), (asked['id'], 'Interview invite', 'Our call'))
        self.assertIsNone(self.s.events.get('no-such-event'))
        done = self.s.events.add(app['id'], 'Offer', '2026-10-04')
        self.s.events.archive(app['id'], 'Offer')
        self.assertIsNone(self.s.events.get(done['id']))

    def test_a_question_is_an_event_on_no_job_with_the_job_it_would_pick(self):
        self.s.applications.create(JOB, 'Applied')
        asked = self.s.events.add('', 'Rejected', '2026-10-03T09:00:00+00:00', source='Gmail', source_id='mail-3', needs_you=True,
                                  suggested_job=JOB['url'], changes={'fields': {}, 'subject': 'Your application'})
        found = self.s.events.list(source_id='mail-3')[0]
        self.assertEqual((found['id'], found['app_id'], bool(found['needs_you']), found['suggested_job']),
                         (asked['id'], '', True, JOB['url']))
        self.assertEqual(found['changes']['subject'], 'Your application')

    # Matches

    def test_a_match_is_upserted_by_url_and_its_status_set(self):
        row = self.s.matches.upsert({**JOB, 'fit': 70, 'status': 'New'})
        self.assertRecord(row, base.MATCH_FIELDS)
        self.s.matches.upsert({**JOB, 'url': JOB['url'] + '/', 'fit': 85})
        self.assertEqual([(m['fit'], m['status']) for m in self.s.matches.list()], [(85, 'New')])
        self.assertEqual(self.s.matches.get(JOB['url'] + '/')['fit'], 85)   # by its key, whatever the slash
        self.assertTrue(row['id'])
        self.assertEqual([m['id'] for m in self.s.matches.list()], [row['id']], 'one id, kept by an update')
        self.assertEqual(self.s.matches.get(JOB['url'])['id'], row['id'])
        self.assertEqual(self.s.matches.upsert({**JOB, 'id': 'from-another-store', 'fit': 86})['id'], row['id'], 'a store keeps its own ids')
        self.assertIsNone(self.s.matches.get('https://jobs.example/never-found'))
        self.s.matches.set_status(JOB['url'], 'Dismissed')
        self.assertEqual(len(self.s.matches.list(status='Dismissed')), 1)
        self.s.matches.remove(JOB['url'])
        self.assertEqual(self.s.matches.list(), [])

    def test_clear_removes_every_match_but_the_kept_ones_and_a_cleared_job_comes_back_new(self):
        keep, drop, other = JOB, {**JOB, 'url': 'https://jobs.example/drop'}, {**JOB, 'url': 'https://jobs.example/other'}
        for job in (keep, drop, other):
            self.s.matches.upsert({**job, 'fit': 70, 'status': 'Open'})
        self.s.matches.set_status(other['url'], 'Dismissed')
        self.s.applications.create(keep, 'Applied')
        self.s.applications.set_section(self.s.applications.get(keep['url'])['id'], 'Kit', 'my kit')
        cleared = self.s.matches.clear(keep_urls=[keep['url'] + '/'])    # kept by its key, whatever the slash
        self.assertEqual(cleared, 2)
        self.assertEqual([m['url'].rstrip('/') for m in self.s.matches.list()], [keep['url'].rstrip('/')])
        self.assertEqual(self.s.applications.get(keep['url'])['stage'], 'Applied')
        self.assertEqual(self.s.applications.sections(self.s.applications.get(keep['url'])['id']), {'Kit': 'my kit'})
        self.assertEqual(self.s.matches.clear(keep_urls=[keep['url']]), 0, 'nothing left to clear')
        self.s.matches.upsert({**drop, 'fit': 80, 'status': 'New'})
        self.assertEqual(self.s.matches.get(drop['url'])['status'], 'New', 'found again, it is new')

    def test_a_searchs_scored_jobs_sync_into_matches_with_their_statuses(self):
        import sqlite3
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row   # the search's job cache, where an adapter may keep its own sync state
        a, b, c = (scored(f'https://jobs.example/{n}', score) for n, score in (('a', 80), ('b', 60), ('c', 70)))
        copy_of_a = {**a, 'url': a['url'] + '/', 'fit': {**a['fit'], 'score': 50}}
        self.assertEqual(self.s.matches.sync(db, [a, copy_of_a, b], applied_urls={b['url']}), 'Job Matches: 2 created, 0 updated')
        got = {m['url'].rstrip('/'): m for m in self.s.matches.list()}
        self.assertEqual({u: (m['fit'], m['status']) for u, m in got.items()},
                         {a['url']: (80, 'Open'), b['url']: (60, 'Applied')})   # one row per job, its best copy
        self.assertEqual(got[a['url']]['fit_detail']['strengths'], 'Kubernetes; on call')
        self.assertEqual(self.s.matches.sync(db, [a, b], applied_urls={b['url']}), 'Job Matches: 0 created, 0 updated')
        self.s.matches.sync(db, [c], partial=True)              # while scoring: the others keep their status
        self.assertEqual(len(self.s.matches.list(status='Open')), 2)
        self.s.matches.sync(db, [c], open_urls={c['url']}, dismissed_urls={a['url']})
        self.assertEqual({m['url'].rstrip('/'): m['status'] for m in self.s.matches.list()},
                         {a['url']: 'Dismissed', b['url']: 'Not seen', c['url']: 'Open'})

    def test_a_matchs_scoring_facts_are_kept_as_the_job_matches_columns_hold_them(self):
        import sqlite3
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        job = {**scored('https://jobs.example/facts', 81), 'ai': AI}
        self.s.matches.sync(db, [job])
        [row] = self.s.matches.list()
        self.assertRecord(row, base.MATCH_FIELDS)
        self.assertEqual({k: row[k] for k in ('tier', 'confidence', 'seniority', 'languages', 'salary', 'recruiter', 'technologies',
                                             'role_family', 'scoring_method', 'work_mode')},
                         {'tier': 'Strong', 'confidence': 'High', 'seniority': 'Senior', 'languages': ['English', 'German +'],
                          'salary': 'CHF 140-160k', 'recruiter': True, 'technologies': 'Kubernetes; Terraform', 'role_family': 'SRE',
                          'scoring_method': 'Current', 'work_mode': 'Hybrid'})
        self.assertEqual(len(row['code']), 8)
        self.assertTrue(row['id'])
        self.assertTrue(row['scored'] and row['last_update'])

    def test_a_match_keeps_which_places_its_score_used_so_the_drawer_can_say_older(self):
        # Locations (17 Oct 2026): one more column on every store, empty for a score made before places were recorded.
        import sqlite3
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        base_job = scored('https://jobs.example/places', 70)
        with_places = {**base_job, 'fit': {**base_job['fit'], 'locations': 'abc123def456'}}
        self.s.matches.sync(db, [with_places])
        [row] = [m for m in self.s.matches.list() if m['url'].rstrip('/') == with_places['url'].rstrip('/')]
        self.assertEqual(row['places'], 'abc123def456')
        older = scored('https://jobs.example/older', 60)
        self.s.matches.sync(db, [older])
        [row] = [m for m in self.s.matches.list() if m['url'].rstrip('/') == older['url'].rstrip('/')]
        self.assertEqual(row['places'], '')

    # Interviews, insights, employers

    def test_an_interview_is_saved_updated_and_archived(self):
        app = self.s.applications.create(JOB, 'Interview')
        row = self.s.interviews.save(None, {'app_id': app['id'], 'title': 'First call', 'transcript': 'A: hi'})
        self.assertRecord(row, base.INTERVIEW_FIELDS)
        self.s.interviews.save(row['id'], {'review': '## Went well'})
        got = self.s.interviews.get(row['id'])
        self.assertEqual((got['transcript'], got['review']), ('A: hi', '## Went well'))
        self.assertEqual(len(self.s.interviews.list(app_id=app['id'])), 1)
        self.s.interviews.archive(row['id'])
        self.assertEqual(self.s.interviews.list(), [])

    def test_insight_rows_of_their_own_share_a_day_and_update_in_place(self):
        one = self.s.insights.add({'day': '2026-10-08', 'category': 'Process', 'title': 'A', 'fields': {'sample_size': 4}})
        self.s.insights.add({'day': '2026-10-08', 'category': 'Process', 'title': 'B'})
        self.assertEqual(sorted(i['title'] for i in self.s.insights.list(category='Process')), ['A', 'B'])
        kept = self.s.insights.update(one['id'], {'title': 'A2', 'fields': {'sample_size': 5}})
        self.assertEqual((kept['id'], kept['title'], kept['fields']), (one['id'], 'A2', {'sample_size': 5}))
        with self.assertRaises(KeyError):
            self.s.insights.update('missing', {'title': 'x'})
        with self.assertRaises(KeyError):
            self.s.insights.add({'day': '2026-10-08', 'category': 'Process', 'title': 'C', 'fields': {'colour': 'red'}})
        self.s.insights.save('2026-10-08', 'daily', 'D', 'b')
        self.s.insights.save('2026-10-08', 'daily', 'D2', 'c')
        self.assertEqual([i['title'] for i in self.s.insights.list(category='daily')], ['D2'])

    def test_an_answer_to_a_suggestion_is_kept_with_its_row(self):
        """Not now / Not true (spec 2026-10-28-insights-with-actions, criterion 3): kept in the active store, read back by a fresh listing.
        A finding carries its own answer; a computed suggestion gets a row only when answered, keyed by its evidence."""
        week = self.s.insights.save('2026-10-27', 'Weekly report', 'W', 'b', {'action': 'Apply within 3 days of posting'})
        self.s.insights.update(week['id'], {'fields': {**week['fields'], 'state': 'Not now', 'hidden_until': '2026-11-10'}})
        answer = self.s.insights.add({'day': '2026-10-28', 'category': 'Suggestion', 'title': '2 changes your results support',
                                      'fields': {'state': 'Not true', 'input_hash': 'tune:drop_place:Paris'}})
        listed = {i['id']: i['fields'] for i in self.s.insights.list()}
        self.assertEqual((listed[week['id']]['state'], listed[week['id']]['hidden_until'][:10]), ('Not now', '2026-11-10'))
        self.assertEqual(listed[week['id']]['action'], 'Apply within 3 days of posting', 'the answer keeps the row\'s other fields')
        self.assertEqual((listed[answer['id']]['state'], listed[answer['id']]['input_hash']), ('Not true', 'tune:drop_place:Paris'))
        with self.assertRaises(ValueError):
            self.s.insights.add({'day': '2026-10-28', 'category': 'Suggestion', 'title': 'x', 'fields': {'state': 'Maybe'}})

    def test_one_insight_per_day_and_category_newest_first(self):
        self.s.insights.save('2026-10-07', 'daily', 'Old', 'a')
        self.s.insights.save('2026-10-08', 'daily', 'New', 'b')
        again = self.s.insights.save('2026-10-08', 'daily', 'Newer', 'c', {'sample_size': 3})
        self.assertRecord(again, base.INSIGHT_FIELDS)
        self.assertEqual([i['title'] for i in self.s.insights.list(category='daily')], ['Newer', 'Old'])
        self.assertEqual([i['title'] for i in self.s.insights.list(since='2026-10-08')], ['Newer'])
        self.assertEqual(len(self.s.insights.list(limit=1)), 1)

    def test_an_employer_is_added_once_by_name(self):
        row = self.s.employers.add({'name': 'Acme', 'careers_url': 'https://acme.example/jobs'})
        self.assertRecord(row, base.EMPLOYER_FIELDS)
        self.s.employers.add({'name': 'ACME'})
        self.assertEqual([e['name'] for e in self.s.employers.list()], ['Acme'])

    def test_find_employers_re_check_updates_the_one_row_by_name(self):
        first = self.s.employers.upsert({'name': 'Acme', 'tier': 'Tier 2', 'feed_status': 'Not checked'})
        again = self.s.employers.upsert({'name': 'ACME', 'ats': 'greenhouse', 'slug': 'acme', 'feed_status': 'Feed found', 'quality': 71})
        self.assertEqual(first['id'], again['id'])
        self.assertEqual((again['name'], again['tier'], again['ats'], again['quality']), ('Acme', 'Tier 2', 'greenhouse', 71))
        self.assertEqual(len(self.s.employers.list(active=None)), 1)
        with self.assertRaises(KeyError):
            self.s.employers.upsert({'name': 'Acme', 'not a field': 1})

    # Texts and the adapter

    def test_texts_are_whole_markdown_by_name_and_unknown_names_refused(self):
        self.assertEqual(self.s.texts.get('profile'), '')
        self.s.texts.set('profile', '# Igor\n\nSRE')
        self.s.texts.set('answers', 'Notice: 3 months')
        self.assertEqual((self.s.texts.get('profile'), self.s.texts.get('answers')), ('# Igor\n\nSRE', 'Notice: 3 months'))
        with self.assertRaises(KeyError):
            self.s.texts.get('search_settings')

    def test_plain_text_is_the_text_as_its_page_reads(self):
        """What the AI reads (scoring, kits): the same words, as the page shows them (Notion: Tracker.page_text)."""
        self.assertEqual(self.s.texts.plain('profile'), '')
        self.s.texts.set('profile', '# Igor\n\nSRE in Zurich')
        plain = self.s.texts.plain('profile')
        self.assertIn('Igor', plain)
        self.assertIn('SRE in Zurich', plain)
        with self.assertRaises(KeyError):
            self.s.texts.plain('search_settings')

    def test_the_adapter_names_itself_and_its_capabilities(self):
        self.assertTrue(self.s.name)
        self.assertLessEqual(set(self.s.caps), {base.LINKS, base.CLOUD, base.FILES})
        link = self.s.link(self.s.applications.create(JOB, 'Saved')['id'])
        self.assertEqual(link is not None, base.LINKS in self.s.caps)
