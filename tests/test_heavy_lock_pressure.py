"""tools/heavy-lock-memory.sh, the pressure rule (11 Oct 2026): a run starts beside others while macOS's memory pressure is normal, its available memory less what just-started runs declared is over the run's cost plus 1.5 GB, and nothing swaps out; swap already used no longer holds. JOBADABRA_HEAVY_MEM_RULE=floor brings back the 7 GB free+inactive floor. Fake sysctl/vm_stat on PATH; the floor rule (also the fallback where the macOS readings are missing) is in test_heavy_lock_memory.py and test_heavy_lock_budget.py."""
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from tests.heavy_wait import gated, release, wait_in_books, wait_trace

LOCK = Path(__file__).resolve().parent.parent / 'tools' / 'heavy-lock.sh'


@unittest.skipUnless(shutil.which('bash'), 'needs bash')
class HeavyLockPressureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.trace, self.gates, self.procs = self.tmp / 'trace', self.tmp / 'gates', []
        self.addCleanup(lambda: [p.kill() for p in self.procs])
        self.env = {**{k: v for k, v in os.environ.items() if not k.startswith(('JOBADABRA_HEAVY', 'JP_HEAVY'))}, 'JOBADABRA_HEAVY_DIR': (self.tmp / 'heavy').as_posix(),
                    'JOBADABRA_HEAVY_LOAD': '0', 'JOBADABRA_HEAVY_POLL': '0.1', 'JOBADABRA_HEAVY_SWAP_SAMPLE': '1', 'JOBADABRA_HEAVY_RAMP': '3600',   # a just-started run's reservation lasts the whole test
                    'JOBADABRA_HEAVY_TIMING_LOG': (self.tmp / 'gate-timing.log').as_posix(), 'JOBADABRA_HEAVY_SHARED': str(LOCK)}

    def mac(self, level=1, avail_pct=60, swapping=False, free_inactive_gb=4, swap_used_pct=82):
        """A 16 GB Mac as macOS reports it: pressure level, available percent, swap-outs climbing (1000 pages a look) or not, free+inactive pages, swap file use."""
        bin_dir = self.tmp / 'bin'
        bin_dir.mkdir(exist_ok=True)
        pages, count = int(free_inactive_gb * 1024 ** 3 / 16384 / 2), (self.tmp / 'swapouts').as_posix()
        step = 1000 if swapping else 0
        (bin_dir / 'vm_stat').write_text(f'#!/bin/sh\nn=$(cat {count} 2>/dev/null || echo 5000); n=$((n + {step})); echo $n >{count}\n'
                                         f'printf "Mach Virtual Memory Statistics: (page size of 16384 bytes)\\nPages free:  {pages}.\\nPages inactive:  {pages}.\\nSwapouts:  $n.\\n"\n')
        (bin_dir / 'sysctl').write_text('#!/bin/sh\nfor a in "$@"; do case "$a" in\n'
                                        f'  kern.memorystatus_vm_pressure_level) echo {level};; kern.memorystatus_level) echo {avail_pct};; hw.memsize) echo 17179869184;; hw.ncpu) echo 8;;\n'
                                        f'  vm.swapusage) echo "total = 3072.00M  used = {3072 * swap_used_pct / 100:.2f}M  free = 0.00M  (encrypted)";;\nesac; done\n')
        for name in ('vm_stat', 'sysctl'):
            (bin_dir / name).chmod(0o755)
        self.env['PATH'] = f'{bin_dir.as_posix()}{os.pathsep}{os.environ["PATH"]}'

    def launch(self, what, name, **env):
        err = open(self.tmp / f'err-{name}', 'w')
        self.addCleanup(err.close)
        proc = subprocess.Popen(['bash', str(LOCK), what, 'bash', '-c', gated(self.trace, name, self.gates)], env={**self.env, **env}, stdout=subprocess.DEVNULL, stderr=err, text=True)
        proc.err_path = self.tmp / f'err-{name}'
        self.procs.append(proc)
        wait_in_books(self.env['JOBADABRA_HEAVY_DIR'], proc, procs=self.procs, env=self.env)
        return proc

    def words(self):
        try:
            return self.trace.read_text().split()
        except OSError:
            return []

    def beside_first(self, what='e2e-smoke', **env):
        """A live run holds; a second asks. Returns (it started beside the first, its stderr): whichever it says first, started or waits, however slow the Mac."""
        self.launch('e2e-smoke', 'a', **env)
        wait_trace(self.trace, 1)
        self.launch(what, 'b', **env)
        err_b = self.tmp / 'err-b'
        deadline = time.monotonic() + 60
        while '+b' not in self.words() and 'waits' not in err_b.read_text() and time.monotonic() < deadline:
            time.sleep(0.05)   # clock: a poll of what b said or did
        beside = '+b' in self.words()
        release(self.gates)
        for p in self.procs:
            p.wait(timeout=60)
        return beside, err_b.read_text()

    def test_green_with_room_admits_a_second_live_run_though_the_swap_file_is_mostly_used(self):
        self.mac(avail_pct=60, swap_used_pct=82)    # 9.6 GB available - 2.9 reserved for the 1st = 6.7, over 2.9 + 1.5
        beside, err = self.beside_first()
        self.assertTrue(beside, err)

    def test_but_not_a_third(self):
        self.mac(avail_pct=60)                       # a 3rd: 9.6 - 5.8 = 3.8, under 4.4
        for name in 'abc':
            self.launch('e2e-smoke', name)
        wait_trace(self.trace, 2)
        time.sleep(0.8)   # clock: nothing more may start; the state is fixed while the gates hold, so a wrong start only gets time to show
        self.assertEqual(sorted(self.words()), ['+a', '+b'])
        release(self.gates, 'a')
        wait_trace(self.trace, 4)
        self.assertEqual(self.words()[2:], ['-a', '+c'])
        release(self.gates)
        for p in self.procs:
            p.wait(timeout=60)

    def test_pressure_warn_holds(self):
        self.mac(level=2, avail_pct=60)
        beside, err = self.beside_first()
        self.assertFalse(beside)
        self.assertIn('memory pressure is warn', err)

    def test_a_climbing_swap_holds(self):
        self.mac(avail_pct=60, swapping=True)
        beside, err = self.beside_first()
        self.assertFalse(beside)
        self.assertIn('swaps out', err)

    def test_short_room_holds_a_live_run_and_admits_a_replay(self):
        self.mac(avail_pct=45)                       # 7.2 - 2.9 = 4.3: under 2.9 + 1.5 for a live run, over 1.2 + 1.5 for a replay
        live, err = self.beside_first()
        self.assertFalse(live)
        self.assertIn('available memory 4.3 GB', err)
        shutil.rmtree(self.tmp / 'heavy', True); self.trace.unlink(); shutil.rmtree(self.gates, True); self.procs.clear()   # a fresh lock for the second case
        replay, err = self.beside_first('row-replay')
        self.assertTrue(replay, err)

    def test_the_floor_rule_is_the_escape_hatch(self):
        self.mac(avail_pct=60, free_inactive_gb=4)   # green with room, but free+inactive 4 GB is under the old 7 GB floor
        beside, err = self.beside_first(JOBADABRA_HEAVY_MEM_RULE='floor')
        self.assertFalse(beside)
        self.assertIn('free+inactive memory', err)

    def test_every_hold_logs_what_macos_said(self):
        self.mac(avail_pct=60)
        self.beside_first()
        log = (self.tmp / 'gate-timing.log').read_text()
        self.assertIn('mac_mem=1/9.6', log)
        self.assertIn('rule=pressure level=1 avail=6.7 swapout=0.0', log)


if __name__ == '__main__':
    unittest.main()
