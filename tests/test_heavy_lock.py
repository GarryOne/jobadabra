"""tools/heavy-lock.sh, 1 of 2 (queue and hand-off): one heavy run at a time per lock slot, in arrival order, through the primary checkout's copy (a run that re-asks never jumps a waiter), stale locks and
dead waiters dropped, a busy machine waited out, every wait logged, every escape hatch said in the log. The memory gate: test_heavy_lock_memory.py. Fixture: heavy_lock_fixture.py."""
import os
import subprocess
import time
import unittest

from tests.heavy_lock_fixture import HeavyLockFixture, LOCK, ROOT
from tests.heavy_wait import wait_in_books, gate_loop


class HeavyLockTest(HeavyLockFixture):
    def test_keeps_exit_code_and_tells_the_child_the_lock_is_held(self):
        result = self.run_lock('suite', 'bash', '-c', 'echo "held=$JP_HEAVY_HELD"; exit 5')
        self.assertEqual(result.returncode, 5)
        self.assertRegex(result.stdout, r'held=\d+')
        self.assertFalse((self.tmp / 'heavy' / 'lock').exists(), 'freed afterwards')

    def test_a_python_that_cannot_make_a_group_never_hides_the_exit_code(self):
        # Windows: os.setpgid is missing and os.execvp starts the command and ends at once with 0. Stand-in python3: no setpgid, and a "run" that ends 0 without running anything.
        fake = self.tmp / 'fakebin'
        fake.mkdir()
        (fake / 'python3').write_text('#!/bin/bash\ncase "$*" in *setpgid*) exit 1;; esac\nexit 0\n')
        (fake / 'python3').chmod(0o755)
        result = self.run_lock('suite', 'bash', '-c', 'exit 7', PATH=f"{fake}{os.pathsep}{self.env['PATH']}")
        self.assertEqual(result.returncode, 7, result.stdout + result.stderr)

    def test_two_runs_never_overlap_and_the_second_says_who_holds_it(self):
        trace, go = self.tmp / 'trace', self.tmp / 'go'
        body = f'echo start >> {trace}; {gate_loop(go.as_posix(), 0.05)}; echo end >> {trace}'
        first = self.start('first suite', 'bash', '-c', body)
        wait_in_books(self.env['JOBADABRA_HEAVY_DIR'], first, ('holds',), env=self.env)   # first holds: not a guessed 0.4 s
        second = self.start_logged('second suite', 'bash', '-c', body)
        self.said(second, 'second suite waits', first)   # it looked and waits: a queued ticket alone has not looked yet
        go.write_text('go')
        second.communicate(timeout=30)
        first.communicate(timeout=30)
        err = second.err_path.read_text()
        self.assertEqual(trace.read_text().split(), ['start', 'end', 'start', 'end'])
        self.assertIn('second suite waits: the lock is held by', err)
        self.assertIn('first suite', err)

    def test_a_stale_lock_is_taken_over(self):
        lock = self.tmp / 'heavy' / 'lock'
        lock.mkdir(parents=True)
        (lock / 'pid').write_text('999999')
        (lock / 'what').write_text('crashed run')
        result = self.run_lock('next', 'echo', 'ran')
        self.assertEqual(result.stdout.strip(), 'ran')
        self.assertIn('taking over a stale lock: crashed run', result.stderr)

    def test_waiting_has_a_limit_and_runs_anyway_saying_so(self):
        _, let_go = self.hold()   # held until the impatient run has given up waiting
        result = self.run_lock('impatient', 'echo', 'ran', JOBADABRA_HEAVY_WAIT='1')
        let_go()
        self.assertEqual(result.stdout.strip(), 'ran')
        self.assertIn('running anyway', result.stderr)

    def test_a_nested_call_and_the_off_switch_run_at_once(self):
        _, let_go = self.hold()
        for env in ({'JP_HEAVY_HELD': '1'}, {'JOBADABRA_HEAVY': '0'}):
            result = self.run_lock('inner', 'echo', 'ran', **env)
            self.assertEqual(result.stdout.strip(), 'ran')
            self.assertNotRegex(result.stderr, r'waits|waited|got the lock after', f'{env}: it ran at once, it did not wait for the holder')   # the lock says when it waits; no stopwatch (a loaded runner is slow, not waiting)
        let_go()

    def test_a_busy_machine_is_waited_for_then_run_anyway(self):
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir()
        (bin_dir / 'uptime').write_text('#!/bin/sh\necho "10:00  up 1 day,  3 users,  load averages: 99.00 90.00 80.00"\n')
        (bin_dir / 'uptime').chmod(0o755)
        result = self.run_lock('browser suite', 'echo', 'ran', PATH=f'{bin_dir}{os.pathsep}{os.environ["PATH"]}',
                               JOBADABRA_HEAVY_LOAD='8', JOBADABRA_HEAVY_SIGNAL='load', JOBADABRA_HEAVY_LOAD_WAIT='1')
        self.assertEqual(result.stdout.strip(), 'ran')
        self.assertIn('waits for the machine, holding no slot: the machine is busy: 1-minute load 99 is above 8', result.stderr)
        self.assertIn('running browser suite anyway', result.stderr)

    def test_the_first_busy_reading_always_says_it_waits_before_giving_up(self):
        # 13 Oct 2026 main red: with a 1 s wait, the clock's second ticking between two reads gave up on the first reading, with no wait line.
        # A 0 s wait makes that race certain: the first reading must still wait once and say why.
        result = self.run_lock('browser suite', 'echo', 'ran', **self.busy_machine(),
                               JOBADABRA_HEAVY_LOAD='8', JOBADABRA_HEAVY_SIGNAL='load', JOBADABRA_HEAVY_LOAD_WAIT='0')
        self.assertEqual(result.stdout.strip(), 'ran')
        self.assertIn('waits for the machine, holding no slot: the machine is busy', result.stderr)
        self.assertIn('running browser suite anyway', result.stderr)

    def busy_machine(self, load=99):
        bin_dir = self.tmp / f'busy-{load}'
        bin_dir.mkdir(exist_ok=True)
        (bin_dir / 'uptime').write_text(f'#!/bin/sh\necho "10:00  up 1 day,  3 users,  load averages: {load}.00 90.00 80.00"\n')
        (bin_dir / 'uptime').chmod(0o755)
        return {'PATH': f'{bin_dir}{os.pathsep}{os.environ["PATH"]}'}

    def test_a_run_waiting_for_the_machine_holds_no_slot_and_never_blocks_a_later_run_that_fits(self):
        # 11 Oct 2026: a replay took the slot, then sat 12 minutes in the load wait while two landings queued behind it
        waiting = self.start('waits for load', 'echo', 'late', **self.busy_machine(), JOBADABRA_HEAVY_LOAD='8', JOBADABRA_HEAVY_SIGNAL='load', JOBADABRA_HEAVY_LOAD_WAIT='600')
        self.addCleanup(lambda: waiting.poll() is None and (waiting.kill(), waiting.communicate()))
        wait_in_books(self.env['JOBADABRA_HEAVY_DIR'], waiting, ('loadwait',), env=self.env)   # its ticket says it waits for the machine: not a guessed 0.8 s
        self.assertFalse((self.tmp / 'heavy' / 'lock').exists(), 'while it waits for the machine it holds no slot')
        later = self.run_lock('fits now', 'echo', 'went')   # this run has no load limit: it is ready, and it is behind the waiter in line
        self.assertEqual(later.stdout.strip(), 'went')
        self.assertNotRegex(later.stderr, r'waits|waited|got the lock after', 'it did not wait for the earlier run that waits for the machine')
        self.assertIsNone(waiting.poll(), 'the machine is still busy: the waiting run is still waiting')
        waiting.kill()
        waiting.communicate()

    def test_the_load_wait_still_ends_and_the_run_goes_anyway_in_its_turn(self):
        first = self.start('first', 'bash', '-c', 'sleep 1.2; echo first')
        time.sleep(0.3)   # clock: no order is asserted here, only that the load wait ends and says so
        second = self.start('second', 'echo', 'second', **self.busy_machine(), JOBADABRA_HEAVY_LOAD='8', JOBADABRA_HEAVY_SIGNAL='load', JOBADABRA_HEAVY_LOAD_WAIT='1')
        out, err = second.communicate(timeout=30)
        first.communicate(timeout=30)
        self.assertEqual(out.strip(), 'second')
        self.assertIn('running second anyway', err)

    def ticket(self, pid, what, age_ns=10**9):
        """A waiter's place in the queue, older than anything this test starts next."""
        queue = self.tmp / 'heavy' / 'queue'
        queue.mkdir(parents=True, exist_ok=True)
        path = queue / f'{time.time_ns() - age_ns}-{pid}'
        path.write_text(f'{pid} {what}\n')
        return path

    def test_an_earlier_waiter_goes_first_even_when_the_lock_is_free(self):
        # 11 Oct 2026: the pool's per-site runs re-took a just-freed lock while a replay had waited 6+ min. Arrival order decides, not who polls next.
        waiter = subprocess.Popen(['sleep', '60'])
        self.addCleanup(waiter.kill)
        self.ticket(waiter.pid, 'replay that waited')
        late = self.start('pool site', 'echo', 'ran')
        said = late.stderr.readline()   # its first word is "waits": read, not a guessed 1 s (a loaded runner starts it late and the waiter died first, CI red 11 Oct 2026)
        self.assertIsNone(late.poll(), 'the later run waits while the earlier waiter lives, though the lock is free')
        waiter.kill(); waiter.wait()   # reaped: a zombie still answers kill -0
        out, err = late.communicate(timeout=30)
        self.assertEqual(out.strip(), 'ran')
        self.assertIn('pool site waits: replay that waited', said + err)

    def test_a_dead_waiter_is_dropped_from_the_queue(self):
        dead = self.ticket(999999, 'crashed waiter')
        result = self.run_lock('next', 'echo', 'ran')
        self.assertEqual(result.stdout.strip(), 'ran')
        self.assertNotRegex(result.stderr, r'waits|waited|got the lock after', 'a dead waiter holds nobody up')   # not "under 2 s": a loaded runner took 2.4 s here (beta run 38190180434)
        self.assertFalse(dead.exists(), 'its ticket is removed')
        self.assertEqual(list((self.tmp / 'heavy' / 'queue').iterdir()), [], 'no ticket is left behind, mine included')

    def test_a_wait_is_logged_for_the_next_measurement(self):
        _, let_go = self.hold()
        second = self.start_logged('second', 'echo', 'ran')
        self.said(second, 'second waits')
        let_go()
        out, _ = second.communicate(timeout=30)
        result = subprocess.CompletedProcess(second.args, second.returncode, out, second.err_path.read_text())
        self.assertIn('got the lock after', result.stderr)
        self.assertRegex((self.tmp / 'gate-timing.log').read_text(), r'heavy lock wait=\d+s what=second')

    def test_a_worktree_copy_hands_off_to_the_primary_checkouts_copy(self):
        # Owner, 11 Oct 2026: every session queues in ONE fair order, so every copy runs the primary checkout's script, never its own worktree's.
        primary = self.tmp / 'primary'
        (primary / 'tools').mkdir(parents=True)
        (primary / 'tools' / 'heavy-lock.sh').write_text('echo "primary copy: $*"\n')
        git = lambda *args, cwd=primary: subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True)
        git('init', '-q'); git('add', '.'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x')
        git('worktree', 'add', '-q', str(self.tmp / 'wt'))
        mine = self.tmp / 'wt' / 'tools' / 'heavy-lock.sh'
        mine.write_text(LOCK.read_text())
        env = {k: v for k, v in self.env.items() if k != 'JOBADABRA_HEAVY_SHARED'}
        result = subprocess.run(['bash', str(mine), 'suite', 'echo', 'hi'], env=env, capture_output=True, text=True, cwd=self.tmp / 'wt')
        self.assertEqual(result.stdout.strip(), 'primary copy: suite echo hi')
        result = subprocess.run(['bash', str(mine), 'suite', 'echo', 'hi'], env=env, capture_output=True, text=True, cwd='/')
        self.assertEqual(result.stdout.strip(), 'primary copy: suite echo hi', 'found from the script, not the caller\'s folder')

    def test_the_e2e_package_scripts_that_open_browsers_take_the_lock(self):
        scripts = (ROOT / 'desktop' / 'e2e' / 'package.json').read_text()
        for name in ('real-extension', 'recorded'):
            line = next(l for l in scripts.splitlines() if f'"{name}"' in l)
            self.assertIn('heavy-lock.sh', line, name)


if __name__ == '__main__':
    unittest.main()
