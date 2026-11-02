"""tools/heavy-lock.sh priority classes (11 Oct 2026): a proof that blocks a landing goes before the pool's and exploratory runs, each waiter that is overtaken only while it has waited under a cap; the class comes from the `what` name or JOBADABRA_HEAVY_CLASS and is logged. Shortness inside a class: test_heavy_lock_short_first.py."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.heavy_wait import wait_in_books, wait_read_queue, gate_loop

LOCK = Path(__file__).resolve().parent.parent / 'tools' / 'heavy-lock.sh'


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLockClassesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.log = self.tmp / 'gate-timing.log'
        self.trace = (self.tmp / 'trace').as_posix()
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_HEAVY', 'JP_HEAVY'))}, 'JOBADABRA_HEAVY_DIR': (self.tmp / 'heavy').as_posix(),
                    'JOBADABRA_HEAVY_LOAD': '0', 'JOBADABRA_HEAVY_POLL': '0.1', 'JOBADABRA_HEAVY_TIMING_LOG': self.log.as_posix(), 'JOBADABRA_HEAVY_SHARED': str(LOCK),
                    'JOBADABRA_HEAVY_SLOTS': '1'}

    def start(self, what, name, body=None, **env):
        body = body or f'echo {name} >> {self.trace}'
        return subprocess.Popen(['bash', str(LOCK), what, 'bash', '-c', body], env={**self.env, **env}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def order(self, waiters, **env):
        """A gated holder runs until every waiter is queued; the waiters (what, name, extra env) then run in the order the lock picks; returns the run order."""
        heavy, go = self.env['JOBADABRA_HEAVY_DIR'], (self.tmp / 'go').as_posix()
        procs = [self.start('real-extension', 'holder', f'echo holder >> {self.trace}; {gate_loop(go, 0.05)}', **env)]
        wait_in_books(heavy, procs[0], ('holds',), env=self.env)
        for what, name, extra in waiters:
            procs.append(self.start(what, name, **{**env, **extra}))
            wait_in_books(heavy, procs[-1], ('waits',), procs=procs, env=self.env)   # its ticket is queued: the next one reads a later clock
        wait_read_queue(heavy, procs[1:], env=self.env)   # every waiter has read the full queue: the holder may end
        Path(go).write_text('go')
        for p in procs:
            p.communicate(timeout=60)
        return Path(self.trace).read_text().split()

    def test_a_proof_goes_ahead_of_older_pool_and_explore_runs(self):
        self.assertEqual(self.order([('e2e-smoke', 'pool', {}), ('discover-1', 'explore', {}), ('real-extension', 'proof', {})]), ['holder', 'proof', 'pool', 'explore'])

    def test_the_pool_goes_ahead_of_older_exploration(self):
        self.assertEqual(self.order([('discover-1', 'explore', {}), ('e2e-smoke', 'pool', {})]), ['holder', 'pool', 'explore'])

    def test_the_class_can_be_set_by_the_caller_not_just_by_the_name(self):
        waiters = [('e2e-smoke', 'pool', {}), ('e2e-smoke', 'held-row', {'JOBADABRA_HEAVY_CLASS': 'proof'})]
        self.assertEqual(self.order(waiters), ['holder', 'held-row', 'pool'])

    def test_a_waiter_past_the_starvation_cap_is_not_overtaken_and_the_switch_gives_arrival_order(self):
        waiters = [('e2e-smoke', 'pool', {}), ('real-extension', 'proof', {})]
        self.assertEqual(self.order(waiters, JOBADABRA_HEAVY_STARVE='0'), ['holder', 'pool', 'proof'])
        self.tearDown(); self.setUp()
        self.assertEqual(self.order(waiters, JOBADABRA_HEAVY_CLASSES='0'), ['holder', 'pool', 'proof'])

    def test_the_class_is_logged_with_every_hold(self):
        self.start('row-replay', 'x').communicate(timeout=30)
        self.start('e2e-smoke', 'y', JOBADABRA_HEAVY_CLASS='proof').communicate(timeout=30)
        lines = [l for l in self.log.read_text().splitlines() if 'heavy lock run=' in l]
        self.assertIn('class=proof', lines[0])
        self.assertIn('what=e2e-smoke class=proof', lines[1])


if __name__ == '__main__':
    unittest.main()
