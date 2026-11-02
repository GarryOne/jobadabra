"""`heavy-lock.sh yield` (11 Oct 2026): a run that holds the lock between two parts of its work (the pool, between sites) gives its place to a waiter of a higher class or a shorter run, and waits for it back; with nobody to give it to, it returns at once. Today a pool run held the lock for its whole list."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.heavy_wait import wait_in_books, gate_loop

LOCK = Path(__file__).resolve().parent.parent / 'tools' / 'heavy-lock.sh'


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLockYieldTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.trace = (self.tmp / 'trace').as_posix()
        self.log = self.tmp / 'gate-timing.log'
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_HEAVY', 'JP_HEAVY'))}, 'JOBADABRA_HEAVY_DIR': (self.tmp / 'heavy').as_posix(),
                    'JOBADABRA_HEAVY_LOAD': '0', 'JOBADABRA_HEAVY_POLL': '0.1', 'JOBADABRA_HEAVY_TIMING_LOG': self.log.as_posix(), 'JOBADABRA_HEAVY_SHARED': str(LOCK),
                    'JOBADABRA_HEAVY_SLOTS': '1'}

    def pool(self, **env):
        """A pool run: part 1 (until the test says go), a yield point, part 2 (0.3 s)."""
        self.go = self.tmp / 'go'
        body = f'echo +pool1 >> {self.trace}; {gate_loop(self.go.as_posix(), 0.1)}; bash {LOCK} yield; echo +pool2 >> {self.trace}; sleep 0.3; echo -pool >> {self.trace}'
        return subprocess.Popen(['bash', str(LOCK), 'e2e-smoke', 'bash', '-c', body], env={**self.env, **env}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def waiter(self, what, name, nap='0.3', **env):
        return subprocess.Popen(['bash', str(LOCK), what, 'bash', '-c', f'echo +{name} >> {self.trace}; sleep {nap}; echo -{name} >> {self.trace}'],
                                env={**self.env, **env}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def finish(self, *procs):
        errs = [p.communicate(timeout=60)[1] for p in procs]
        return Path(self.trace).read_text().split(), errs

    def test_a_pool_run_gives_its_place_to_a_waiting_proof_at_the_yield_point_and_gets_it_back(self):
        heavy = self.env['JOBADABRA_HEAVY_DIR']
        pool = self.pool()
        wait_in_books(heavy, pool, ('holds',), env=self.env)
        proof = self.waiter('real-extension', 'proof')
        wait_in_books(heavy, proof, ('waits',), procs=[pool], env=self.env)   # its ticket is in the queue before the pool reaches its yield point
        self.go.write_text('go')
        trace, errs = self.finish(pool, proof)
        self.assertEqual(trace, ['+pool1', '+proof', '-proof', '+pool2', '-pool'])
        self.assertIn('yields its place to real-extension', errs[0])
        self.assertIn('has its place back', errs[0])
        text = self.log.read_text()
        self.assertIn('heavy lock yield what=e2e-smoke class=pool', text)
        self.assertIn('yield-back', text)

    def test_with_nobody_of_a_higher_class_waiting_it_returns_at_once_and_keeps_the_lock(self):
        heavy = self.env['JOBADABRA_HEAVY_DIR']
        pool = self.pool()
        wait_in_books(heavy, pool, ('holds',), env=self.env)
        other = self.waiter('e2e-smoke', 'pool-b')     # the same class: no reason to yield
        wait_in_books(heavy, other, ('waits',), procs=[pool], env=self.env)
        self.go.write_text('go')
        trace, errs = self.finish(pool, other)
        self.assertEqual(trace, ['+pool1', '+pool2', '-pool', '+pool-b', '-pool-b'])
        self.assertNotIn('yields', errs[0])

    def test_outside_a_hold_and_with_the_lock_switched_off_it_does_nothing(self):
        self.assertEqual(subprocess.run(['bash', str(LOCK), 'yield'], env=self.env, capture_output=True, text=True, timeout=20).returncode, 0)
        self.assertEqual(subprocess.run(['bash', str(LOCK), 'yield'], env={**self.env, 'JP_HEAVY_HELD': '1', 'JOBADABRA_HEAVY': '0'}, capture_output=True, text=True, timeout=20).returncode, 0)
        self.assertFalse((self.tmp / 'heavy' / 'lock').exists())


if __name__ == '__main__':
    unittest.main()
