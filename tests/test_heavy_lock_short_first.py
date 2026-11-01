"""tools/heavy-lock.sh shortest first (11 Oct 2026): a row replay (~15 s) goes ahead of older longer waiters instead of waiting behind a ~70 s live run, a longer waiter yields to it,
replays wait for the memory gate and not the load, tickets and slots name their session. Nobody starves (JOBADABRA_HEAVY_SHORT_AGE); JOBADABRA_HEAVY_SHORT_FIRST=0 is strict arrival order. Base lock tests: test_heavy_lock.py."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.heavy_wait import evidence, wait_in_books, wait_read_queue, wait_said, gate_loop

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / 'tools' / 'heavy-lock.sh'


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLockShortFirstTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_HEAVY', 'JP_HEAVY', 'JOBADABRA_SESSION'))},
                    'JOBADABRA_HEAVY_DIR': str(self.tmp / 'heavy'), 'JOBADABRA_HEAVY_LOAD': '0', 'JOBADABRA_HEAVY_POLL': '0.1',
                    'JOBADABRA_HEAVY_TIMING_LOG': str(self.tmp / 'gate-timing.log'), 'JOBADABRA_HEAVY_SHARED': str(LOCK), 'JOBADABRA_HEAVY_SLOTS': '1'}
        self.trace = (self.tmp / 'trace').as_posix()

    def start(self, what, body, **env):
        return subprocess.Popen(['bash', str(LOCK), what, 'bash', '-c', body], env={**self.env, **env}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def order(self, **env):
        """A gated holder runs until a longer run (real-extension) and a row replay are queued; returns the order they ran in."""
        heavy, go = self.env['JOBADABRA_HEAVY_DIR'], (self.tmp / 'go').as_posix()
        holder = self.start('recorded-replay-holder', f'echo holder >> {self.trace}; {gate_loop(go, 0.05)}', **env)
        wait_in_books(heavy, holder, ('holds',), env=self.env)
        longer = self.start('real-extension', f'echo long >> {self.trace}', **env)
        wait_in_books(heavy, longer, ('waits',), procs=[holder], env=self.env)
        row = self.start('row-replay', f'echo row >> {self.trace}', **env)
        wait_in_books(heavy, row, ('waits',), procs=[holder, longer], env=self.env)
        wait_read_queue(heavy, [longer, row], env=self.env)   # both have read the full queue: the holder may end
        Path(go).write_text('go')
        for p in (holder, longer, row):
            p.communicate(timeout=30)
        return Path(self.trace).read_text().split()

    def test_a_row_replay_goes_ahead_of_an_older_longer_waiter(self):
        self.assertEqual(self.order(), ['holder', 'row', 'long'])

    def test_strict_arrival_order_with_the_switch_off(self):
        self.assertEqual(self.order(JOBADABRA_HEAVY_SHORT_FIRST='0'), ['holder', 'long', 'row'])

    def test_a_longer_waiter_that_has_waited_past_the_age_limit_is_not_overtaken(self):
        self.assertEqual(self.order(JOBADABRA_HEAVY_SHORT_AGE='0'), ['holder', 'long', 'row'])

    def test_replays_wait_for_memory_not_load_and_a_live_run_still_waits_for_the_load(self):
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'uptime').write_text('#!/bin/sh\necho "10:00  up 1 day, load averages: 99.00 99.00 99.00"\n')
        (bin_dir / 'uptime').chmod(0o755)
        busy = {'PATH': f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', 'JOBADABRA_HEAVY_SIGNAL': 'load', 'JOBADABRA_HEAVY_LOAD': '4', 'JOBADABRA_HEAVY_LOAD_WAIT': '2'}
        for what in ('row-replay', 'row-try', 'recorded-replay'):
            _, err = self.start(what, 'true', **busy).communicate(timeout=30)
            self.assertNotIn('waits for the machine', err, what)
        _, err = self.start('e2e-smoke', 'true', **busy).communicate(timeout=30)
        self.assertIn('waits for the machine', err)
        _, err = self.start('row-replay', 'true', JOBADABRA_HEAVY_REPLAY_LOAD='1', **busy).communicate(timeout=30)
        self.assertIn('waits for the machine', err, 'JOBADABRA_HEAVY_REPLAY_LOAD=1 puts replays back behind the load wait')

    def test_the_wait_message_names_the_session_that_holds_the_lock_and_the_one_ahead(self):
        go = (self.tmp / 'go').as_posix()
        holder = self.start('e2e-smoke', f'{gate_loop(go, 0.05)}', JOBADABRA_SESSION='session-a')
        wait_in_books(self.env['JOBADABRA_HEAVY_DIR'], holder, ('holds',), env=self.env)   # it holds: not a guessed 0.4 s
        err_path = self.tmp / 'err-waiter'
        with open(err_path, 'w') as err_out:
            waiter = subprocess.Popen(['bash', str(LOCK), 'e2e-smoke', 'true'], env={**self.env, 'JOBADABRA_SESSION': 'session-b'}, stdout=subprocess.PIPE, stderr=err_out, text=True)
        wait_said(err_path, 'e2e-smoke waits', waiter, why=lambda: evidence(self.env['JOBADABRA_HEAVY_DIR'], [holder], self.env))   # it looked and said who holds the lock
        Path(go).write_text('go')
        waiter.communicate(timeout=30)
        holder.communicate(timeout=30)
        err = err_path.read_text()
        self.assertIn('session session-a', err)


if __name__ == '__main__':
    unittest.main()
