"""tools/heavy-lock.sh frees dead or hung holders (12 Oct 2026: a cancelled replay's wrapper was orphaned and its children hung at 0% CPU, the lock sat held 27 min):
a cancelled wrapper kills its whole process group; a slot whose session is gone (or whose wrapper is orphaned) is freed by the next run, which kills the old tree by its recorded pgid;
a holder whose tree used no CPU for the idle limit is freed the same way; a busy holder never is. Own temp lock root, never the real one."""
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from tests.heavy_wait import evidence

LOCK = Path(__file__).resolve().parent.parent / 'tools' / 'heavy-lock.sh'


def alive(pid):
    try:
        os.kill(int(pid), 0)
    except (OSError, ValueError):
        return False
    state = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(state) and not state.startswith('Z')


def wait_for(condition, timeout=90):   # a ceiling for a hang, not a guess of speed: a loaded Mac (load 270, 12 Oct 2026) took over 20 s to start a holder's children
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.1)   # clock: a poll of the condition
    return condition()


@unittest.skipUnless(shutil.which('bash') and shutil.which('python3'), 'needs bash and python3')
class HeavyLockReapTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.heavy = self.tmp / 'heavy'
        self.log = self.tmp / 'gate-timing.log'
        self.pids = self.tmp / 'pids'
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_HEAVY', 'JP_HEAVY'))},
                    'JOBADABRA_HEAVY_DIR': self.heavy.as_posix(), 'JOBADABRA_HEAVY_LOAD': '0', 'JOBADABRA_HEAVY_POLL': '0.1',
                    'JOBADABRA_HEAVY_TIMING_LOG': self.log.as_posix(), 'JOBADABRA_HEAVY_SHARED': str(LOCK), 'JOBADABRA_HEAVY_SLOTS': '1',
                    'JOBADABRA_HEAVY_RAMP': '0'}
        self.procs = []
        self.addCleanup(self.cleanup)

    def cleanup(self):
        if self.pids.exists():   # the run's children first: they hold the holder's pipes open, and communicate() would wait for them (300 s)
            for pid in self.pids.read_text().split():
                try:
                    os.kill(int(pid), signal.SIGKILL)
                except (OSError, ValueError):
                    pass
        for p in self.procs:
            if p.poll() is None:
                p.kill()
            p.communicate()

    def start(self, what, *command, **env):
        p = subprocess.Popen(['bash', str(LOCK), what, *command], env={**self.env, **env}, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.procs.append(p)
        return p

    def evidence(self, *procs):
        return evidence(self.heavy, [p for p in procs if p], self.env)

    def next_run(self):
        """The next run, which must free the dead or idle holder; its own wait limit is long so only the freeing ends it (load 270 outlasted 60 s, 12 Oct 2026)."""
        try:
            return subprocess.run(['bash', str(LOCK), 'next', 'echo', 'ran'], env={**self.env, 'JOBADABRA_HEAVY_WAIT': '900'}, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired as e:
            raise AssertionError(f'the next run did not free the holder in 600 s: {e.stderr!r}; {self.evidence()}')

    def hung_holder(self, **env):
        """A holder whose command starts two background sleeps (their pids written to a file) and waits on them: a run with children."""
        body = f'sleep 300 & echo $! >> {self.pids.as_posix()}; sleep 300 & echo $! >> {self.pids.as_posix()}; wait'
        p = self.start('replay-hung', 'bash', '-c', body, **env)
        started = lambda: self.pids.exists() and len(self.pids.read_text().split()) == 2
        self.assertTrue(wait_for(lambda: started() or p.poll() is not None) and started(), f'the holder started its children; {self.evidence(p)}')
        self.assertTrue(wait_for(lambda: (self.heavy / 'lock' / 'pgid').exists() or p.poll() is not None) and (self.heavy / 'lock' / 'pgid').exists(), f'the slot records the run\'s process group; {self.evidence(p)}')
        return p, self.pids.read_text().split()

    def test_cancelling_the_wrapper_kills_every_child_and_frees_the_slot(self):
        p, children = self.hung_holder()
        p.send_signal(signal.SIGTERM)
        p.communicate(timeout=30)
        self.assertTrue(wait_for(lambda: not any(alive(c) for c in children)), 'no child of the cancelled run survives')
        self.assertFalse((self.heavy / 'lock').exists(), 'the slot is free')

    def test_a_holder_whose_session_is_gone_is_freed_and_its_tree_killed(self):
        session = subprocess.Popen(['sleep', '300'])
        self.addCleanup(session.kill)
        p, children = self.hung_holder(JOBADABRA_SESSION_PID=str(session.pid))
        self.assertTrue(wait_for(lambda: (self.heavy / 'lock' / 'session_pid').exists()), 'the slot records the session')
        self.assertEqual((self.heavy / 'lock' / 'session_pid').read_text().strip(), str(session.pid))
        session.kill()
        session.wait()
        result = self.next_run()
        self.assertEqual(result.stdout.strip(), 'ran')
        self.assertIn('freed: session gone', result.stderr)
        self.assertIn('replay-hung', result.stderr)
        self.assertTrue(wait_for(lambda: not any(alive(c) for c in children)), 'the old tree was killed')
        self.assertTrue(wait_for(lambda: p.poll() is not None), 'the old wrapper ended')
        self.assertIn('forced-free reason=session_gone', self.log.read_text())

    def test_an_orphaned_wrapper_is_freed(self):
        """The wrapper's parent died (pid 1 adopts it): the real incident. Skipped where the OS reparents to a subreaper other than pid 1."""
        script = f'bash {LOCK} replay-orphan bash -c "sleep 300 & echo \\$! >> {self.pids.as_posix()}; wait" & echo $! > {(self.tmp / "wrapper").as_posix()}'
        subprocess.run(['bash', '-c', script], env=self.env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        self.assertTrue(wait_for(lambda: (self.heavy / 'lock' / 'pgid').exists() and self.pids.exists()))
        wrapper = (self.tmp / 'wrapper').read_text().strip()
        ppid = subprocess.run(['ps', '-o', 'ppid=', '-p', wrapper], capture_output=True, text=True).stdout.strip()
        if ppid != '1':
            os.kill(int(wrapper), signal.SIGKILL)
            self.skipTest(f'the wrapper was adopted by pid {ppid}, not 1')
        children = self.pids.read_text().split()
        result = self.next_run()
        self.assertEqual(result.stdout.strip(), 'ran')
        self.assertIn('freed: session gone', result.stderr)
        self.assertTrue(wait_for(lambda: not any(alive(c) for c in children)))

    def test_an_idle_holder_is_freed_after_the_idle_limit(self):
        p, children = self.hung_holder(JOBADABRA_HEAVY_IDLE='2')
        result = subprocess.run(['bash', str(LOCK), 'next', 'echo', 'ran'], env={**self.env, 'JOBADABRA_HEAVY_IDLE': '2', 'JOBADABRA_HEAVY_WAIT': '900'}, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=600)
        self.assertEqual(result.stdout.strip(), 'ran')
        freed = re.search(r'freed: idle (\d+)s', result.stderr)
        self.assertTrue(freed, result.stderr)
        # The lock's own idle measure, not seconds since this test's start: the holder went quiet before the waiter began (CI saw 1.375 s here, 12 Oct 2026).
        self.assertGreaterEqual(int(freed.group(1)), 2, 'not freed before the idle limit')
        self.assertTrue(wait_for(lambda: not any(alive(c) for c in children)))
        self.assertRegex(self.log.read_text(), r'forced-free reason=idle_\d+s')

    def test_a_busy_holder_is_never_freed(self):
        stop = (self.tmp / 'stop').as_posix()
        busy = f'import os, time\nwhile not os.path.exists({stop!r}):\n    sum(range(20000))\n'
        holder = self.start('replay-busy', 'python3', '-c', busy, JOBADABRA_HEAVY_IDLE='4')
        self.assertTrue(wait_for(lambda: (self.heavy / 'lock' / 'pgid').exists()))
        waiter = subprocess.Popen(['bash', str(LOCK), 'next', 'echo', 'ran'], env={**self.env, 'JOBADABRA_HEAVY_IDLE': '4', 'JOBADABRA_HEAVY_WAIT': '900'}, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.procs.append(waiter)
        time.sleep(7)   # clock: past the 4 s idle limit a working holder must NOT be freed; the lock measures its own CPU clock, the test only gives a wrong free time to show
        self.assertIsNone(waiter.poll(), 'the waiter is still waiting behind a busy holder')
        self.assertIsNone(holder.poll(), 'the busy holder was not killed')
        Path(stop).write_text('stop')
        out, err = waiter.communicate(timeout=600)
        self.assertEqual(out.strip(), 'ran')
        self.assertNotIn('freed:', err)
        self.assertEqual(holder.wait(timeout=30), 0, 'the busy run finished on its own')

    def test_a_killed_wrapper_leaves_no_children_behind_when_the_next_run_takes_over(self):
        p, children = self.hung_holder()
        p.kill()   # SIGKILL: no trap runs, the children live on in their group (they hold the pipes: wait, not communicate)
        p.wait()
        self.assertTrue(any(alive(c) for c in children), 'setup: the children outlived the wrapper')
        result = self.next_run()
        self.assertEqual(result.stdout.strip(), 'ran')
        self.assertIn('taking over a stale lock', result.stderr)
        self.assertTrue(wait_for(lambda: not any(alive(c) for c in children)), 'the leftover group was killed')
        self.assertIn('forced-free reason=wrapper_gone', self.log.read_text())

    def test_status_says_why_a_holder_is_about_to_be_freed(self):
        session = subprocess.Popen(['sleep', '300'])
        self.addCleanup(session.kill)
        self.hung_holder(JOBADABRA_SESSION_PID=str(session.pid))
        self.assertTrue(wait_for(lambda: (self.heavy / 'lock' / 'session_pid').exists()))
        session.kill()
        session.wait()
        out = subprocess.run(['bash', str(LOCK), 'status'], env=self.env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30).stdout
        self.assertIn('session gone', out)


if __name__ == '__main__':
    unittest.main()
