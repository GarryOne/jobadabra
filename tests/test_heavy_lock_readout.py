"""tools/heavy-lock.sh names who loads the Mac (11 Oct 2026): the wait message says who holds the lock and the 3 programs using the most CPU; every hold's line in gate-timing.log carries them as top=name:cpu,...; JOBADABRA_HEAVY_TOP=0 leaves them out. A fake `ps` on PATH serves the process table."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.heavy_wait import evidence, wait_in_books, wait_said, gate_loop

LOCK = Path(__file__).resolve().parent.parent / 'tools' / 'heavy-lock.sh'
TABLE = ' 80.0 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper\n 40.0 /usr/local/bin/node\n 60.0 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper\n  3.0 claude\n 55.0 /usr/bin/python3\n  0.0 idle\n'


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLockReadoutTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir()
        (self.tmp / 'table').write_text(TABLE)
        real_ps = shutil.which('ps')
        (bin_dir / 'ps').write_text(f'#!/bin/sh\nif [ "$*" = "-Ao pcpu=,comm=" ]; then cat "{(self.tmp / "table").as_posix()}"; else exec {real_ps} "$@"; fi\n')
        (bin_dir / 'ps').chmod(0o755)
        self.log = self.tmp / 'gate-timing.log'
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_HEAVY', 'JP_HEAVY'))}, 'PATH': f'{bin_dir.as_posix()}{os.pathsep}{os.environ["PATH"]}',
                    'JOBADABRA_HEAVY_DIR': (self.tmp / 'heavy').as_posix(), 'JOBADABRA_HEAVY_SHARED': str(LOCK), 'JOBADABRA_HEAVY_TIMING_LOG': self.log.as_posix(),
                    'JOBADABRA_HEAVY_LOAD': '0', 'JOBADABRA_HEAVY_POLL': '0.1', 'JOBADABRA_HEAVY_SLOTS': '1', 'JOBADABRA_SESSION': 'sess-a'}

    def start(self, what, body, **env):
        return subprocess.Popen(['bash', str(LOCK), what, 'bash', '-c', body], env={**self.env, **env}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def wait_for_lock(self, **env):
        go = (self.tmp / 'go').as_posix()
        heavy = self.env['JOBADABRA_HEAVY_DIR']
        holder = self.start('e2e-smoke', f'{gate_loop(go, 0.1)}', **env)
        wait_in_books(heavy, holder, ('holds',), env=self.env)
        err_path = self.tmp / 'err-waiter'
        with open(err_path, 'w') as err_out:
            waiter = subprocess.Popen(['bash', str(LOCK), 'e2e-smoke', 'true'], env={**self.env, **env}, stdout=subprocess.PIPE, stderr=err_out, text=True)
        wait_said(err_path, 'e2e-smoke waits', waiter, why=lambda: evidence(heavy, [holder], self.env))   # the waiter said it waits: not a guessed 1 s
        Path(go).write_text('go')
        waiter.communicate(timeout=60)
        holder.communicate(timeout=60)
        return err_path.read_text()

    def test_the_wait_message_names_the_three_biggest_cpu_users_summed_by_program(self):
        err = self.wait_for_lock()
        self.assertIn('using the CPU: Google Chrome Helper 140%, python3 55%, node 40%', err)
        self.assertIn('session sess-a', err)

    def test_every_hold_logs_the_top_programs_for_the_report(self):
        self.start('row-replay', 'true').communicate(timeout=30)
        self.assertIn('top=Google_Chrome_Helper:140%,python3:55%,node:40%', self.log.read_text())

    def test_the_readout_can_be_left_out(self):
        err = self.wait_for_lock(JOBADABRA_HEAVY_TOP='0')
        self.assertNotIn('Google Chrome', err)
        self.assertNotIn('Google_Chrome', self.log.read_text())


if __name__ == '__main__':
    unittest.main()
