# Source of an "Applied elsewhere" add (src/daily_modes.py add_link_mode): the app is recorded as the app, the bot as Telegram, the terminal as Manual.
# Why (1 Nov 2026, issue #2909): the add path hard-coded source='Telegram', so a job added in the app said "Telegram" in the row and its Applied event; 0a3ef92 (25 Oct) tagged the other add path only.
import contextlib
import io
import pathlib
import socket
import sys
import tempfile
import unittest
from unittest import mock

from src import daily, daily_helpers, run_log, store_access
from src.stores import memory

URL = 'https://jobs.example/platform-7'


# Why (1 Nov 2026, #2908 CI): the python job runs with JOBADABRA_DISABLE=...telegram (tools/check.py), which clears args.send; this test sets its own feature switches.
def add(*flags):
    """The `daily --mode add --job <url>` run of the app (--from-app), the bot (--send) or the terminal (neither), on a memory store; returns (exit code, the job's row, its events, output)."""
    stores = memory.open_store()
    out = io.StringIO()
    run_log._auto.clear()
    run_log._open.clear()
    argv = ['daily', '--mode', 'add', '--job', URL, '--note', '', '--log-run', '--job-title', 'Platform Engineer', '--job-company', 'Acme',
            '--db', str(pathlib.Path(tempfile.mkdtemp()) / 'jobs.sqlite'), *flags]
    with mock.patch.object(sys, 'argv', argv), mock.patch.dict('os.environ', {'JOBADABRA_STORE': 'memory', 'JOBADABRA_DISABLE': ''}), \
            mock.patch.object(socket.socket, 'connect', side_effect=AssertionError('the run reached the network')), \
            mock.patch.object(daily.notion.Tracker, 'from_env', return_value=None), \
            mock.patch.object(store_access, 'open_stores', lambda tracker=None: stores), \
            mock.patch('src.notion.ledger.page_meta', return_value={}), mock.patch('src.ai.added.process', return_value=None), \
            mock.patch('src.ledger_store.record', return_value=(None, 'recorded')), \
            mock.patch('src.telegram.credentials', return_value=(None, None)), mock.patch('src.telegram.send') as sent, \
            mock.patch.object(daily_helpers, 'queue_mail_check'), mock.patch('src.daily_modes.queue_mail_check'), \
            mock.patch.object(run_log, '_install', lambda: None), mock.patch.object(run_log, 'capture', lambda: None), \
            mock.patch.object(run_log, '_heartbeat', lambda run: None), contextlib.redirect_stdout(out):
        try:
            code = daily.main()
        finally:   # a failed run leaves no open run row for the next test
            run_log._auto.clear()
            run_log._open.clear()
    app = stores.applications.get(URL)
    return code, app, stores.events.list(app['id']), out.getvalue(), sent


class AddSourceTest(unittest.TestCase):
    def test_an_add_made_in_the_app_records_the_app(self):
        code, app, events, out, _ = add('--from-app')
        self.assertEqual(code, 0, out)
        self.assertEqual(app['source'], 'Jobadabra app', 'the Applications row says where the job came from')
        self.assertEqual([(event['kind'], event['source']) for event in events], [('Applied', 'Jobadabra app')], 'and so does its Applied event')

    def test_an_add_sent_to_the_bot_records_telegram(self):
        code, app, events, out, sent = add('--send')
        self.assertEqual(code, 0, out)
        self.assertEqual((app['source'], events[0]['source']), ('Telegram', 'Telegram'))
        sent.assert_called_once()   # the bot's reply

    def test_an_add_from_the_terminal_records_manual(self):
        code, app, events, out, _ = add()
        self.assertEqual(code, 0, out)
        self.assertEqual((app['source'], events[0]['source']), ('Manual', 'CLI'))


if __name__ == '__main__':
    unittest.main()
