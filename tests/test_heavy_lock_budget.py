"""tools/heavy-lock.sh admits by memory budget (11 Oct 2026): up to 4 runs at once, each only while free+inactive memory minus what the runs that just started are still to take is over the same floor as before (7 GB live, 3 GB replay), a replay with room does not queue behind a waiting live run, a timing run is alone. A fake vm_stat serves the memory; runs are gated by files the test releases (no fixed naps)."""
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from tests.heavy_wait import evidence, gated, release, wait_in_books, wait_trace

LOCK = Path(__file__).resolve().parent.parent / 'tools' / 'heavy-lock.sh'


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLockBudgetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.trace = self.tmp / 'trace'
        self.gates = self.tmp / 'gates'
        self.procs = []
        self.addCleanup(lambda: [p.kill() for p in self.procs])
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_HEAVY', 'JP_HEAVY'))}, 'JOBADABRA_HEAVY_DIR': (self.tmp / 'heavy').as_posix(),
                    'JOBADABRA_HEAVY_LOAD': '0', 'JOBADABRA_HEAVY_POLL': '0.1', 'JOBADABRA_HEAVY_TIMING_LOG': (self.tmp / 'gate-timing.log').as_posix(), 'JOBADABRA_HEAVY_SHARED': str(LOCK),
                    'JOBADABRA_HEAVY_RAMP': '3600'}   # a just-started run's reservation lasts the whole test, however slow the runner (the default 90 s could lapse mid-test)

    def memory(self, free_gb, swap_used_pct=10):
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir(exist_ok=True)
        pages = int(free_gb * 1024 ** 3 / 16384 / 2)
        (bin_dir / 'vm_stat').write_text('#!/bin/sh\n' f'printf "Mach Virtual Memory Statistics: (page size of 16384 bytes)\\nPages free:  {pages}.\\nPages active:  999.\\nPages inactive:  {pages}.\\n"\n')
        (bin_dir / 'sysctl').write_text('#!/bin/sh\ncase "$*" in *swapusage*) ' f'echo "total = 4096.00M  used = {4096 * swap_used_pct / 100:.2f}M  free = 0.00M  (encrypted)";; *) echo 8;; esac\n')
        for name in ('vm_stat', 'sysctl'):
            (bin_dir / name).chmod(0o755)
        self.env['PATH'] = f'{bin_dir.as_posix()}{os.pathsep}{os.environ["PATH"]}'

    def launch(self, what, name, **env):
        """Start a gated run and wait until THIS run (its pid) holds a slot or has its ticket in the queue: the next run is then younger in line."""
        proc = subprocess.Popen(['bash', str(LOCK), what, 'bash', '-c', gated(self.trace, name, self.gates)], env={**self.env, **env}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.procs.append(proc)
        wait_in_books(self.env['JOBADABRA_HEAVY_DIR'], proc, procs=self.procs, env=self.env)
        return proc

    def why(self):
        return evidence(self.env['JOBADABRA_HEAVY_DIR'], env=self.env)

    def words(self):
        try:
            return self.trace.read_text().split()
        except OSError:
            return []

    def settle(self, seconds=0.6):
        time.sleep(seconds)   # clock: nothing more may start; the state is fixed while the gates hold, so a wrong start only gets time to show
        return self.words()

    def finish(self):
        release(self.gates)
        for p in self.procs:
            p.communicate(timeout=60)
        return self.words()

    def test_four_replays_run_at_once_when_the_budget_has_room(self):
        self.memory(free_gb=20)
        for n in 'abcd':
            self.launch('recorded-replay', n)
        wait_trace(self.trace, 4, why=self.why)
        self.assertEqual(sorted(self.words()), ['+a', '+b', '+c', '+d'])
        self.finish()

    def test_a_third_live_run_waits_for_budget_a_replay_does_not(self):
        # 12 GB free: a 2nd live run needs 7 over the 2.9 GB reserved for the 1st (9.1), a 3rd 6.2 (waits); a replay needs 3 (6.2: goes)
        self.memory(free_gb=12)
        for what, name in (('e2e-smoke', 'a'), ('e2e-smoke', 'b'), ('e2e-smoke', 'c'), ('recorded-replay', 'd')):
            self.launch(what, name)
        wait_trace(self.trace, 3, why=self.why)
        self.assertEqual(sorted(self.settle()), ['+a', '+b', '+d'], 'the 3rd live run does not start beside two others')
        release(self.gates, 'a')
        wait_trace(self.trace, 5, why=self.why)
        self.assertEqual(self.words()[3:], ['-a', '+c'])
        self.finish()

    def test_the_floors_are_not_weakened_a_live_run_still_needs_seven_gb(self):
        self.memory(free_gb=9)    # 9 - 2.9 reserved for the 1st = 6.1: under 7
        self.launch('e2e-smoke', 'a')
        self.launch('e2e-smoke', 'b')
        wait_trace(self.trace, 1, why=self.why)   # a has started, however slow the Mac is; only then is a quiet 0.6 s meaningful
        self.assertEqual(self.settle(), ['+a'])
        release(self.gates, 'a')
        wait_trace(self.trace, 3, why=self.why)
        self.assertEqual(self.words(), ['+a', '-a', '+b'])
        self.finish()

    def replay_behind_a_waiting_live_proof(self, **env):
        self.memory(free_gb=6)     # a live run cannot start beside the 1st (needs 7); a replay can (6 - 2.9 = 3.1 over 3)
        self.launch('e2e-smoke', 'a', **env)
        wait_trace(self.trace, 1, why=self.why)   # a holds before b queues (a proof would overtake a pool run still in the queue)
        self.launch('real-extension', 'b', **env)   # a live proof of the same class, waiting for memory
        self.launch('recorded-replay', 'c', **env)

    def test_a_replay_with_room_does_not_queue_behind_a_waiting_live_run(self):
        self.replay_behind_a_waiting_live_proof()
        wait_trace(self.trace, 2, why=self.why)   # the replay starts however slow the Mac is
        self.assertEqual(sorted(self.settle()), ['+a', '+c'], 'and the live proof b does not')
        self.finish()

    def test_the_replay_switch_restores_arrival_order(self):
        self.replay_behind_a_waiting_live_proof(JOBADABRA_HEAVY_REPLAY_SKIP='0')
        self.assertEqual(self.settle(), ['+a'])
        self.finish()

    def test_a_timing_run_is_alone_and_nobody_starts_beside_it(self):
        self.memory(free_gb=20)
        self.launch('recorded-replay', 'a')
        self.launch('apply-latency-x', 'timing')
        self.launch('recorded-replay', 'b')
        wait_trace(self.trace, 1, why=self.why)
        self.assertEqual(self.settle(), ['+a'], 'the timing run waits for the empty lock and the replay behind it waits for the timing run')
        release(self.gates, 'a')
        wait_trace(self.trace, 3, why=self.why)
        self.assertEqual(self.words(), ['+a', '-a', '+timing'])
        self.assertEqual(self.settle(), ['+a', '-a', '+timing'], 'nothing starts beside it')
        release(self.gates, 'timing')
        wait_trace(self.trace, 5, why=self.why)
        self.finish()

    def test_a_timing_run_starts_where_stat_is_the_gnu_one(self):
        # CI (Linux, 11 Oct 2026): `stat -f %m dir` succeeds there with lines of file-system text, so a slot without its pid file made the staleness check fail and a timing run never started.
        self.memory(free_gb=20)
        bin_dir = Path(self.env['PATH'].split(os.pathsep)[0])
        real_stat = shutil.which('stat')
        (bin_dir / 'stat').write_text('#!/bin/sh\nif [ "$1" = -f ]; then printf \'  File: "%s"\\n    ID: 0 Namelen: 255 Type: ext4\\n\' "$3"; exit 0; fi\n'
                                      f'if [ "$1" = -c ]; then {real_stat} -c "$2" "$3" 2>/dev/null && exit 0; exec {real_stat} -f %m "$3"; fi\nexec {real_stat} "$@"\n')   # -c: the real GNU stat where there is one (CI), else the macOS form (15 Oct 2026: on Linux it ran GNU `stat -f %m`, fs text, and the timing run never started)
        (bin_dir / 'stat').chmod(0o755)
        self.launch('recorded-replay', 'a')
        self.launch('apply-latency-x', 'timing')
        release(self.gates, 'a')
        wait_trace(self.trace, 3, why=self.why)
        self.assertEqual(self.words(), ['+a', '-a', '+timing'])
        self.finish()

    def test_the_slot_cap_can_be_set_back_to_two(self):
        self.memory(free_gb=20)
        for n in 'abc':
            self.launch('recorded-replay', n, JOBADABRA_HEAVY_SLOTS='2', JOBADABRA_HEAVY_REPLAY_SKIP='0')   # (replays may skip the queue: here only the cap is looked at, in arrival order)
        wait_trace(self.trace, 2, why=self.why)
        self.assertEqual(sorted(self.settle()), ['+a', '+b'])
        release(self.gates, 'a')
        wait_trace(self.trace, 4, why=self.why)
        self.assertEqual(self.words()[2:], ['-a', '+c'])
        self.finish()


if __name__ == '__main__':
    unittest.main()
