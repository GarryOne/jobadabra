"""tools/landing-lock.sh: landings queue in arrival order on one Mac; a dead landing is dropped; the wait has a limit and an off switch."""
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from tests.heavy_wait import gate_loop

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / 'tools' / 'landing-lock.sh'


@unittest.skipUnless(shutil.which('bash') and shutil.which('git'), 'needs bash and git')
class LandingLockTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        subprocess.run(['git', 'init', '-q', str(self.tmp)], check=True)
        self.trace = self.tmp / 'trace'

    def landing(self, label, **env):
        """A landing that holds its turn until the test lets it go (a file), not for a guessed time."""
        gate = (self.tmp / f'go-{label}').as_posix()
        body = f'source "{LOCK}"; landing_acquire {label}; echo "{label} in" >> "{self.trace}"; {gate_loop(gate, 0.05)}; echo "{label} out" >> "{self.trace}"; landing_release'
        err_path = self.tmp / f'err-{label}'
        with open(err_path, 'w') as err:
            proc = subprocess.Popen(['bash', '-c', body], cwd=self.tmp, env={**os.environ, **env}, stdout=subprocess.PIPE, stderr=err, text=True)
        proc.err_path = err_path
        self.addCleanup(lambda: proc.poll() is None and (proc.kill(), proc.communicate()))
        return proc

    def said(self, proc, text):
        """Wait until the landing has said `text`: it looked at the queue (a queued ticket alone has not looked yet)."""
        self.wait_for(f'pid {proc.pid} never said {text!r} (it said {proc.err_path.read_text()!r})', lambda: text in proc.err_path.read_text() or proc.poll() is not None)
        self.assertIn(text, proc.err_path.read_text())

    def let_go(self, *labels):
        for label in labels:
            (self.tmp / f'go-{label}').write_text('go')

    def wait_for(self, what, condition, timeout=60):
        deadline = time.monotonic() + timeout
        while not condition():
            queue = self.tmp / '.git' / 'landing-queue'
            if time.monotonic() > deadline:
                raise AssertionError(f'{what} after {timeout}s; queue: {[(p.name, p.read_text().strip()) for p in queue.glob("*")] if queue.is_dir() else None}; trace: {self.trace.read_text() if self.trace.exists() else None!r}')
            time.sleep(0.05)   # clock: a poll of the queue's state

    def entered(self, label):
        self.wait_for(f'{label} never had its turn', lambda: self.trace.exists() and f'{label} in' in self.trace.read_text())

    def queued(self, proc):
        """Wait until THIS landing's ticket (its pid) is in the queue: the next one is younger."""
        queue = self.tmp / '.git' / 'landing-queue'
        self.wait_for(f'pid {proc.pid} never queued', lambda: queue.is_dir() and any(p.read_text().split()[:1] == [str(proc.pid)] for p in queue.glob('*') if p.is_file()))

    def test_landings_run_one_at_a_time_in_arrival_order(self):
        first = self.landing('first')
        self.entered('first')
        second = self.landing('second')
        self.queued(second)
        third = self.landing('third')
        self.said(third, 'waiting for the landing of first')
        self.let_go('first', 'second', 'third')
        third.communicate(timeout=30)
        second.communicate(timeout=30)
        first.communicate(timeout=30)
        err = third.err_path.read_text()
        self.assertEqual(self.trace.read_text().split('\n')[:-1], ['first in', 'first out', 'second in', 'second out', 'third in', 'third out'])
        self.assertIn('waiting for the landing of', err)
        self.assertIn('first', err)

    def test_a_dead_landing_ahead_is_dropped(self):
        queue = self.tmp / '.git' / 'landing-queue'
        queue.mkdir()
        (queue / '1-999999').write_text('999999 crashed\n')
        self.let_go('next')
        done = self.landing('next')
        done.communicate(timeout=30)
        self.assertEqual(self.trace.read_text().split('\n')[:-1], ['next in', 'next out'])
        self.assertEqual(list(queue.iterdir()), [], 'the dead ticket and the finished one are gone')

    def test_the_wait_has_a_limit_and_an_off_switch(self):
        holder = self.landing('holder')
        self.entered('holder')
        self.let_go('impatient', 'off')
        impatient = self.landing('impatient', SHIP_LANDING_WAIT='2')
        impatient.communicate(timeout=60)
        self.assertIn('landing anyway', impatient.err_path.read_text())
        off = self.landing('off', SHIP_LANDING_LOCK='0')
        off.communicate(timeout=30)
        self.let_go('holder')
        holder.communicate(timeout=30)
        self.assertIn('off in', self.trace.read_text())

    def test_ship_sh_queues_only_when_asked_and_releases(self):
        ship = (ROOT / 'tools' / 'ship.sh').read_text()
        self.assertIn('case "${SHIP_LANDING_LOCK:-auto}" in', ship, 'the queue is decided per landing (owner, 11 Oct 2026)')
        self.assertIn('git diff --name-only origin/main...HEAD -- $slow_gate_paths', ship, 'a landing that runs the slow gates queues; others go straight through')
        self.assertLess(ship.index('landing_acquire "$branch"'), ship.index('rebase\nif [ "$(git rev-list'), 'when asked, queued before the first rebase')
        self.assertIn('landing_release;', ship)   # in the exit trap

    def test_a_refused_push_is_checked_again_before_it_is_pushed(self):
        # Without a queue two landings can cross: what reaches main must be checked on top of what just landed, never pushed untested.
        ship = (ROOT / 'tools' / 'ship.sh').read_text()
        retry = ship[ship.index('for attempt in 1 2 3 4 5; do'):ship.index('done', ship.index('for attempt in 1 2 3 4 5; do'))]
        self.assertLess(retry.index('rebase'), retry.index('run_checks'), 'rebase, then the checks, then the next push')
        self.assertIn('[ "$attempt" -lt 5 ] || break', retry, 'the last refused push does not rebase and re-check for nothing')

    def test_no_extension_version_is_taken_at_landing(self):
        # Since 13 Oct 2026 the build stamps the extension's version (desktop/scripts/extension-stamp.mjs): no merge driver in .gitattributes, no step in ship.sh.
        attributes = (ROOT / '.gitattributes').read_text()
        ship = (ROOT / 'tools' / 'ship.sh').read_text()
        for gone in ('ext-manifest', 'ext-fingerprint', 'take_extension_version', 'fingerprint.json'):
            self.assertNotIn(gone, attributes + ship, gone)

    def test_a_wait_is_logged_for_the_next_measurement(self):
        first = self.landing('first')
        self.entered('first')
        second = self.landing('second')
        self.said(second, 'waiting for the landing of first')   # it waited: only a wait is logged
        self.let_go('first', 'second')
        second.communicate(timeout=30)
        first.communicate(timeout=30)
        log = (self.tmp / '.git' / 'gate-timing.log').read_text()
        self.assertRegex(log, r'landing queue wait=\d+s label=second')


if __name__ == '__main__':
    unittest.main()
