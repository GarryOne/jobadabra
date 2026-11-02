"""The desktop Jobs list comes from Notion; the local cache only adds details and unsynced finds."""
import sqlite3
import unittest
from unittest import mock

from src import desktop


def notion(url, **kw):
    return {'url': url, 'title': kw.get('title', 'SRE'), 'company': kw.get('company', 'Acme'), 'location': 'Zurich',
            'work_mode': 'Hybrid', 'fit': kw.get('fit', 70), 'reason': 'good', 'match_status': kw.get('status', 'Open'),
            'first_seen': '2026-09-20', **({'stage': kw['stage'], 'next_step': kw.get('step', ''), 'notion_url': 'n'} if 'stage' in kw else {})}


NOTION = __import__('types').SimpleNamespace(name='notion')   # the Notion store, as calendar_jobs tells it


class NotionListTests(unittest.TestCase):
    def run_list(self, notion_jobs, local=(), blocked=()):
        with mock.patch.object(desktop.digest, 'eligible_jobs', return_value=(list(local), list(blocked))), \
                mock.patch.object(desktop.score, 'load', return_value={}), \
                mock.patch.object(desktop.store, 'set_application_status') as cache:
            return desktop.jobs(sqlite3.connect(':memory:'), notion_jobs=notion_jobs), cache

    def test_notion_rows_are_the_list_even_without_a_local_copy(self):
        result, _ = self.run_list([notion('https://a/1', fit=80), notion('https://a/2', stage='Applied', fit=60)])
        self.assertEqual([(r['url'], r['status'], r['fit'], r['first_seen_at']) for r in result['jobs']],
                         [('https://a/1', 'unreviewed', 80, '2026-09-20'), ('https://a/2', 'applied', 60, '2026-09-20')])

    def test_gone_postings_excluded_companies_and_filtered_jobs_are_left_out(self):
        with mock.patch.dict(desktop.digest.PREFERENCES, {'excluded_companies': ['AcmeSource']}):
            result, _ = self.run_list([notion('https://a/gone', status='Not seen'), notion('https://a/applied-gone', status='Not seen', stage='Applied'),
                                       notion('https://a/acme', company='AcmeSource SA'), notion('https://a/german')],
                                      blocked=[{'url': 'https://a/german'}])
        self.assertEqual([r['url'] for r in result['jobs']], ['https://a/applied-gone'])  # your application stays

    def test_only_notion_fields_the_cache_follows_notion_and_unsynced_finds_are_marked(self):
        local = [{'id': 7, 'url': 'https://a/1', 'title': 'SRE', 'company': 'Acme', 'posted_at': '2026-09-19',
                  'first_seen_at': '2026-09-19T08:00', 'application_status': 'unreviewed'},
                 {'id': 8, 'url': 'https://a/new', 'title': 'Platform', 'company': 'Beta', 'application_status': 'unreviewed'}]
        result, cache = self.run_list([notion('https://a/1', stage='Saved')], local=local)
        rows = {r['url']: r for r in result['jobs']}
        # Notion's fields only: the cache's own dates never leak into the list
        self.assertEqual((rows['https://a/1']['id'], rows['https://a/1']['first_seen_at'], rows['https://a/1']['status']), (None, '2026-09-20', 'saved'))
        cache.assert_called_once_with(mock.ANY, 7, 'saved')
        self.assertTrue(rows['https://a/new']['unsynced'])

    def test_rows_carry_the_next_interview_time_for_reminders(self):
        job = notion('https://a/iv', stage='Interview')
        job['next_interview'] = '2026-10-01T14:00:00+02:00'
        result, _ = self.run_list([job, notion('https://a/none', stage='Applied')])
        rows = {r['url']: r for r in result['jobs']}
        self.assertEqual(rows['https://a/iv']['next_interview'], '2026-10-01T14:00:00+02:00')
        self.assertEqual(rows['https://a/none']['next_interview'], '')

    def test_rows_carry_the_stage_and_applications_survive_the_limit(self):
        with mock.patch.object(desktop.digest, 'eligible_jobs', return_value=([], [])), \
                mock.patch.object(desktop.score, 'load', return_value={}):
            result = desktop.jobs(sqlite3.connect(':memory:'), limit=1, notion_jobs=[
                notion('https://a/top', fit=90), notion('https://a/low', fit=20), notion('https://a/rej', fit=10, stage='Rejected')])
        self.assertEqual([(r['url'], r['stage']) for r in result['jobs']], [('https://a/top', ''), ('https://a/rej', 'Rejected')])
        self.assertEqual(result['total'], 3)


class AddedJobTests(unittest.TestCase):
    def test_a_job_you_added_is_in_the_list_from_its_applications_row_alone(self):
        """Jobs added by hand or from a recruiter have no Job Matches row (src/ai/added.py): the list shows them
        from their Applications row, with the fit score written there."""
        from src.notion import client
        text = lambda value: {'rich_text': [{'plain_text': value}]}
        found = {'id': 'm1', 'created_time': '2026-09-20', 'properties': {
            'Job URL': {'url': 'https://a/found'}, 'Job': {'title': [{'plain_text': 'SRE'}]}, 'Company': text('Acme'),
            'Score': {'number': 80}, 'Status': {'select': {'name': 'Open'}}}}
        lead = {'id': 'a1', 'url': 'https://notion/a1', 'created_time': '2026-09-29', 'properties': {
            'Job URL': {'url': 'https://www.jobadabra.top/lead#abc'}, 'Job': {'title': [{'plain_text': 'Platform Lead'}]},
            'Company': text('Beta'), 'Fit score': {'number': 74}, 'Stage': {'select': {'name': 'Recruiter lead'}},
            'Work mode': {'select': {'name': 'Remote'}}, 'Contact': text('Jane (recruiter)'), 'Via': text('Example Talent'),
            'Source': {'select': {'name': 'Gmail'}}, 'Notes': text('Recruiter message (Email). Client: logistics software, Series A'),
            'Next step': text('Reply by Friday'), 'Origin': {'select': {'name': 'Inbound'}}}}
        tracker = client.Tracker('token', 'apps')
        with mock.patch.object(client, 'MATCHES_DATABASE_ID', 'matches'), \
                mock.patch.object(tracker, '_query', lambda filter_=None, database_id=None: [found] if database_id == 'matches' else [lead]):
            jobs = tracker.notion_jobs()
        row = next(j for j in jobs if j['url'].endswith('#abc'))
        self.assertEqual((row['title'], row['company'], row['fit'], row['stage'], row['match_status'], row['page_id']),
                         ('Platform Lead', 'Beta', 74, 'Recruiter lead', None, 'a1'))
        with mock.patch.object(desktop.digest, 'eligible_jobs', return_value=([], [])), \
                mock.patch.object(desktop.score, 'load', return_value={}), mock.patch.object(desktop.store, 'set_application_status'):
            listed = desktop.jobs(sqlite3.connect(':memory:'), notion_jobs=jobs)['jobs']
        self.assertEqual({(r['url'], r['fit']) for r in listed},
                         {('https://a/found', 80), ('https://www.jobadabra.top/lead#abc', 74)})
        # What the app needs to tell inbound from outbound (desktop/renderer/origin.js) and to show "In conversation".
        shown = next(r for r in listed if r['url'].endswith('#abc'))
        self.assertEqual((shown['source'], shown['notes'], shown['applied_on'], shown['via'], shown['next_step']),
                         ('Gmail', 'Recruiter message (Email). Client: logistics software, Serie', '', 'Example Talent', 'Reply by Friday'))
        from src.notion.origin import origin
        self.assertEqual(origin(source=shown['source'], stage=shown['stage'], notes=shown['notes']), 'inbound')
        self.assertEqual(shown['origin'], 'Inbound')  # the Origin column, which the app reads first

class CalendarJobsTests(unittest.TestCase):
    def test_calendar_reads_the_applications_database_only_and_keeps_the_meeting_fields(self):
        from src.notion import client
        text = lambda value: {'rich_text': [{'plain_text': value}]}
        row = {'id': 'p1', 'url': 'https://notion/p1', 'created_time': '2026-09-29', 'properties': {
            'Job URL': {'url': 'https://a/1'}, 'Job': {'title': [{'plain_text': 'SRE'}]}, 'Company': text('Acme'),
            'Stage': {'select': {'name': 'Interviewing'}}, 'Next interview': {'date': {'start': '2026-10-08T10:00:00+02:00'}}}}
        tracker = client.Tracker('token', 'apps')
        asked = []
        def query(filter_=None, database_id=None):
            asked.append(database_id)
            return [row]
        with mock.patch.object(client, 'MATCHES_DATABASE_ID', 'matches'), mock.patch.object(tracker, '_query', query):
            result = desktop.calendar_jobs(NOTION, tracker)
        self.assertEqual(asked, [None])  # Job Matches (every job a search found) is not read
        self.assertEqual(result['jobs'], [{'url': 'https://a/1', 'title': 'SRE', 'company': 'Acme', 'stage': 'Interviewing',
                                           'notion_url': 'https://notion/p1', 'next_interview': '2026-10-08T10:00:00+02:00', 'page_id': 'p1',
                                           'status': 'applied'}])   # page_id: a meeting's Dismiss and its recording match by it

    def test_calendar_says_so_when_notion_is_not_connected_or_fails(self):
        self.assertEqual(desktop.calendar_jobs(NOTION, None)['jobs'], [])
        tracker = mock.Mock()
        tracker.notion_jobs.side_effect = RuntimeError('down')
        self.assertIn('could not be read', desktop.calendar_jobs(NOTION, tracker)['error'])

    def test_calendar_on_this_macs_store_lists_its_applications(self):
        from src.stores import memory
        stores = memory.open_store()
        row, _ = stores.applications.set_stage({'url': 'https://a/1', 'title': 'SRE', 'company': 'Acme'}, 'Interviewing')
        stores.applications.update(row['id'], {'next_interview': '2026-10-08T10:00:00+02:00'})
        self.assertEqual(desktop.calendar_jobs(stores)['jobs'], [{'url': 'https://a/1', 'title': 'SRE', 'company': 'Acme', 'stage': 'Interviewing',
                                                                  'notion_url': '', 'next_interview': '2026-10-08T10:00:00+02:00', 'page_id': row['id'],
                                                                  'status': 'applied'}])   # no Notion page: the store's id


if __name__ == '__main__':
    unittest.main()
