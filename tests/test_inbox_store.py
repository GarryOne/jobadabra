"""Logging a message or screenshot without Notion (the memory store, as sqlite runs it): src/ai/inbox.py propose → confirm →
log moves a tracked job, makes a job applied to elsewhere, tracks a recruiter's pitch, and keeps each log and its screenshots
on the job ('📥 Logged messages'). The Notion side of the same code is tests/test_inbox*.py on the Notion fakes."""
import contextlib
import io
import json
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import inbox, opportunity
from src.stores import base, memory
from tests.test_inbox import SHOT, reading
from tests.test_mail import NOW
from tests.test_opportunity import Client

JOB = {'url': 'https://jobs.example/sre-1', 'title': 'SRE', 'company': 'Grafana Labs'}


class InboxOnTheMemoryStoreTests(unittest.TestCase):
    def setUp(self):
        self.s = memory.open_store({})
        cut = mock.patch.object(socket.socket, 'connect', side_effect=AssertionError('the log reached the network'))
        cut.start()
        self.addCleanup(cut.stop)

    def log(self, answer, **options):
        options.setdefault('text', '')
        options.setdefault('image', None)
        return inbox.log(self.s, client=Client(answer), now=NOW, **options)

    def logged(self, job):
        return self.s.applications.section(job['id'], base.LOGGED) or ''

    def test_a_confirmed_reply_moves_the_tracked_job_and_is_kept_on_it(self):
        job = self.s.applications.create(JOB, 'Applied')
        text = 'Thank you for your interest. We decided not to move forward with your application.'
        proposal = inbox.propose(self.s, text=text, client=Client(reading('Rejected', 0, summary='Not moving forward')), now=NOW)
        confirmed = inbox.confirm(proposal, kind='Rejected')
        line = inbox.log(self.s, text=text, proposal=confirmed, now=NOW)
        self.assertNotIn('⚠️', line)
        self.assertEqual(self.s.applications.get(JOB['url'])['stage'], 'Rejected')
        self.assertEqual([e['kind'] for e in self.s.events.list(app_id=job['id'])], ['Rejected'])
        self.assertIn('Not moving forward', self.logged(job))

    def test_a_job_applied_to_elsewhere_is_made_with_its_event(self):
        found = {}
        self.log(reading(inbox.APPLIED, -1, title='Platform Engineer', company='Acme', summary='Applied on their site'),
                 text='Your application for Platform Engineer at Acme has been received.', found=found)
        job = found['row']
        self.assertEqual((job['stage'], job['company'], found['created']), ('Applied', 'Acme', True))
        self.assertEqual(self.s.applications.get(job['url'])['id'], job['id'])  # found['row'] is the store's record
        self.assertEqual([e['kind'] for e in self.s.events.list(app_id=job['id'])], ['Applied'])

    def test_a_recruiters_pitch_is_a_lead_with_its_message(self):
        pitch = 'Hi Sam, a logistics company is hiring a Senior DevOps Engineer, fully remote. Would you be open to a chat?'
        self.log(reading(inbox.OUTREACH, -1, is_opportunity=True, summary='Senior DevOps, remote'), text=pitch)
        [lead] = self.s.applications.list()
        self.assertEqual((lead['stage'], lead['origin']), (opportunity.LEAD_STAGE, 'Inbound'))
        self.assertIn('Would you be open', self.s.applications.section(lead['id'], opportunity.HEADING))

    def test_a_screenshot_is_kept_with_the_job_and_said_in_its_log_entry(self):
        job = self.s.applications.create(JOB, 'Applied')
        self.log(reading('Rejected', 0, summary='Not moving forward'), image=SHOT)
        self.assertEqual([data for _, data, _ in self.s.applications.files(job['id'])], [SHOT[1]])
        self.assertIn('kept with this job', self.logged(job))


class AddMessageModeOnTheMemoryStoreTests(unittest.TestCase):
    """`daily --mode add --note …` (the app's Log box, the bot's /add <message>) on this Mac's store: no Notion token needed."""

    def test_a_logged_message_updates_the_job_and_links_the_run_to_it(self):
        from src import daily, daily_helpers, run_log, store_access
        stores = memory.open_store({})
        job = stores.applications.create(JOB, 'Applied')
        out = io.StringIO()
        argv = ['daily', '--mode', 'add', '--note', 'Thank you for your interest. We decided not to move forward.',
                '--log-run', '--db', str(Path(tempfile.mkdtemp()) / 'jobs.sqlite')]
        with mock.patch.object(sys, 'argv', argv), mock.patch.dict('os.environ', {'JOBADABRA_STORE': 'memory'}), \
                mock.patch.object(socket.socket, 'connect', side_effect=AssertionError('the run reached the network')), \
                mock.patch.object(daily.notion.Tracker, 'from_env', return_value=None), \
                mock.patch.object(store_access, 'open_stores', lambda tracker=None: stores), \
                mock.patch('src.ai.engine.ready', return_value=True), \
                mock.patch('src.ai.engine.client', return_value=Client(reading('Rejected', 0, summary='Not moving forward'))), \
                mock.patch('src.ai.added.process', return_value=None), \
                mock.patch.object(daily_helpers, 'queue_mail_check'), mock.patch('src.daily_modes.queue_mail_check'), \
                mock.patch.object(run_log, '_install', lambda: None), mock.patch.object(run_log, 'capture', lambda: None), \
                mock.patch.object(run_log, '_heartbeat', lambda run: None), contextlib.redirect_stdout(out):
            self.addCleanup(run_log._auto.clear)
            self.addCleanup(run_log._open.clear)
            code = daily.main()
        self.assertEqual(code, 0, out.getvalue())
        self.assertEqual(stores.applications.get(JOB['url'])['stage'], 'Rejected')
        self.assertEqual([e['kind'] for e in stores.events.list(app_id=job['id'])], ['Rejected'])
        self.assertIn('Not moving forward', stores.applications.section(job['id'], base.LOGGED) or '')
        logged = [line for line in out.getvalue().splitlines() if line.startswith('Job logged: ')]
        self.assertEqual(json.loads(logged[0][len('Job logged: '):])['page_id'], job['id'])  # the app links the run to this job
        self.assertEqual(stores.cron_runs.list()[0]['mode'], 'add')


if __name__ == '__main__':
    unittest.main()
