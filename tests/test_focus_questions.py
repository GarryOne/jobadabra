"""Focus asks "which job?" for an email it could not place, even when one event carries a suggested job that is not text (Sentry APP-23); the odd value
is reported once a day by its shape (type, key names, store), never by its content. Guards src/focus_state.questions and crash_reporting.warn."""
import json
import tempfile
import unittest
from unittest import mock

from src import crash_reporting, focus
from tests.test_focus import event, row

DSN = 'https://key@o1.ingest.example.test/1'
SECRET_VALUE = 'https://private.example/jobs/12345?token=zqxw'   # never hex: the report's random event id once contained "abc" (flaky, 17 Oct 2026)


class Sent:
    def __init__(self):
        self.bodies = []

    def __call__(self, request, timeout=0):
        self.bodies.append(request.data.decode())
        return mock.MagicMock(__enter__=lambda s: mock.MagicMock(status=200), __exit__=lambda *a: False)


class QuestionsToleratesABadLinkTest(unittest.TestCase):
    def ask(self, bad):
        job = row('job1', 'Blockdaemon', 'SRE')
        asked = {**event('', 'Reply received', '2026-10-02T21:30:00+02:00'), 'needs_you': True, 'suggested_job': bad, 'id': 'e1'}
        return focus.questions([job], [asked])

    def test_a_suggested_job_that_is_not_text_still_asks_which_job(self):
        for bad in ({'url': SECRET_VALUE}, [SECRET_VALUE], 7):
            with self.subTest(link=bad):
                [item] = self.ask(bad)
                self.assertEqual(item['title'], 'Which job is this email about?')

    def test_the_odd_value_is_reported_once_a_day_by_type_and_key_names_only(self):
        sent, folder = Sent(), tempfile.mkdtemp()
        env = {'JOBADABRA_SENTRY_DSN': DSN, 'JOBADABRA_STORE': 'notion'}
        real = crash_reporting.warn
        with mock.patch.dict('os.environ', env), mock.patch.object(crash_reporting, 'warn', lambda *a, **k: real(*a, urlopen=sent, marker_dir=folder, **k)):
            self.ask({'url': SECRET_VALUE, 'name': 'Jane Doe'})
            self.ask({'url': SECRET_VALUE})
        self.assertEqual(len(sent.bodies), 1, 'once a day, not once per event')
        body = sent.bodies[0]
        self.assertIn('dict', body)
        self.assertIn('name,url', body)
        self.assertIn('notion', body)
        for value in (SECRET_VALUE, 'Jane Doe', 'private.example', 'zqxw'):
            self.assertNotIn(value, body, 'the report carries names, never values')
        self.assertEqual(json.loads(body.split('\n')[2])['level'], 'warning')

    def test_no_report_without_a_dsn(self):
        sent = Sent()
        self.assertFalse(crash_reporting.warn('x', {'type': 'dict'}, env={}, urlopen=sent, marker_dir=tempfile.mkdtemp()))
        self.assertEqual(sent.bodies, [])
