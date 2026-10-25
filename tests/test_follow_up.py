"""Who wrote last, and when: learned from every logged chat/email and your sent Gmail, so Focus can say "follow up".

The real case (30 Sep 2026, a Wednesday): a LinkedIn screenshot of the Duvo.ai recruiter's chat, a day divider
"MONDAY", his first message at 12:33 AM, the owner's reply after it (the last message). The job was already
tracked (Screening): the confirm step asked "When did it start?" although MONDAY was written, and defaulted
"What is it?" to "First contact".
"""
import io
import sys
import unittest
from contextlib import redirect_stdout
from datetime import date, datetime, timezone
from unittest import mock

from src import focus
from src.ai import inbox, mail
from src.notion import cron_runs
from tests.test_focus import event as focus_event, reviewed_interview, row as focus_row
from tests.test_inbox import Inbox, SHOT, job, reading, row
from tests.test_mail import FakeGoogle, FakeTracker, app
from tests.mail_fakes import rec, stores_for
from tests.test_opportunity import Client
from tests import zone

setUpModule, tearDownModule = zone.pinned()

WEDNESDAY = date(2026, 9, 30)
NOW = datetime(2026, 9, 30, 9, 0, tzinfo=timezone.utc)
SEEN = {'channel': 'shown', 'year': 'missing', 'first_contact': 'shown', 'interview': 'none', 'company': 'shown'}


def duvo_chat(**extra):
    """Claude's reading of the Duvo.ai screenshot: the owner wrote last, under the MONDAY divider."""
    last = extra.pop('last', {'from': 'you', 'at': '', 'at_text': 'MONDAY 10:05 AM',
                              'text_snippet': 'Hi Márton, thanks for reaching out! Happy to have a call this week.'})
    return reading('Recruiter outreach', extra.pop('match', 0), platform='LinkedIn', seen=dict(SEEN, **extra.pop('seen', {})),
                   company='Duvo.ai', role='Senior SRE', first_contact='2024-09-28T00:33:00+00:00',
                   first_contact_text='MONDAY 12:33 AM', interview_text='', last_message=last, salary='', location='', **extra)


def duvo_tracker(events=()):
    return Inbox([row('d1', 'https://duvo.test/sre', 'Senior SRE', 'Duvo.ai', stage='Screening')],
                 [job('https://duvo.test/sre', 'Senior SRE', 'Duvo.ai', 'Screening', contact='Márton Szabó')], events)


class ResolveDayTest(unittest.TestCase):
    def test_the_real_case_monday_is_the_28th(self):
        self.assertEqual(WEDNESDAY.weekday(), 2)
        found = inbox.resolve_day('MONDAY 12:33 AM', WEDNESDAY)
        self.assertEqual((found['date'], found['time'], found['how']), (date(2026, 9, 28), '00:33', 'relative'))
        self.assertEqual(inbox.resolve_at('MONDAY 12:33 AM', WEDNESDAY), '2026-09-28T00:33:00+02:00')

    def test_day_labels(self):
        day = lambda text: inbox.resolve_day(text, WEDNESDAY)['date']
        self.assertEqual(day('TODAY'), WEDNESDAY)
        self.assertEqual(day('Yesterday 14:02'), date(2026, 9, 29))
        self.assertEqual(day('Wednesday'), WEDNESDAY)  # today itself: never a week back
        self.assertEqual(day('Thu'), date(2026, 9, 24))  # the most recent Thursday, not tomorrow
        self.assertEqual(day('Sun 9:15 pm'), date(2026, 9, 27))
        self.assertEqual(inbox.resolve_day('Sun 9:15 pm', WEDNESDAY)['time'], '21:15')

    def test_a_full_date_is_taken_as_written_never_a_guessed_year(self):
        day = lambda text: inbox.resolve_day(text, WEDNESDAY)['date']
        self.assertEqual(day('28 Sep 2025'), date(2025, 9, 28))
        self.assertEqual(day('September 28, 2026'), date(2026, 9, 28))
        self.assertEqual(day('2026-09-28'), date(2026, 9, 28))
        self.assertEqual(day('28.09.2026 14:02'), date(2026, 9, 28))
        self.assertEqual(day('28/09/2026'), date(2026, 9, 28))
        self.assertIsNone(day('03/04/2026'))  # 3 April or 4 March: unknown, asked
        self.assertIsNone(day('2 Oct 2026'))  # in the future: not a message's day

    def test_a_month_and_day_without_year_only_when_it_can_only_be_last_week(self):
        self.assertEqual(inbox.resolve_day('Sep 28', WEDNESDAY)['date'], date(2026, 9, 28))
        self.assertIsNone(inbox.resolve_day('Sep 21', WEDNESDAY)['date'])  # 9 days: the year is asked
        self.assertIsNone(inbox.resolve_day('Dec 5', WEDNESDAY)['date'])

    def test_unclear_is_unknown(self):
        for text in ('', '10:05 AM', 'last week', 'recently'):
            self.assertIsNone(inbox.resolve_day(text, WEDNESDAY)['date'], text)
        self.assertEqual(inbox.resolve_at('10:05 AM', WEDNESDAY), '')


class ProposeTest(unittest.TestCase):
    def test_the_real_case_asks_nothing_about_dates_and_defaults_to_an_update(self):
        proposal = inbox.propose(stores_for(duvo_tracker()), image=SHOT, client=Client(duvo_chat()), now=NOW)
        fields = proposal['fields']
        self.assertEqual(proposal['kind'], inbox.UPDATE)
        self.assertEqual((fields['kind']['value'], fields['kind']['state']), (inbox.UPDATE, 'ok'))  # no "Please check"
        self.assertEqual(fields['kind']['options'][0], inbox.UPDATE)
        self.assertEqual((fields['started']['value'], fields['started']['state']), ('2026-09-28', 'ok'))
        self.assertNotIn('years', fields['started'])
        self.assertEqual({k: fields['last'][k] for k in ('value', 'state', 'from')}, {'value': '2026-09-28', 'state': 'ok', 'from': 'you'})

    def test_a_new_job_keeps_first_contact_and_has_no_update_choice(self):
        proposal = inbox.propose(stores_for(Inbox()), image=SHOT, client=Client(duvo_chat(match=-1)), now=NOW)
        self.assertEqual(proposal['fields']['kind']['value'], 'Recruiter outreach')
        self.assertNotIn(inbox.UPDATE, proposal['fields']['kind']['options'])

    def test_an_unreadable_last_day_is_asked_never_guessed(self):
        last = {'from': 'you', 'at': '2024-09-28T10:05:00Z', 'at_text': '10:05 AM', 'text_snippet': 'Thanks!'}
        fields = inbox.propose(stores_for(duvo_tracker()), image=SHOT, client=Client(duvo_chat(last=last)), now=NOW)['fields']
        self.assertEqual((fields['last']['value'], fields['last']['state'], fields['last']['question']),
                         ('', 'ask', 'When was the last message?'))

    def test_the_day_you_give_is_used(self):
        last = {'from': 'you', 'at': '', 'at_text': '', 'text_snippet': 'Thanks!'}
        proposal = inbox.propose(stores_for(duvo_tracker()), image=SHOT, client=Client(duvo_chat(last=last)), now=NOW)
        confirmed = inbox.confirm(proposal, kind=inbox.UPDATE, last_at='2026-09-27')
        self.assertEqual(confirmed['item']['last_message']['resolved'], '2026-09-27')


class LastMessageEventTest(unittest.TestCase):
    def log(self, tracker, answer=None):
        proposal = inbox.propose(stores_for(tracker), image=SHOT, client=Client(answer or duvo_chat()), now=NOW)
        return inbox.log(stores_for(tracker), image=SHOT, now=NOW, event_source='Jobadabra app',
                         proposal=inbox.confirm(proposal, kind=inbox.UPDATE, channel='LinkedIn'))

    def test_the_real_case_saves_your_last_message_for_focus(self):
        tracker = duvo_tracker()
        line = self.log(tracker)
        event = next(p for p in tracker.created if p.get('Kind'))
        self.assertEqual(event['Kind'], {'select': {'name': 'Replied'}})
        self.assertEqual(event['At'], {'date': {'start': '2026-09-28T10:05:00+02:00'}})
        self.assertEqual(event['Source'], {'select': {'name': 'Jobadabra app'}})
        self.assertTrue(event['Note']['rich_text'][0]['text']['content'].startswith('You wrote: Hi Márton'))
        self.assertTrue(event['Source ID']['rich_text'][0]['text']['content'].startswith('chat:'))
        self.assertIn('Already tracked: Duvo.ai — Senior SRE (Screening). Nothing new about the job. Your last message was on '
                      'Mon 28 Sep: saved so Focus can remind you to follow up.', line)

    def test_the_same_last_message_twice_is_one_event(self):
        tracker = duvo_tracker()
        self.log(tracker)
        written = next(p for p in tracker.created if p.get('Kind'))
        source_id = written['Source ID']['rich_text'][0]['text']['content']
        tracker.events = [{'id': 'e1', 'properties': {
            'Source ID': {'type': 'rich_text', 'rich_text': [{'plain_text': source_id}]},
            'Kind': {'type': 'select', 'select': {'name': 'Replied'}},
            'Application': {'type': 'relation', 'relation': [{'id': 'd1'}]}}}]
        before = len(tracker.created)
        line = self.log(tracker, duvo_chat())  # another screenshot of the same chat, the same last message
        self.assertEqual(len(tracker.created), before)
        self.assertIn('Nothing new to log', line)

    def test_their_last_message_waits_for_your_answer(self):
        last = {'from': 'them', 'at': '', 'at_text': 'Yesterday 16:40', 'text_snippet': 'Would Thursday work?'}
        tracker = duvo_tracker()
        line = self.log(tracker, duvo_chat(last=last))
        event = next(p for p in tracker.created if p.get('Kind'))
        self.assertEqual(event['Kind'], {'select': {'name': 'Reply received'}})
        self.assertIn('Their last message was on Tue 29 Sep, waiting for your answer', line)

    def test_an_unknown_day_saves_nothing_about_it(self):
        last = {'from': 'you', 'at': '', 'at_text': '', 'text_snippet': 'Thanks!'}
        tracker = duvo_tracker()
        line = self.log(tracker, duvo_chat(last=last))
        self.assertFalse([p for p in tracker.created if p.get('Kind')])
        self.assertIn('Nothing new to log', line)


def sent(message_id, to, date='2026-09-29T10:00:00+02:00', subject='Re: SRE role', labels=('SENT',)):
    return {'id': message_id, 'from': 'me@example.test', 'to': to, 'cc': '', 'subject': subject, 'date': date,
            'body': 'Hi Alex, …', 'labels': list(labels)}


def sent_pass(tracker, google, apps, index, days, stats):
    """The Gmail check's sent pass on the Notion store over `tracker`, its jobs as records."""
    stores = stores_for(tracker)
    return mail.sent_pass(stores, google, [rec(stores, row) for row in apps], index, days, stats)


class SentMailTest(unittest.TestCase):
    def apps(self):
        return [app('p1', '', 'Senior DevOps Engineer', stage='Recruiter lead', via='Example Talent',
                    contact='Alex Morgan · alex@example-talent.test'),
                app('p2', 'Globex', 'SRE', stage='Rejected', contact='Pat · pat@globex.test')]

    def test_your_reply_to_a_known_recruiter_becomes_a_replied_event(self):
        apps = self.apps()
        tracker, google, stats = FakeTracker(apps), FakeGoogle([sent('s1', 'Alex Morgan <alex@example-talent.test>')]), {}
        index = (set(), {}, set())
        self.assertEqual(sent_pass(tracker, google, apps, index, 2, stats), 1)
        self.assertEqual(google.queries, ['in:sent newer_than:2d {to:alex@example-talent.test cc:alex@example-talent.test}'])
        event = tracker.created[0]
        self.assertEqual((event['Kind'], event['Source']), ({'select': {'name': 'Replied'}}, {'select': {'name': 'Gmail'}}))
        self.assertEqual(event['Source ID']['rich_text'][0]['text']['content'], 's1')
        self.assertEqual(event['Note']['rich_text'][0]['text']['content'], 'You replied by email ("Re: SRE role")')
        self.assertEqual(stats['updates'], ['↩️ You replied · Example Talent — Senior DevOps Engineer'])
        self.assertEqual(sent_pass(tracker, google, apps, index, 2, stats), 0)  # already known: never twice

    def test_only_sent_mail_to_one_known_job_counts(self):
        apps = self.apps() + [app('p3', 'Initech', 'SRE', stage='Screening', contact='Alex · alex@example-talent.test')]
        tracker = FakeTracker(apps)
        google = FakeGoogle([sent('s1', 'alex@example-talent.test'), sent('s2', 'x@y.test', labels=('INBOX',))])
        self.assertEqual(sent_pass(tracker, google, apps, (set(), {}, set()), 2, {}), 0)  # two jobs: which one?
        self.assertEqual(tracker.created, [])

    def test_trouble_never_fails_the_check(self):
        class Broken(FakeGoogle):
            def search(self, query, limit=50):
                raise RuntimeError('Gmail is down')
        with mock.patch('sys.stderr', new_callable=io.StringIO) as err:
            self.assertEqual(sent_pass(FakeTracker(self.apps()), Broken(), self.apps(), (set(), {}, set()), 2, {}), 0)
        self.assertIn('your sent emails not checked', err.getvalue())

    def test_no_contacts_no_search(self):
        google = FakeGoogle()
        sent_pass(FakeTracker([]), google, [app('p1', 'Acme', 'SRE')], (set(), {}, set()), 2, {})
        self.assertEqual(google.queries, [])


class FollowUpFocusTest(unittest.TestCase):
    def duvo(self, *events, stage='Screening', **extra):
        rows = [focus_row('d1', 'Duvo.ai', 'Senior SRE', stage=stage, applied=None, **extra)]
        return rows, [focus_event('d1', 'Recruiter lead', '2026-09-28T00:33:00+02:00', 'Pitch', source='Job Pilotto app'),
                      focus_event('d1', 'Replied', '2026-09-28T10:05:00+02:00', 'You wrote: Hi Márton', 'chat:1', 'Job Pilotto app'),
                      *events]

    def items(self, rows, events, now, interviews=()):
        return [i for i in focus.build(rows, events, interviews, now=now)['items'] if i['page_id'] == 'd1']

    def test_the_real_case_follow_up_after_a_day(self):
        rows, events = self.duvo()
        # Monday 18:05: the owner's "Yes"; Wednesday (NOW) it is more than 24 h with no answer.
        [item] = self.items(rows, events, NOW)
        self.assertEqual((item['kind'], item['title'], item['done']), ('follow_up', 'Follow up with Duvo.ai', True))
        self.assertEqual(item['detail'], 'You wrote Mon 28 Sep (2 days ago), no reply yet.')
        self.assertEqual((item['headline'], item['badge'], item['icon']), ('Follow up with Duvo.ai', 'Follow up', 'send'))
        self.assertEqual(item['meta'], ['Senior SRE', 'you wrote Mon 28 Sep', '2 days, no reply'])
        # Not before 24 hours: the same message, 20 hours later, is too early.
        early = datetime(2026, 9, 29, 6, 5, tzinfo=timezone.utc)
        self.assertEqual(self.items(rows, events, early), [])

    def test_a_call_reviewed_since_you_wrote_is_not_still_waiting(self):
        # You wrote Wednesday. Thursday the call happened and you saved the review. "No reply yet" would
        # chase a message the meeting already answered.
        rows, events = self.duvo(stage='Interviewing')
        review = reviewed_interview('d1', '2026-10-01', next_step='Recruiter will pass the details on')
        kinds = [i['kind'] for i in self.items(rows, events, datetime(2026, 10, 1, 14, 0, tzinfo=timezone.utc), [review])]
        self.assertNotIn('follow_up', kinds)
        self.assertIn('waiting', kinds)
        # A review from before that message does not settle it: you wrote again and they still haven't answered.
        older = reviewed_interview('d1', '2026-09-27')
        self.assertEqual(self.items(rows, events, NOW, [older])[0]['kind'], 'follow_up')

    def test_their_later_message_means_no_follow_up(self):
        rows, events = self.duvo(focus_event('d1', 'Reply received', '2026-09-29T09:00:00Z', 'Thursday?', 'gm9', 'Gmail'))
        kinds = [i['kind'] for i in self.items(rows, events, datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc))]
        self.assertNotIn('follow_up', kinds)
        self.assertEqual(kinds, ['reply'])

    def test_done_re_arms_after_another_interval(self):
        rows, events = self.duvo(focus_event('d1', 'Replied', '2026-10-01T10:00:00+02:00', 'You followed up (marked done in Focus)',
                                             source='Job Pilotto app'))
        self.assertEqual(self.items(rows, events, datetime(2026, 10, 2, 6, 0, tzinfo=timezone.utc)), [])  # 22 h later
        [item] = self.items(rows, events, datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc))
        self.assertEqual(item['detail'], 'You wrote Thu 1 Oct (yesterday), no reply yet.')

    def test_an_interview_ahead_or_an_ended_job_never_asks(self):
        later = datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc)
        rows, events = self.duvo(stage='Interview scheduled', Next_interview={'type': 'date', 'date': {'start': '2026-10-20T10:00:00+02:00'}})
        self.assertNotIn('follow_up', [i['kind'] for i in self.items(rows, events, later)])
        for stage in ('Rejected', 'Withdrawn', 'No response'):
            rows, events = self.duvo(stage=stage)
            self.assertNotIn('follow_up', [i['kind'] for i in self.items(rows, events, later)], stage)

    def test_an_email_reply_links_to_it_and_ranks_below_answers(self):
        rows = [focus_row('d1', 'Duvo.ai', 'Senior SRE', stage='Screening', applied=None), focus_row('a', 'Acme', 'SRE', stage='Screening')]
        events = [focus_event('d1', 'Replied', '2026-09-26T10:00:00Z', 'You replied by email', 'msg1', 'Gmail'),
                  focus_event('a', 'Reply received', '2026-09-29T08:00:00Z', 'Questions for you', 'gm2', 'Gmail')]
        items = focus.build(rows, events, now=NOW)['items']
        kinds = [i['kind'] for i in items]
        self.assertLess(kinds.index('reply'), kinds.index('follow_up'))
        item = items[kinds.index('follow_up')]
        self.assertEqual((item['link'], item['link_label']), ('https://mail.google.com/mail/u/0/#all/msg1', 'Open email'))

    def test_done_from_focus_logs_a_followed_up_reply(self):
        from src.stores import memory
        stores = memory.open_store()
        app = stores.applications.create({'url': 'https://x.test/d1', 'company': 'Duvo.ai'}, 'Screening')
        out = io.StringIO()
        with mock.patch('src.stores.open_stores', return_value=stores), redirect_stdout(out):
            focus.main(['done', app['id'], 'followed_up'])
            focus.main(['done', app['id'], 'details_skipped'])
        self.assertEqual(out.getvalue().splitlines(), ['{"ok": true}'] * 2)
        [replied, skipped] = stores.events.list(app_id=app['id'])
        self.assertEqual((replied['kind'], replied['note'], replied['source']),
                         ('Replied', 'You followed up (marked done in Focus)', 'Jobadabra app'))
        self.assertEqual((skipped['kind'], skipped['source_id']), ('Details skipped', 'skip-details:Screening'))


class ProposeIsNoRunTest(unittest.TestCase):
    """The check-first step printed its JSON and exited, leaving its ⏱️ Search runs row to end as "Failed: ended
    before its report", so the app toasted "Logged activity had problems" for a good reading."""

    def setUp(self):
        cron_runs._open.clear()
        cron_runs._auto.clear()

    def tearDown(self):
        cron_runs._open.clear()
        cron_runs._auto.clear()

    def test_propose_opens_no_run_row(self):
        from src import daily
        calls = []

        class Tracker:
            def _request(self, method, path, body=None):
                calls.append((method, path))
                return {'id': 'row-1', 'url': 'u'}
        argv = ['daily', '--mode', 'add', '--note', 'A LinkedIn chat with the Duvo.ai recruiter, long enough to read.',
                '--log-run', '--from-app', '--propose']
        proposal = {'item': {}, 'job': None, 'kind': 'Reply received', 'new': True, 'stage': '', 'label': 'x', 'fields': {}}
        with mock.patch.object(sys, 'argv', argv), mock.patch.object(daily.notion.Tracker, 'from_env', return_value=Tracker()), \
                mock.patch.object(cron_runs, 'CRON_RUNS_DATABASE_ID', 'runs-db'), \
                mock.patch.object(daily.inbox, 'propose', return_value=proposal), redirect_stdout(io.StringIO()) as out:
            self.assertEqual(daily.main(), 0)
            cron_runs._unfinished()  # what runs at exit
        self.assertEqual(calls, [])
        self.assertIn('"ok": true', out.getvalue())


if __name__ == '__main__':
    unittest.main()
