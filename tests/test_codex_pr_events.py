"""Check native Codex delivery of PR events without touching a daemon or model."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parent.parent
THREAD = '01a18ac0-a906-7ba1-bf47-93e2bf1db6a7'


class CodexPrEventsTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('codex_pr_events', ROOT / 'tools/codex-pr-events.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.log = Path(self.tmp.name) / 'ship.log'
        self.log.write_text('ship: [2s] checking\nship: RED #7 python\n')
        self.run = Mock(return_value=subprocess.CompletedProcess([], 0, 'queued', ''))

    def deliver(self):
        return self.module.deliver(self.log, THREAD, '/fake/codex', run=self.run)

    def test_queues_event_to_own_thread_with_native_resume_once(self):
        self.assertTrue(self.deliver())
        args = self.run.call_args.args[0]
        self.assertEqual(args[:5], ['/fake/codex', 'queue', '--thread', THREAD, '--message'])
        self.assertIn('ship: RED #7 python', args[5])
        self.assertNotIn('checking', args[5])
        self.assertEqual(args[6:], ['--resume'])
        self.assertTrue(self.deliver())
        self.assertEqual(self.run.call_count, 1)
        with self.log.open('a') as log:
            log.write('ship: READY #7 abc1234\n')
        self.deliver()
        self.assertEqual(self.run.call_count, 2)
        self.assertNotIn('RED #7', self.run.call_args.args[0][5])

    def test_cmux_routes_to_the_known_surface_without_terminal_typing(self):
        surface = 'CCE70BB3-2B25-44D7-8A24-202B1BE5E33D'
        self.run.return_value.stdout = json.dumps({'id': 'queued-event', 'state': 'queued'})
        self.assertTrue(self.module.deliver(self.log, THREAD, '/fake/codex', run=self.run,
                                           cmux='/fake/cmux', surface=surface))
        args = self.run.call_args.args[0]
        self.assertEqual(args[:4], ['/fake/cmux', 'agent', 'message', surface])
        self.assertIn('ship: RED #7 python', args[-1])
        self.assertIn(THREAD, args[-1])
        self.assertNotIn('send-key', args)
        self.assertNotIn('paste', args)

    def test_failed_queue_is_retried_without_losing_the_event(self):
        self.run.return_value.returncode = 1
        self.assertFalse(self.deliver())
        self.run.return_value.returncode = 0
        self.assertTrue(self.deliver())
        self.assertEqual(self.run.call_count, 2)
        self.assertIn('RED #7', self.run.call_args.args[0][5])

    def test_replaced_log_and_terminal_events_are_not_lost(self):
        self.deliver()
        self.log.write_text('ship: MERGED #7 abc1234\n' + 'x' * 100)
        self.deliver()
        self.assertIn('MERGED #7 abc1234', self.run.call_args.args[0][5])
        self.assertEqual(self.run.call_count, 2)

    def test_partial_lines_wait_for_completion(self):
        self.log.write_text('ship: RED #7 py')
        self.deliver()
        self.run.assert_not_called()
        with self.log.open('a') as log:
            log.write('thon\n')
        self.deliver()
        self.assertIn('RED #7 python', self.run.call_args.args[0][5])

    def test_invalid_session_cannot_route_a_message(self):
        self.assertFalse(self.module.deliver(self.log, '../other-session', '/fake/codex', run=self.run))
        self.run.assert_not_called()
