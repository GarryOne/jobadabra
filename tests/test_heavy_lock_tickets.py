"""A waiter's queue ticket never disappears while it waits (11 Oct 2026, CI red 3x): the lock rewrote tickets in place, another waiter read one half-written and deleted it as a dead waiter, so a younger run overtook it."""
import os
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

from tests.heavy_wait import registered, wait_in_books, gate_loop

LOCK = Path(__file__).resolve().parent.parent / 'tools' / 'heavy-lock.sh'


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLockTicketsTest(unittest.TestCase):
    def test_waiting_tickets_stay_in_the_queue_while_other_waiters_read_it(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        heavy, go = (tmp / 'heavy').as_posix(), (tmp / 'go').as_posix()
        env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_HEAVY', 'JP_HEAVY'))}, 'JOBADABRA_HEAVY_DIR': heavy, 'JOBADABRA_HEAVY_LOAD': '0',
               'JOBADABRA_HEAVY_POLL': '0.02', 'JOBADABRA_HEAVY_TIMING_LOG': (tmp / 'gate-timing.log').as_posix(), 'JOBADABRA_HEAVY_SHARED': str(LOCK), 'JOBADABRA_HEAVY_SLOTS': '1'}
        procs = [subprocess.Popen(['bash', str(LOCK), 'e2e-smoke', 'bash', '-c', f'{gate_loop(go, 0.05)}'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)]
        self.addCleanup(lambda: [p.kill() for p in procs])
        wait_in_books(heavy, procs[0], ('holds',), env=env)
        for n in range(2, 7):
            procs.append(subprocess.Popen(['bash', str(LOCK), 'e2e-smoke', 'true'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            wait_in_books(heavy, procs[-1], ('waits',), procs=procs, env=env)
        lowest, deadline = 6, time.monotonic() + 6
        while time.monotonic() < deadline:
            lowest = min(lowest, registered(heavy))
        Path(go).write_text('go')
        for p in procs:
            p.wait(timeout=60)
        self.assertEqual(lowest, 6, 'a waiting run dropped out of the lock\'s books')

    def test_a_ticket_caught_half_written_is_not_taken_for_a_dead_waiter(self):
        # what a loaded runner does to `mark`: the ticket is truncated, and the next waiter reads it before the write lands
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        heavy, go = tmp / 'heavy', (tmp / 'go').as_posix()
        env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_HEAVY', 'JP_HEAVY'))}, 'JOBADABRA_HEAVY_DIR': heavy.as_posix(), 'JOBADABRA_HEAVY_LOAD': '0',
               'JOBADABRA_HEAVY_POLL': '0.02', 'JOBADABRA_HEAVY_TIMING_LOG': (tmp / 'gate-timing.log').as_posix(), 'JOBADABRA_HEAVY_SHARED': str(LOCK), 'JOBADABRA_HEAVY_SLOTS': '1'}
        holder = subprocess.Popen(['bash', str(LOCK), 'e2e-smoke', 'bash', '-c', f'{gate_loop(go, 0.05)}'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        sleeper = subprocess.Popen(['sleep', '60'])
        self.addCleanup(lambda: (holder.kill(), sleeper.kill()))
        wait_in_books(heavy.as_posix(), holder, ('holds',), env=env)
        ticket = heavy / 'queue' / '1000000000000000000-1'          # an older waiter (a live pid), rewritten the slow way
        ticket.write_text(f'{sleeper.pid} e2e-smoke\n\n?\nother\n')
        stop, lost = threading.Event(), []

        def rewrite():
            while not stop.is_set():
                try:
                    fd = os.open(ticket, os.O_WRONLY | os.O_TRUNC)
                except FileNotFoundError:
                    lost.append(1)
                    return
                time.sleep(0.01)   # clock: the slow rewrite this test stages
                os.write(fd, f'{sleeper.pid} e2e-smoke\n\n?\nother\n'.encode())
                os.close(fd)
                time.sleep(0.002)   # clock: the slow rewrite this test stages
        writer = threading.Thread(target=rewrite)
        writer.start()
        younger = subprocess.Popen(['bash', str(LOCK), 'e2e-smoke', 'true'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(younger.kill)
        time.sleep(3)   # clock: how long the rewriter races the younger waiter; nothing is asserted about order
        stop.set()
        writer.join()
        Path(go).write_text('go')
        self.assertEqual(lost, [], 'a ticket read half-written was deleted as a dead waiter')

    def test_a_ticket_written_by_the_old_code_is_still_served_in_order(self):
        # a waiter queued before this change wrote its ticket in place: the new code must wait for it, and drop it once its pid is gone
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, True)
        heavy, go = tmp / 'heavy', (tmp / 'go').as_posix()
        env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_HEAVY', 'JP_HEAVY'))}, 'JOBADABRA_HEAVY_DIR': heavy.as_posix(), 'JOBADABRA_HEAVY_LOAD': '0',
               'JOBADABRA_HEAVY_POLL': '0.05', 'JOBADABRA_HEAVY_TIMING_LOG': (tmp / 'gate-timing.log').as_posix(), 'JOBADABRA_HEAVY_SHARED': str(LOCK), 'JOBADABRA_HEAVY_SLOTS': '1'}
        (heavy / 'queue').mkdir(parents=True)
        old = subprocess.Popen(['sleep', '60'])
        self.addCleanup(old.kill)
        (heavy / 'queue' / '1000000000000000000-1').write_text(f'{old.pid} e2e-smoke\n\nold-session\npool\n')
        trace = (tmp / 'trace').as_posix()
        new = subprocess.Popen(['bash', str(LOCK), 'e2e-smoke', 'bash', '-c', f'echo new >> {trace}'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(new.kill)
        time.sleep(1.5)   # clock: the new waiter must NOT go while the older one lives; a wrong start only gets time to show
        self.assertFalse(Path(trace).exists(), 'the new waiter went before an older waiter that is alive')
        old.kill()
        old.wait()   # reaped: a zombie still answers `kill -0`
        new.wait(timeout=60)
        self.assertEqual(Path(trace).read_text().split(), ['new'])


if __name__ == '__main__':
    unittest.main()
