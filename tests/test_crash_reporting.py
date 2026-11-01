"""The engine's crash reports (src/crash_reporting.py): what an event holds, scrubbing, and that it is off without the app's say-so."""
import json
import sys
import unittest

from src import crash_reporting as cr

DSN = 'https://abc123@o1.ingest.de.sentry.io/4500002'


def raised():
    try:
        raise ValueError('Notion refused ada@example.com using sk-ant-abc123def456 in /Users/ada/data/jobs.sqlite after 42 s')
    except ValueError:
        return sys.exc_info()


class CrashReportingTests(unittest.TestCase):
    def test_dsn(self):
        self.assertEqual(cr.parse_dsn(DSN)[0], 'https://o1.ingest.de.sentry.io/api/4500002/envelope/')
        for bad in ('', 'x', 'https://o1.ingest.sentry.io/4500002', 'https://k@o1.ingest.sentry.io/abc'):
            self.assertIsNone(cr.parse_dsn(bad), bad)

    def test_event_has_type_scrubbed_message_frames_and_no_personal_data(self):
        exc_type, exc, tb = raised()
        env = {'JOBADABRA_APP_VERSION': '0.5.250', 'JOBADABRA_RUN_ID': 'run1', 'JOBADABRA_INSTALL_ID': 'inst-1'}
        event = cr.build_event(exc_type, exc, tb, env)
        text = json.dumps(event)
        for leaked in ('ada@example.com', 'sk-ant-abc123', '/Users/ada'):
            self.assertNotIn(leaked, text)
        value = event['exception']['values'][0]
        self.assertEqual(value['type'], 'ValueError')
        self.assertEqual(value['stacktrace']['frames'][-1]['function'], 'raised')
        self.assertEqual([event['release'], event['user']['id'], event['tags']['run_id']], ['jobadabra@0.5.250', 'inst-1', 'run1'])
        again = cr.build_event(exc_type, ValueError(str(exc).replace('42', '57')), tb, env)
        self.assertEqual(event['fingerprint'], again['fingerprint'])   # numbers do not make a different problem

    def test_envelope_and_send(self):
        exc_type, exc, tb = raised()
        event = cr.build_event(exc_type, exc, tb, {})
        lines = cr.envelope(event, DSN).strip().split('\n')
        self.assertEqual([json.loads(line).get('type') for line in lines[1:2]], ['event'])
        seen = []

        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): return False
        self.assertTrue(cr.send(event, DSN, urlopen=lambda request, timeout: (seen.append((request.full_url, timeout)), Response())[1]))
        self.assertEqual(seen[0], ('https://o1.ingest.de.sentry.io/api/4500002/envelope/', 4))
        self.assertFalse(cr.send(event, DSN, urlopen=lambda *a, **k: (_ for _ in ()).throw(OSError('offline'))))
        self.assertFalse(cr.send(event, '', urlopen=lambda *a, **k: Response()))

    def test_off_without_a_dsn_and_the_hook_reports_then_keeps_the_normal_traceback(self):
        self.assertFalse(cr.install({}))
        self.assertFalse(cr.install({'JOBADABRA_SENTRY_DSN': 'garbage'}))
        original, calls, sent = sys.excepthook, [], []
        try:
            sys.excepthook = lambda *args: calls.append(args[0])
            class Response:
                status = 200
                def __enter__(self): return self
                def __exit__(self, *args): return False
            self.assertTrue(cr.install({'JOBADABRA_SENTRY_DSN': DSN}, urlopen=lambda request, timeout: (sent.append(request), Response())[1]))
            exc_type, exc, tb = raised()
            sys.excepthook(exc_type, exc, tb)
            sys.excepthook(KeyboardInterrupt, KeyboardInterrupt(), None)   # a Ctrl-C is not a crash
        finally:
            sys.excepthook = original
        self.assertEqual(len(sent), 1)
        self.assertEqual(calls, [ValueError, KeyboardInterrupt])


if __name__ == '__main__':
    unittest.main()
