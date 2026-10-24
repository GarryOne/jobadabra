"""The ledger on the store (src/ledger_store.py): the commands on the memory store, and Notion parity on the stand-in
(the record's blocks and an event's row are today's)."""
import json
import os
import unittest
from contextlib import redirect_stdout
from datetime import date, datetime, timedelta, timezone
from io import StringIO
from unittest import mock

from src import ledger_store
from src.notion import ledger
from src.notion.ledger_record import RECORD_HEADING, record_blocks
from src.stores import memory

URL = 'https://boards.greenhouse.io/acme/jobs/1'
NOW = datetime(2026, 10, 9, 12, 0, tzinfo=timezone.utc)
KIT = {'version': 2, 'cover_letter': 'Dear Acme,\n\nHello.', 'answers': [{'question': 'Why us?', 'answer': 'Because.'}]}
POSTING = lambda _url: {'description': 'Run the platform.'}  # noqa: E731
QUIET = {'snapshot_dir': '/nonexistent', 'run_dir': '/nonexistent', 'posting': POSTING, 'cv_path': '/nonexistent'}


def stores_with(stage='Kit ready', **fields):
    stores = memory.open_store()
    app = stores.applications.create({'url': URL, 'title': 'SRE', 'company': 'Acme', 'posted': '2026-10-01', **fields}, stage)
    stores.applications.set_section(app['id'], '📝 Application kit', f'Intro\n\n```json\n{json.dumps(KIT)}\n```')
    return stores, app


class MarkAppliedTests(unittest.TestCase):
    def test_marks_logs_and_freezes_the_record_once(self):
        stores, app = stores_with()
        out = ledger_store.mark_applied(stores, URL, 'Telegram', today=date(2026, 10, 9), **QUIET)
        self.assertEqual(out.splitlines(), [f'{URL}: updated', 'application record: recorded'])
        app = stores.applications.get(URL)
        self.assertEqual((app['stage'], app['applied_on'], app['ats'], app['questions'], app['cover_letter'],
                          app['answers_captured'], app['kit_variant'], app['days_to_apply'], app['channel']),
                         ('Applied', '2026-10-09', 'Greenhouse', 1, True, 'Kit draft', 'v2', 8, 'Direct'))
        [event] = stores.events.list(app_id=app['id'])
        self.assertEqual((event['kind'], event['at'], event['source']), ('Applied', '2026-10-09', 'Telegram'))
        section = stores.applications.section(app['id'], RECORD_HEADING)
        self.assertIn('Why us?', section)
        self.assertIn('"cover_letter": "Dear Acme,', section)
        again = ledger_store.mark_applied(stores, URL, 'Telegram', **QUIET)
        self.assertEqual(again.splitlines(), [f'{URL}: unchanged', 'application record: exists'])
        self.assertEqual(len(stores.events.list()), 1)

    def test_a_job_not_tracked_yet_is_created_at_applied(self):
        stores = memory.open_store()
        out = ledger_store.mark_applied(stores, URL, **QUIET)
        self.assertEqual(out.splitlines()[0], f'{URL}: created')
        self.assertEqual(stores.applications.get(URL)['stage'], 'Applied')


class SetStageTests(unittest.TestCase):
    def test_a_stage_moves_and_logs_a_reply_only_logs(self):
        stores, app = stores_with('Applied')
        self.assertEqual(ledger_store.set_stage(stores, URL, 'Screening', note='Call'), f'{URL}: Screening')
        ledger_store.set_stage(stores, URL, ledger.REPLY)
        self.assertEqual(stores.applications.get(URL)['stage'], 'Screening')
        self.assertEqual([(e['kind'], e['note']) for e in stores.events.list(app_id=app['id'])],
                         [('Screening', 'Call'), (ledger.REPLY, '')])

    def test_a_rejection_after_screening_awaits_a_feedback_request(self):
        stores, _ = stores_with('Screening')
        ledger_store.set_stage(stores, URL, 'Rejected')
        self.assertEqual(stores.applications.get(URL)['feedback_status'], 'Not asked')
        stores, _ = stores_with('Applied')
        ledger_store.set_stage(stores, URL, 'Rejected')
        self.assertEqual(stores.applications.get(URL)['feedback_status'], '')

    def test_unknown_stage_and_missing_job_are_refused(self):
        stores, _ = stores_with()
        with self.assertRaises(ValueError):
            ledger_store.set_stage(stores, URL, 'Saved')
        with self.assertRaises(LookupError):
            ledger_store.set_stage(stores, 'https://x.test/none', 'Screening')


class EventTests(unittest.TestCase):
    def test_the_same_message_or_occurrence_is_logged_once(self):
        stores, app = stores_with('Applied')
        other = stores.applications.create({'url': 'https://x.test/2'}, 'Applied')
        first = ledger_store.add_event(stores, app, ledger.REPLY, 'Gmail', source_id='m1')
        self.assertTrue(ledger_store.add_event(stores, other, ledger.REPLY, 'Gmail', source_id='m1')['_existing'])
        self.assertEqual(first['source_id'], 'm1')
        ledger_store.add_event(stores, app, 'Screening', 'Gmail', at='2026-10-01T09:00:00+00:00')
        self.assertTrue(ledger_store.add_event(stores, app, 'Screening', 'CLI', at='2026-10-01T15:00:00+00:00')['_existing'])
        self.assertNotIn('_existing', ledger_store.add_event(stores, app, 'Screening', 'CLI', at='2026-10-05T09:00:00+00:00'))

    def test_another_interview_time_is_another_event(self):
        stores, app = stores_with('Applied')
        soon = datetime.now(timezone.utc).replace(microsecond=0)
        at = lambda days: (soon + timedelta(days=days)).isoformat()  # noqa: E731
        ledger_store.add_event(stores, app, 'Interview scheduled', 'Gmail', interview_at=at(2))
        self.assertTrue(ledger_store.add_event(stores, app, 'Interview scheduled', 'Gmail', interview_at=at(2))['_existing'])
        self.assertNotIn('_existing', ledger_store.add_event(stores, app, 'Interview scheduled', 'Gmail', interview_at=at(5)))
        self.assertEqual(ledger_store.archive_events(stores, app, 'Interview scheduled'), 2)
        self.assertEqual(stores.events.list(app_id=app['id']), [])


class AddApplicationTests(unittest.TestCase):
    def test_tracks_an_outside_application_with_its_date_and_record(self):
        stores = memory.open_store()
        found = {}
        line = ledger_store.add_application(stores, URL, applied=date(2026, 9, 23), approx=True, source='Telegram',
                                            meta={'title': 'SRE', 'company': 'Acme', 'description': 'x'}, found=found)
        self.assertEqual(line, 'Tracked: SRE — Acme, applied on or before 2026-09-23 (Direct); recorded')
        app = found['row']
        self.assertTrue(found['created'])
        self.assertEqual((app['stage'], app['applied_on'], app['date_approximate'], app['origin'], app['source']),
                         ('Applied', '2026-09-23', True, 'Outbound', 'Telegram'))
        [event] = stores.events.list(app_id=app['id'])
        self.assertEqual((event['kind'], event['at']), ('Applied', '2026-09-23'))
        self.assertTrue(stores.applications.get(URL)['recorded'])

    def test_a_later_stage_is_left_as_it_is(self):
        stores, _ = stores_with('Screening')
        self.assertEqual(ledger_store.add_application(stores, URL, meta={'title': 'SRE'}), 'Already tracked at Screening: SRE')


class CompanyForTests(unittest.TestCase):
    def test_the_employer_without_a_match_or_a_named_company(self):
        """/add <job URL> for a page that names no company (a sign-in wall) and a job never scored: the board's slug, else nothing;
        never a crash (the Notion path's match_for has always taken a missing row)."""
        stores = memory.open_store()
        self.assertEqual(ledger_store.company_for(stores, 'https://boards.greenhouse.io/acme-corp/jobs/1', {}), 'Acme Corp')
        self.assertEqual(ledger_store.company_for(stores, 'https://x.test/1', {}), '')
        self.assertEqual(ledger_store.company_for(stores, 'https://x.test/1', {'company': 'Named'}), 'Named')


class ScheduledTests(unittest.TestCase):
    def test_sync_logs_a_hand_set_stage_and_moves_silent_ones_to_no_response(self):
        stores, app = stores_with('Screening')
        silent = stores.applications.create({'url': 'https://x.test/old', 'applied_on': '2026-08-01'}, 'Applied')
        stores.events.add(silent['id'], 'Applied', '2026-08-01')
        line = ledger_store.sync(stores, now=NOW)
        self.assertEqual(line, 'Ledger sync: 2 applications, 1 stage change(s) logged, 1 moved to No response.')
        [logged] = stores.events.list(app_id=app['id'])
        self.assertEqual((logged['kind'], logged['source'], logged['at']), ('Screening', 'Backfill', stores.applications.get(URL)['updated_at']))
        self.assertEqual(stores.applications.get('https://x.test/old')['stage'], 'No response')
        self.assertIn('No response', [e['kind'] for e in stores.events.list(app_id=silent['id'])])

    def test_close_gone_closes_only_a_taken_down_saved_job(self):
        stores, _ = stores_with('Saved')
        stores.applications.create({'url': 'https://x.test/live', 'title': 'Live'}, 'Kit ready')
        with mock.patch.object(ledger_store.ats, 'is_live', side_effect=lambda url, company: url != URL), redirect_stdout(StringIO()):
            line, closed = ledger_store.close_gone(stores)
        self.assertEqual((line, closed), ('Taken-down postings: 2 saved/kit-ready job(s), 1 closed.', ['SRE (Acme)']))
        self.assertEqual(stores.applications.get(URL)['stage'], 'Closed')


class CommandTests(unittest.TestCase):
    def test_the_event_command_runs_on_the_sqlite_store(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict(os.environ, {'JOB_PILOTTO_STORE': 'sqlite',
                                                                                   'JOB_PILOTTO_DATA_DIR': folder}):
            from src.stores import open_stores
            stores = open_stores()
            if not str(getattr(stores.applications, 'file_root', '')).startswith(folder):
                self.skipTest('the sqlite store does not take JOB_PILOTTO_DATA_DIR')
            stores.applications.create({'url': URL, 'title': 'SRE'}, 'Applied')
            out = StringIO()
            with redirect_stdout(out):
                ledger.main(['event', URL, 'Screening', '--note', 'Marked in Jobadabra'])
            self.assertEqual(out.getvalue().strip(), f'{URL}: Screening')
            self.assertEqual(open_stores().applications.get(URL)['stage'], 'Screening')


class RecordMarkdownTests(unittest.TestCase):
    def test_the_section_reads_back_as_todays_blocks(self):
        """Notion parity of the frozen record: the store's Markdown, through the codec, is record_blocks' children."""
        from src.notion.ledger_record import build_fields, record_markdown
        from src.stores.notion_blocks import to_blocks
        _, data = build_fields(URL, {'title': 'SRE *lead*', 'company': 'A&B', 'applied_on': '2026-10-09'},
                               {**KIT, 'answers': [{'question': '- Why `us`?', 'answer': 'Line one\nLine two'}]},
                               {'Score': 80}, POSTING(URL), None, None, 'cv.pdf · 1', NOW)
        shape = lambda blocks: [(b['type'], ''.join(p['text']['content'] for p in b[b['type']]['rich_text']),  # noqa: E731
                                 any((p.get('annotations') or {}).get('bold') for p in b[b['type']]['rich_text']))
                                for b in blocks]
        self.assertEqual(shape(to_blocks(record_markdown(data))), shape(record_blocks(data)['heading_2']['children']))


if __name__ == '__main__':
    unittest.main()


from tests import test_store_notion as stand_in  # noqa: E402


@unittest.skipUnless(stand_in.shutil.which('node'), 'node runs the Notion stand-in')
class NotionParityTests(unittest.TestCase):
    """On the Notion stand-in: the store path writes today's event row and today's record blocks."""
    setUpClass = classmethod(stand_in.NotionStoreTests.setUpClass.__func__)
    tearDownClass = classmethod(stand_in.NotionStoreTests.tearDownClass.__func__)
    make = stand_in.NotionStoreTests.make

    def setUp(self):
        self.s = self.make()

    def _props(self, page_id):
        props = self.tracker._request('GET', f'pages/{page_id}')['properties']
        return {name: ledger.plain(value) for name, value in props.items()
                if name not in ('Created', 'Changes') and ledger.plain(value) not in (None, '', [], False)}

    def test_an_event_row_is_todays(self):
        app = self.s.applications.create({'url': URL, 'title': 'SRE', 'company': 'Acme'}, 'Applied')
        page = self.tracker._request('GET', f"pages/{app['id']}")
        with mock.patch.object(ledger, 'EVENTS_DATABASE_ID', self.s.events.database_id):
            old = ledger.add_event(self.tracker, page, 'Screening', 'Gmail', at='2026-10-01T09:00:00+00:00', note='n',
                                   source_id='m1')
        new = ledger_store.add_event(self.s, app, 'Screening', 'Gmail', at='2026-10-05T09:00:00+00:00', note='n',
                                     source_id='m2')
        want = {**self._props(old['id']), 'At': '2026-10-05T09:00:00+00:00', 'Source ID': 'm2'}
        self.assertEqual(self._props(new['id']), want)

    def test_the_record_section_is_todays_toggle(self):
        app = self.s.applications.create({'url': URL, 'title': 'SRE', 'company': 'Acme'}, 'Kit ready')
        from src.notion import client
        with mock.patch.object(client, 'MATCHES_DATABASE_ID', ''):  # no Job Matches database in this stand-in
            out = ledger_store.mark_applied(self.s, URL, 'CLI', today=date(2026, 10, 9), now=NOW, **QUIET)
        self.assertEqual(out.splitlines()[1], 'application record: recorded')
        [heading] = [b for b in self.tracker._children(app['id']) if not b.get('archived')]
        self.assertEqual((heading['type'], heading['heading_2'].get('is_toggleable')), ('heading_2', True))
        self.assertEqual(ledger.plain({'type': 'title', 'title': heading['heading_2']['rich_text']}), RECORD_HEADING)
        text = lambda b: ''.join(p.get('plain_text') or p['text']['content'] for p in b[b['type']]['rich_text'])  # noqa: E731
        kids = [(b['type'], text(b)) for b in self.tracker._children(heading['id'])]
        record = json.loads(kids[-1][1])
        self.assertEqual(kids, [(b['type'], text(b)) for b in record_blocks(record)['heading_2']['children']])
        self.assertEqual(self._props(app['id'])['Stage'], 'Applied')
        self.assertEqual([e['kind'] for e in self.s.events.list(app_id=app['id'])], ['Applied'])
