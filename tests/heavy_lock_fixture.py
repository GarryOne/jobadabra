"""The shared fixture of the tools/heavy-lock.sh tests that wait on each other (not a test module): a private lock folder, a fake vm_stat/sysctl for the memory gate, and start/run helpers.
Used by test_heavy_lock.py (queue, stale locks, load wait, hand-off) and test_heavy_lock_memory.py (the memory gate). The newer lock tests (classes, budget, yield...) carry their own small setUp."""
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from tests.heavy_wait import evidence, wait_in_books, wait_said, gate_loop

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / 'tools' / 'heavy-lock.sh'



@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLockFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_HEAVY', 'JP_HEAVY'))},
                    'JOBADABRA_HEAVY_DIR': str(self.tmp / 'heavy'), 'JOBADABRA_HEAVY_LOAD': '0', 'JOBADABRA_HEAVY_POLL': '0.1',   # the script looks at the queue every 0.1 s here, not every second
                    'JOBADABRA_HEAVY_TIMING_LOG': str(self.tmp / 'gate-timing.log'),
                    'JOBADABRA_HEAVY_SHARED': str(LOCK),   # this file IS the copy under test: never hand off to the primary checkout's
                    'JOBADABRA_HEAVY_SLOTS': '1',         # one at a time unless a test opens the memory-gated 2nd slot
                    'JOBADABRA_HEAVY_RAMP': '0'}           # these tests check the floors only; tests/test_heavy_lock_budget.py checks the reservation of a run that just started

    def memory(self, free_gb, swap_used_pct):
        """Fake vm_stat and sysctl on PATH: free+inactive memory and swap use as given; returns the env for a 2-slot run."""
        bin_dir = self.tmp / f'bin-{free_gb}-{swap_used_pct}'
        bin_dir.mkdir(exist_ok=True)
        pages = int(free_gb * 1024 ** 3 / 16384 / 2)
        (bin_dir / 'vm_stat').write_text('#!/bin/sh\n' f'printf "Mach Virtual Memory Statistics: (page size of 16384 bytes)\\nPages free:  {pages}.\\nPages active:  999.\\nPages inactive:  {pages}.\\n"\n')
        (bin_dir / 'sysctl').write_text('#!/bin/sh\ncase "$*" in *swapusage*) ' f'echo "total = 4096.00M  used = {4096 * swap_used_pct / 100:.2f}M  free = 0.00M  (encrypted)";; *) echo 8;; esac\n')
        for name in ('vm_stat', 'sysctl'):
            (bin_dir / name).chmod(0o755)
        return {'PATH': f'{bin_dir}{os.pathsep}{os.environ["PATH"]}', 'JOBADABRA_HEAVY_SLOTS': '2'}

    def start(self, what, *command, **env):
        return subprocess.Popen(['bash', str(LOCK), what, *command], env={**self.env, **env}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def hold(self, what='holder', **env):
        """A run that holds the lock until the returned function is called; returns once THIS run holds a slot (the lock's own state, not a guessed nap)."""
        go = self.tmp / f'go-{what.replace(" ", "-")}'
        proc = self.start(what, 'bash', '-c', f'{gate_loop(go.as_posix(), 0.05)}', **env)
        self.addCleanup(lambda: (go.write_text('go'), proc.poll() is None and proc.communicate(timeout=30)))
        wait_in_books(env.get('JOBADABRA_HEAVY_DIR', self.env['JOBADABRA_HEAVY_DIR']), proc, ('holds',), env={**self.env, **env})
        def let_go():
            go.write_text('go')
            return proc.communicate(timeout=30)
        return proc, let_go

    def start_logged(self, what, *command, **env):
        """start() with stderr in a file, so a test can wait for what the run says while it still runs (proc.err_path)."""
        err_path = self.tmp / f'err-{what.replace(" ", "-")}'
        with open(err_path, 'w') as err:
            proc = subprocess.Popen(['bash', str(LOCK), what, *command], env={**self.env, **env}, stdout=subprocess.PIPE, stderr=err, text=True)
        proc.err_path = err_path
        self.addCleanup(lambda: proc.poll() is None and (proc.kill(), proc.communicate()))
        return proc

    def said(self, proc, text, *others):
        """Wait until the run has said `text` (it looked at the lock and decided); fails at once if it ended without saying it, with the lock's evidence."""
        return wait_said(proc.err_path, text, proc, why=lambda: evidence(self.env['JOBADABRA_HEAVY_DIR'], [proc, *others], self.env))

    def run_lock(self, what, *command, **env):
        return subprocess.run(['bash', str(LOCK), what, *command], env={**self.env, **env}, capture_output=True, text=True)
