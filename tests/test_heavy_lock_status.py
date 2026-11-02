"""`tools/heavy-lock.sh status` (11 Oct 2026): holders with session and class, waiters with class and wait, load and memory, and about how long a new run of each class would wait. Read-only."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.heavy_wait import status, wait_in_books, gate_loop

LOCK = Path(__file__).resolve().parent.parent / 'tools' / 'heavy-lock.sh'


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLockStatusTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.log = self.tmp / 'gate-timing.log'
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_HEAVY', 'JP_HEAVY'))}, 'JOBADABRA_HEAVY_DIR': (self.tmp / 'heavy').as_posix(),
                    'JOBADABRA_HEAVY_LOAD': '0', 'JOBADABRA_HEAVY_POLL': '0.1', 'JOBADABRA_HEAVY_TIMING_LOG': self.log.as_posix(), 'JOBADABRA_HEAVY_SHARED': str(LOCK),
                    'JOBADABRA_HEAVY_SLOTS': '1'}

    def start(self, what, body, **env):
        return subprocess.Popen(['bash', str(LOCK), what, 'bash', '-c', body], env={**self.env, **env}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def status(self):
        return subprocess.run(['bash', str(LOCK), 'status'], env=self.env, capture_output=True, text=True, timeout=30).stdout

    def test_a_free_lock_says_so_and_changes_nothing(self):
        out = self.status()
        self.assertIn('free: nobody holds it', out)
        self.assertIn('nobody waits', out)
        self.assertFalse((self.tmp / 'heavy' / 'lock').exists())

    def test_holders_and_waiters_are_listed_with_session_class_and_an_expected_wait(self):
        self.log.write_text('# 2026-10-11T10:00:00Z heavy lock run=100s wait=0s exit=0 what=real-extension class=proof\n# 2026-10-11T10:05:00Z heavy lock run=300s wait=0s exit=0 what=real-extension class=proof\n')
        go = (self.tmp / 'go').as_posix()
        hold = f'{gate_loop(go, 0.1)}'
        heavy = self.env['JOBADABRA_HEAVY_DIR']
        holder = self.start('real-extension', hold, JOBADABRA_SESSION='session-a')
        wait_in_books(heavy, holder, ('holds',), env=self.env)
        waiter = self.start('e2e-smoke', 'true', JOBADABRA_SESSION='session-b')
        wait_in_books(heavy, waiter, ('waits',), procs=[holder], env=self.env)   # THIS run's ticket is queued (CI, 12 Oct 2026: counting files said "two" for one run's slot and ticket: "nobody waits")
        out = self.status()
        Path(go).write_text('go')
        holder.communicate(timeout=30)
        waiter.communicate(timeout=30)
        self.assertRegex(out, r'holds  pid \d+  real-extension  class proof  session session-a  running \d+s  \(about \d+s left\)')
        self.assertRegex(out, r'waits  #1  pid \d+  e2e-smoke  class pool  session session-b  waited \d+s')
        self.assertIn('machine: 1-minute load', out)
        self.assertRegex(out, r'a new proof run would wait about \d+s')
        self.assertRegex(out, r'a new pool run would wait about \d+s')


if __name__ == '__main__':
    unittest.main()
