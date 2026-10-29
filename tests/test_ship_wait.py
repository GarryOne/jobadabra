"""tools/ship-wait.sh: a session's background wait for the next event line of a ship log (MERGED, RED, COMMENT, ...), past a Monitor's 30-minute cap.
Owner, 30 Oct 2026: "we don't have anymore the watches/monitors for when a PR merges" (#2486 merged after the session's Monitor had ended)."""
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WAIT = ROOT / 'tools' / 'ship-wait.sh'


class ShipWaitTest(unittest.TestCase):
    def setUp(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        self.log = tmp / 'ship-x.log'
        self.log.write_text('ship: [1s] running the push checks\nship: REVIEW #7 https://x/7 (every check green)\n')
        Path(f'{self.log}.seen').write_text('2\n')   # what an earlier wait already reported

    def start(self, **env):
        return subprocess.Popen(['sh', str(WAIT), str(self.log)], stdout=subprocess.PIPE, text=True,
                                env={**os.environ, 'SHIP_WAIT_POLL': '1', **env})

    def append(self, text):
        with self.log.open('a') as handle:
            handle.write(text)

    def test_the_merge_written_later_is_printed_and_progress_lines_are_not(self):
        waiter = self.start()
        time.sleep(1.5)
        self.assertIsNone(waiter.poll(), 'nothing new yet: it keeps waiting')
        self.append('ship: [99s] still waiting for checks\n')
        time.sleep(1.5)
        self.assertIsNone(waiter.poll(), 'a progress line is no event')
        self.append('ship: MERGED #7 9d0b7c7\n')
        out, _ = waiter.communicate(timeout=10)
        self.assertEqual(waiter.returncode, 0)
        self.assertEqual(out, 'ship: MERGED #7 9d0b7c7\n', 'only the new event, not the REVIEW it reported before')

    def test_the_next_run_reports_only_what_came_after(self):
        self.append('ship: COMMENT #7 bot review-approved https://x/7\n')
        first = subprocess.run(['sh', str(WAIT), str(self.log)], capture_output=True, text=True, timeout=10, env={**os.environ, 'SHIP_WAIT_POLL': '1'})
        self.assertEqual(first.stdout, 'ship: COMMENT #7 bot review-approved https://x/7\n')
        self.append('ship: GREEN #7\n')
        second = subprocess.run(['sh', str(WAIT), str(self.log)], capture_output=True, text=True, timeout=10, env={**os.environ, 'SHIP_WAIT_POLL': '1'})
        self.assertEqual(second.stdout, 'ship: GREEN #7\n')

    def test_a_line_still_being_written_waits_for_its_newline(self):
        self.append('ship: MERGED #7 9d0')
        waiter = self.start(SHIP_WAIT_CAP='2')
        out, _ = waiter.communicate(timeout=10)
        self.assertEqual(waiter.returncode, 3, 'half a line is not read: it ends at the cap with nothing')
        self.assertIn('nothing new', out)
        self.append('b7c7\n')
        done = subprocess.run(['sh', str(WAIT), str(self.log)], capture_output=True, text=True, timeout=10, env={**os.environ, 'SHIP_WAIT_POLL': '1'})
        self.assertEqual(done.stdout, 'ship: MERGED #7 9d0b7c7\n', 'the whole line once its newline is there')


if __name__ == '__main__':
    unittest.main()
