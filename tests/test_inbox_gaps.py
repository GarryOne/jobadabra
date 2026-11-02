"""Logging a message on a job fills what the job was missing, and never replaces what's there. On the store (src/ai/inbox*.py
take `stores` and application records); the Notion page's shapes (the logged entry's fold, its thumbnails) and the 30 Sep
events-filter bug are checked on the notion store over a fake Notion."""
import os
import unittest
from unittest import mock

from src.ai import inbox
from src.stores import base, memory, open_stores

URL = 'https://x.test/h1'


def job(stores, stage='Interview scheduled', **fields):
    """An application record in `stores` (created_at as given: a job tracked on that day)."""
    return stores.applications.put({'url': URL, 'title': 'SRE', 'stage': stage, **fields})


def now_of(stores):
    return stores.applications.get(URL)


class FillGapsTest(unittest.TestCase):
    def test_only_empty_fields_are_filled(self):
        stores = memory.open_store()
        app = job(stores, location='Zurich')
        filled = inbox._fill_gaps(stores, app, {'company': 'Acme Bank', 'location': 'Geneva', 'salary': 'CHF 160k'})
        self.assertEqual(filled, ['company', 'salary'])
        self.assertEqual({k: now_of(stores)[k] for k in ('company', 'location', 'salary')},
                         {'company': 'Acme Bank', 'location': 'Zurich', 'salary': 'CHF 160k'})

    def test_a_chat_that_began_before_the_job_was_tracked_becomes_where_you_were_reached(self):
        stores = memory.open_store()
        app = job(stores, company='Acme', reached_via='Email', created_at='2026-09-29T12:41:00Z')
        filled = inbox._fill_gaps(stores, app, {'platform': 'LinkedIn', 'first_contact': '2026-09-22T10:00:00+02:00'})
        self.assertEqual(filled, ['first contact on LinkedIn'])
        self.assertEqual(now_of(stores)['reached_via'], 'LinkedIn')
        later = memory.open_store()
        app = job(later, company='Acme', reached_via='Email', created_at='2026-09-29T12:41:00Z')
        self.assertEqual(inbox._fill_gaps(later, app, {'platform': 'LinkedIn', 'first_contact': '2026-09-30'}), [])

    def test_the_fuller_title_replaces_an_invitations_short_one_never_another_role(self):
        stores = memory.open_store()
        self.assertEqual(inbox._fill_gaps(stores, job(stores), {'role': 'Principal SRE'}), ['the title "Principal SRE"'])
        other = memory.open_store()
        self.assertEqual(inbox._fill_gaps(other, job(other), {'role': 'Data Engineer'}), [])
        self.assertEqual(now_of(other)['title'], 'SRE')

    def test_a_date_shown_without_its_year_is_this_years(self):
        from datetime import datetime, timezone
        now = datetime(2026, 9, 29, 13, 0, tzinfo=timezone.utc)
        self.assertEqual(inbox._this_year('2024-09-21T10:00:00+00:00', now)[:10], '2026-09-21')
        self.assertEqual(inbox._this_year('2024-12-21T10:00:00+00:00', now)[:10], '2025-12-21')  # never in the future
        self.assertEqual(inbox._this_year('2026-09-20T10:00:00+00:00', now), '2026-09-20T10:00:00+00:00')

    def test_nothing_new_writes_nothing(self):
        stores = memory.open_store()
        app = job(stores, company='Acme')
        self.assertEqual(inbox._fill_gaps(stores, app, {'company': 'Other'}), [])
        self.assertEqual(now_of(stores), app)


def gmail_lead(stores, **extra):
    """The Huxley job: tracked from the Gmail check's call invite on 29 Sep."""
    return job(stores, company='', source='Gmail', reached_via='Email', notes='Recruiter message (Email)',
               created_at='2026-09-29T13:09:00Z', **extra)


class SourceIsTheEarliestContactTest(unittest.TestCase):
    """Source = where the contact started: a later channel never replaces it, an earlier one logged later does."""

    def test_email_first_then_linkedin_later_stays_gmail(self):
        stores = memory.open_store()
        app = gmail_lead(stores)
        self.assertEqual(inbox._fill_gaps(stores, app, {'platform': 'LinkedIn', 'when': '2026-09-30T09:00:00Z',
                                                        'first_contact': '2026-09-30T09:00:00Z'}), [])
        self.assertEqual(now_of(stores), app)

    def test_linkedin_logged_later_but_dated_earlier_becomes_the_source(self):
        stores = memory.open_store()
        filled = inbox._fill_gaps(stores, gmail_lead(stores), {'platform': 'LinkedIn', 'first_contact': '2026-09-21T14:36:00Z'})
        self.assertEqual(filled, ['first contact on LinkedIn'])
        self.assertEqual({k: now_of(stores)[k] for k in ('source', 'reached_via', 'notes')},
                         {'source': 'LinkedIn', 'reached_via': 'LinkedIn', 'notes': 'Recruiter message (LinkedIn)'})

    def test_the_messages_own_date_counts_when_the_chat_start_isnt_shown(self):
        stores = memory.open_store()
        inbox._fill_gaps(stores, gmail_lead(stores), {'platform': 'LinkedIn', 'first_contact': '', 'when': '2026-09-21T14:36:00Z'})
        self.assertEqual(now_of(stores)['source'], 'LinkedIn')

    def test_the_same_channel_twice_changes_nothing(self):
        stores = memory.open_store()
        app = job(stores, source='LinkedIn', reached_via='LinkedIn', notes='Recruiter message (LinkedIn)', created_at='2026-09-29T13:09:00Z')
        self.assertEqual(inbox._fill_gaps(stores, app, {'platform': 'LinkedIn', 'first_contact': '2026-09-21T10:00:00Z'}), [])
        self.assertEqual(now_of(stores), app)
        stores = memory.open_store()
        app = gmail_lead(stores)
        self.assertEqual(inbox._fill_gaps(stores, app, {'platform': 'Email', 'first_contact': '2026-09-21'}), [])
        self.assertEqual(now_of(stores), app)

    def test_an_email_older_than_the_job_itself_still_came_first(self):
        # The Gmail check tracked on 29 Sep an email from 20 Sep: a LinkedIn chat from the 21st is later.
        stores = memory.open_store()
        app = gmail_lead(stores)
        stores.events.add(app['id'], 'Reply received', '2026-09-20T09:00:00Z', source='Gmail')
        self.assertEqual(inbox._fill_gaps(stores, app, {'platform': 'LinkedIn', 'first_contact': '2026-09-21'}), [])
        self.assertEqual(now_of(stores)['source'], 'Gmail')


class EventsNotion:
    """The notion store's reads of one job's events, refusing a select filter on an option the database lacks (Notion's 400)."""
    OPTIONS = {'Source': {'Gmail', 'Telegram', 'Job Pilotto app', 'CLI'}, 'Kind': {'Recruiter lead', 'Reply received'}}

    def __init__(self, events):
        self.events, self.queries = events, []

    def query_database(self, database_id, filter_=None):
        def check(f):
            if isinstance(f, dict):
                if 'select' in f and f['select'].get('equals') not in self.OPTIONS.get(f.get('property'), set()):
                    raise RuntimeError('HTTP Error 400: Bad Request')
                for value in f.values():
                    check(value)
            elif isinstance(f, list):
                for value in f:
                    check(value)
        check(filter_)
        self.queries.append(filter_)
        return self.events


class NotionEventsFilterTest(unittest.TestCase):
    def test_the_30_sep_bug_a_source_the_events_do_not_have_is_never_sent_as_a_filter(self):
        # The Duvo.ai log: the job's Source "Manual" isn't an option of the events' Source; Notion answered 400
        # ("events not read") and the earliest contact was decided without the events. The job's events are read by the job.
        sel = lambda name: {'type': 'select', 'select': {'name': name}}
        lead = {'id': 'e1', 'properties': {'At': {'type': 'date', 'date': {'start': '2026-09-20T09:00:00Z'}},
                                           'Source': sel('Job Pilotto app'), 'Kind': sel('Recruiter lead'),
                                           'Application': {'type': 'relation', 'relation': [{'id': 'h1'}]}}}
        fake = EventsNotion([lead])
        with mock.patch.dict('os.environ', {'NOTION_EVENTS_DB': 'events-db'}):
            stores = open_stores({**os.environ, 'JOBADABRA_STORE': 'notion'}, tracker=fake)
        manual = base.record(base.APPLICATION_FIELDS, {'id': 'h1', 'url': URL, 'source': 'Manual', 'reached_via': 'Email',
                                                       'created_at': '2026-09-29T13:09:00Z'})
        with mock.patch.object(stores.applications, 'update', side_effect=AssertionError('nothing to write')), \
                mock.patch('sys.stderr') as err:
            self.assertEqual(inbox._fill_gaps(stores, manual, {'platform': 'LinkedIn', 'first_contact': '2026-09-21'}), [])
        self.assertNotIn('events not read', ''.join(str(c) for c in err.mock_calls))
        self.assertTrue(fake.queries, 'the events were read')


class EntryTest(unittest.TestCase):
    def test_a_logged_entry_names_its_channel(self):
        stores = memory.open_store()
        app = job(stores)
        inbox._keep(stores, app, 'hi', None, 'Call booked', '2026-09-21T10:00:00Z', 'LinkedIn')
        inbox._keep(stores, app, 'hi', None, 'LinkedIn chat', '2026-09-21T10:00:00Z', 'LinkedIn')
        log = stores.applications.section(app['id'], base.LOGGED)
        self.assertEqual([line for line in log.split('\n') if line.startswith('#')],
                         ['### 📥 21 Sep 2026 · LinkedIn · Call booked', '### 📥 21 Sep 2026 · LinkedIn chat'])


class NotionPage:
    """One Applications page in Notion: its appended blocks, uploads and (for the second call) the fold's id."""

    def __init__(self):
        self.appended = []
        self.parent = ''   # the Applications database the store was opened with (the page must be one of its rows)

    def _request(self, method, path, body=None):
        assert method == 'GET' and path.startswith('pages/'), (method, path)
        return {'id': path.split('/')[1], 'parent': {'database_id': self.parent}, 'properties': {}}

    def upload_file(self, name, data, kind):
        return f'up-{name}'

    def append_blocks(self, parent, blocks):
        self.appended.append((parent, blocks))
        return {'results': [{'id': 'toggle-1'}]}


class NotionEntryTest(unittest.TestCase):
    """On Notion the log is today's page: one bold fold per entry, titled with its channel, screenshots inside it."""

    def test_a_logged_entry_names_its_channel_on_the_notion_page(self):
        page = NotionPage()
        stores = open_stores({**os.environ, 'JOBADABRA_STORE': 'notion'}, tracker=page)   # the Notion store, with its database ids
        page.parent = stores.applications.database_id
        app = base.record(base.APPLICATION_FIELDS, {'id': 'job'})
        inbox._keep(stores, app, 'hi', None, 'Call booked', '2026-09-21T10:00:00Z', 'LinkedIn')
        inbox._keep(stores, app, 'hi', None, 'LinkedIn chat', '2026-09-21T10:00:00Z', 'LinkedIn')
        titles = [blocks[0]['toggle']['rich_text'][0]['text']['content'] for _, blocks in page.appended]
        self.assertEqual(titles, ['📥 21 Sep 2026 · LinkedIn · Call booked', '📥 21 Sep 2026 · LinkedIn chat'])

    def test_several_screenshots_become_a_row_of_thumbnails_inside_the_fold(self):
        page = NotionPage()
        stores = open_stores({**os.environ, 'JOBADABRA_STORE': 'notion'}, tracker=page)   # the Notion store, with its database ids
        page.parent = stores.applications.database_id
        shots = [(f's{n}.png', b'x', 'image/png') for n in range(4)]
        inbox._keep(stores, base.record(base.APPLICATION_FIELDS, {'id': 'job'}), '', shots, 'LinkedIn chat', '2026-09-21T10:00:00+00:00')
        (where, [entry]), (inside, [row]) = page.appended
        self.assertEqual((where, entry['type']), ('job', 'toggle'))
        self.assertEqual(entry['toggle']['rich_text'][0]['text']['content'], '📥 21 Sep 2026 · LinkedIn chat')
        self.assertEqual((inside, row['type'], len(row['column_list']['children'])), ('toggle-1', 'column_list', 4))


class DescriptionTest(unittest.TestCase):
    def test_a_chat_describing_the_role_becomes_the_jobs_description(self):
        stores = memory.open_store()
        url = 'https://mail.google.com/mail/u/0/#all/h1'
        app = stores.applications.put({'url': url, 'title': 'SRE', 'stage': 'Interview scheduled', 'via': 'Huxley',
                                       'created_at': '2026-09-29T12:41:00Z'})
        about = 'Principal SRE for a global AI company. Own AWS and Kubernetes reliability, incident management, Kafka, ArgoCD.'
        reading = {'kind': 'Reply received', 'match': 0, 'role': 'Principal SRE', 'when': '', 'first_contact': '', 'interview_at': '',
                   'feedback': '', 'job_description': about, 'summary': 'hands-on SRE', 'platform': 'LinkedIn'}
        scored = []
        with mock.patch.object(inbox, 'candidates', lambda s: [{'url': url, 'stage': 'Interview scheduled'}]), \
                mock.patch.object(inbox, 'read', lambda *a, **k: reading), \
                mock.patch.object(inbox.mail, 'record', lambda *a, **k: None):
            line = inbox.log(stores, text='x' * 50, client=object(), target=url,
                             on_new=lambda url, job, r=None: scored.append(job['description']) or '78/100')
        self.assertEqual(stores.applications.section(app['id'], inbox.DESCRIPTION_HEADING), about)
        self.assertEqual(scored, [about])
        self.assertIn('the job description', line)


if __name__ == '__main__':
    unittest.main()
