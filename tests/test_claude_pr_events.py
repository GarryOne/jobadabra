"""tools/claude-pr-events.py: the watcher wakes the Claude Code session that shipped a PR (30 Oct 2026, owner: "Sessions are not watching their PR to be ready. Their PRs are
broken but they take no action"). Plays a cmux that records its arguments; no daemon, no model, no GitHub."""
import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parent.parent
SURFACE = 'cce70bb3-2b25-44d7-8a24-202b1be5e33d'


class ClaudePrEventsTest(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('claude_pr_events', ROOT / 'tools/claude-pr-events.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.log = Path(self.tmp.name) / 'ship.log'
        self.log.write_text('ship: [2s] checking\nship: RED #7 python\n')
        self.run = Mock(return_value=subprocess.CompletedProcess([], 0, '{"state":"queued"}', ''))

    def deliver(self):
        return self.module.deliver(self.log, SURFACE, '/fake/cmux', run=self.run)

    def append(self, text):
        with self.log.open('a') as out:
            out.write(text)

    def test_a_red_wakes_the_session_once_as_the_watcher_never_as_the_owner(self):
        self.assertTrue(self.deliver())
        args = self.run.call_args.args[0]
        self.assertEqual(args[:6], ['/fake/cmux', 'agent', 'message', SURFACE.upper(), '--from', 'PR watcher'])
        self.assertIn('ship: RED #7 python', args[-1])
        self.assertNotIn('checking', args[-1])
        self.assertIn('not the owner', args[-1])
        self.assertTrue(self.deliver())
        self.assertEqual(self.run.call_count, 1, 'an event already told is not told again')
        self.append('ship: READY #7 abc1234\n')
        self.deliver()
        self.assertEqual(self.run.call_count, 2)
        self.assertNotIn('RED #7', self.run.call_args.args[0][-1])

    def test_every_ask_wakes_and_the_rest_stays_quiet(self):
        # The class: one loop over every line the watcher writes (tools/ship-watch.sh, ship.sh), each judged by the same rule.
        wake = ['ship: RED #7 python', 'ship: CONFLICT #7', 'ship: COMMENT #7 owner comment https://x/y', 'ship: COMMENT #7 bot review-changes_requested https://x/z',
                'ship: READY #7 abc1234', 'ship: MERGED #7 abc1234', 'ship: CLOSED #7 (unmerged)', 'ship: FAILED check python', 'ship: DONE abc1234']
        quiet = ['ship: [5s] pushing', 'ship: GREEN #7', 'ship: REVIEW #7 https://x/pull/7 (every check green)', 'ship: CONFLICT FIXED #7 (stacked parent #3)',
                 'ship: WATCH ENDED #7 (still open)', 'ship: CODEX DELIVERY PENDING #7 (PR MERGED; events remain in the log)']
        for line in wake:
            self.assertTrue(self.module.WAKE.match(line), line)
        for line in quiet:
            self.assertFalse(self.module.WAKE.match(line), line)

    def test_green_alone_sends_nothing_but_moves_the_cursor_on(self):
        self.log.write_text('ship: GREEN #7\nship: REVIEW #7 https://x/pull/7 (every check green)\n')
        self.assertTrue(self.deliver())
        self.run.assert_not_called()
        self.append('ship: RED #7 python\n')
        self.deliver()
        self.assertEqual(self.run.call_count, 1)

    def test_a_refused_message_is_retried_not_lost(self):
        self.run.return_value = subprocess.CompletedProcess([], 1, '', 'no such surface')
        self.assertFalse(self.deliver())
        self.run.return_value = subprocess.CompletedProcess([], 0, '{}', '')
        self.assertTrue(self.deliver())
        self.assertIn('ship: RED #7 python', self.run.call_args.args[0][-1])
        self.assertEqual(self.run.call_count, 2)

    def test_a_line_still_being_written_waits_for_its_newline(self):
        self.log.write_text('ship: GREEN #7\nship: RED #7 pyth')
        self.deliver()
        self.run.assert_not_called()
        self.append('on\n')
        self.deliver()
        self.assertIn('ship: RED #7 python', self.run.call_args.args[0][-1])

    def test_a_replaced_log_is_read_from_the_top(self):
        self.deliver()
        self.log.write_text('ship: RED #8 harness tests\n')
        self.deliver()
        self.assertEqual(self.run.call_count, 2)
        self.assertIn('RED #8', self.run.call_args.args[0][-1])

    def test_a_red_pending_delivery_is_dropped_after_the_head_changes(self):
        self.log.write_text('ship: RED #7 python oldhead\n')
        Path(f'{self.log}.head').write_text('7 oldhead\n')
        self.run.return_value.returncode = 1
        self.assertFalse(self.deliver())
        Path(f'{self.log}.head').write_text('7 newhead\n')
        self.run.reset_mock()
        self.run.return_value.returncode = 0
        self.assertTrue(self.deliver())
        self.assertEqual(self.run.call_count, 0)
        with self.log.open('a') as out:
            out.write('ship: RED #7 python newhead\n')
        self.assertTrue(self.deliver())
        self.assertIn('ship: RED #7 python newhead', str(self.run.call_args))

    def test_a_bad_surface_or_none_is_silent(self):
        self.assertTrue(self.module.deliver(self.log, 'not-a-uuid', '/fake/cmux', run=self.run))
        self.assertTrue(self.module.deliver(self.log, None, '/fake/cmux', run=self.run))
        self.run.assert_not_called()

    def test_outside_a_cmux_claude_session_the_script_stays_silent(self):
        base = {k: v for k, v in os.environ.items() if not k.startswith(('CMUX_', 'CODEX_'))}
        cases = {'no surface': {}, 'codex thread': {'CMUX_SURFACE_ID': SURFACE, 'CODEX_THREAD_ID': '01a18ac0-a906-7ba1-bf47-93e2bf1db6a7', 'CMUX_BUNDLED_CLI_PATH': '/bin/false'}}
        for name, extra in cases.items():
            done = subprocess.run([sys.executable, str(ROOT / 'tools/claude-pr-events.py'), str(self.log)], env={**base, **extra}, capture_output=True, text=True)
            self.assertEqual((done.returncode, done.stderr), (0, ''), name)


if __name__ == '__main__':
    unittest.main()
