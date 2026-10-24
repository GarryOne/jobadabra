"""An interview time keeps its local clock and zone, so it means the same instant before and after a clock change.
Guards src/tz.py local_iso with src/ai/mail_inbox.py and the dedupe in src/stores/rules.py (mail vs calendar, SQLite and Notion).
24 Oct 2026: a mail's time was saved with the summer +02:00; after 25 Oct it showed 09:00 against the calendar's 10:00, as two cards."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import tz
from src.ai import mail
from src.ai.mail_record import record
from src.stores import sqlite
from tests import zone
from tests.mail_fakes import FakeClient, FakeGoogle, FakeTracker, MailCase, app, email, result

setUpModule, tearDownModule = zone.pinned()

NOW = datetime(2026, 10, 20, 16, 0, tzinfo=timezone.utc)  # a week before the interview, after the clock change on 25 Oct
WALL = '2026-10-27T10:00:00'  # 10:00 in Zurich: +01:00 by then (winter time)


class LocalIsoTests(unittest.TestCase):
    def test_the_offset_is_the_one_of_the_interviews_own_date(self):
        self.assertEqual(tz.local_iso('2026-10-20T10:00:00', 'Europe/Zurich'), '2026-10-20T10:00:00+02:00')
        self.assertEqual(tz.local_iso(WALL, 'Europe/Zurich'), '2026-10-27T10:00:00+01:00')

    def test_a_fixed_offset_the_reader_guessed_is_replaced_when_a_zone_is_named(self):
        self.assertEqual(tz.local_iso('2026-10-27T10:00:00+02:00', 'Europe/Zurich'), '2026-10-27T10:00:00+01:00')

    def test_another_zone_keeps_its_own_clock(self):
        self.assertEqual(tz.local_iso('2026-10-27T15:00:00', 'America/New_York'), '2026-10-27T15:00:00-04:00')

    def test_no_zone_means_the_owners_and_an_offset_without_a_zone_is_kept(self):
        self.assertEqual(tz.local_iso(WALL, ''), '2026-10-27T10:00:00+01:00')
        self.assertEqual(tz.local_iso('2026-10-27T10:00:00+05:30', ''), '2026-10-27T10:00:00+05:30')

    def test_an_unknown_zone_or_no_time_is_not_made_up(self):
        self.assertEqual(tz.local_iso(WALL, 'Not/AZone'), '2026-10-27T10:00:00+01:00')
        self.assertEqual(tz.local_iso('', 'Europe/Zurich'), '')
        self.assertEqual(tz.local_iso('someday', 'Europe/Zurich'), 'someday')


class MailAndCalendarAreOneInterviewTests(MailCase):
    def test_a_mail_time_and_the_calendar_entry_after_the_clock_change_are_one_card(self):
        job = app('p1', 'Northwind Health', 'Platform Engineer', stage='Applied')
        tracker = FakeTracker([job])
        google = FakeGoogle([email('m1', 'Interview with Northwind Health', '2026-10-20T08:00:00+02:00',
                                   sender='talent@northwind.test', body='Northwind Health: interview on 27 Oct at 10:00.')])
        # The reader gave today's summer offset for a winter date (the bug); with the zone named, the code works out the right one.
        said = {**result(0, 0, 'Interview scheduled', interview_at=WALL + '+02:00', company='Northwind Health'),
                'interview_zone': 'Europe/Zurich'}
        self.run_mail_at(tracker, google, [[said]])
        stored = dict(tracker.updates)['p1']['Next interview']['date']['start']
        self.assertEqual(stored, '2026-10-27T10:00:00+01:00')
        start = datetime(2026, 10, 27, 10, 0, tzinfo=tz.local_zone())
        event = {'id': 'e1', 'status': 'confirmed', 'summary': 'Interview with Northwind Health',
                 'created': '2026-10-20T09:00:00Z', 'start': {'dateTime': start.isoformat()},
                 'end': {'dateTime': (start + timedelta(minutes=45)).isoformat()}}
        self.run_mail_at(tracker, FakeGoogle(events=[event]), [], calendar=True)
        kinds = [p['Kind']['select']['name'] for p in tracker.created]
        self.assertEqual(kinds.count('Interview scheduled'), 1)  # the calendar entry is the same interview

    def run_mail_at(self, tracker, google, results, calendar=False):
        from unittest import mock
        with mock.patch('src.ai.mail_calendar.interview_stats', lambda s: {'topics_answered_weakly': {}}):
            return mail.run(tracker, google, client=FakeClient(results), days=2, send=lambda m: None, calendar=calendar,
                            now=NOW, state_path=self.state, stats={})


class PastedMessageTests(unittest.TestCase):
    def test_a_pasted_messages_time_gets_the_offset_of_its_own_date(self):
        import json
        from types import SimpleNamespace
        from src.ai import inbox_reading
        reading = {'interview_at': WALL + '+02:00', 'interview_zone': 'Europe/Zurich'}
        block = SimpleNamespace(type='text', text=json.dumps(reading))
        client = SimpleNamespace(messages=SimpleNamespace(create=lambda **kw: SimpleNamespace(
            content=[block], usage=SimpleNamespace(input_tokens=1, output_tokens=1, cache_read_input_tokens=0, cache_creation_input_tokens=0))))
        self.assertEqual(inbox_reading.read(client, 'm', 'hi', None, [])['interview_at'], '2026-10-27T10:00:00+01:00')


class SqliteDedupeTests(unittest.TestCase):
    def test_the_same_interview_from_mail_and_calendar_is_one_event_on_the_sqlite_store(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, True)
        store = sqlite.open_store({'JOB_PILOTTO_DATA_DIR': str(folder)})
        row = store.applications.create({'url': 'https://example.test/j/1', 'company': 'Northwind Health', 'title': 'Platform Engineer'}, 'Applied')
        index = (set(), {}, set())
        winter = tz.local_iso(WALL, 'Europe/Zurich')
        record(store, row, 'Interview scheduled', '2026-10-20T08:00:00+02:00', 'Gmail', 'm1', 'mail', index, winter, NOW)
        record(store, row, 'Interview scheduled', '2026-10-20T09:00:00+00:00', 'Calendar', 'cal:e1', 'cal', index,
               datetime(2026, 10, 27, 10, 0, tzinfo=tz.local_zone()).isoformat(), NOW)
        events = [e for e in store.events.list(app_id=row['id']) if e['kind'] == 'Interview scheduled']
        self.assertEqual(len(events), 1)
        self.assertEqual(store.applications.get('https://example.test/j/1')['next_interview'][:19], WALL)


if __name__ == '__main__':
    unittest.main()
