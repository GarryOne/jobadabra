"""A timed search's process ends at its deadline, not when the last read still open after the cut ends (26 Oct 2026, the owner's run
8501ae436f60: the engine was done at 155 s, the process exited at 271 s: Python joins every reader thread at exit). src/run_exit.py."""
import re
import subprocess
import sys
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SCRIPT = """
import sys, time
from concurrent.futures import ThreadPoolExecutor
from src import run_exit, time_budget
time_budget.start({budget}) if {search} else run_exit.until(time.monotonic() + {budget})
pool = ThreadPoolExecutor(max_workers=1)
pool.submit(time.sleep, {read})   # a site read still open after the cut: not waited for, not killed (late_reads)
pool.shutdown(wait=False)
print('engine done', flush=True)
raise SystemExit(run_exit.finish(3))
"""


def run(budget, read, search=True):
    began = time.monotonic()
    done = subprocess.run([sys.executable, '-c', SCRIPT.format(budget=budget, read=read, search=search)], cwd=ROOT, capture_output=True, text=True, timeout=30)
    return done, time.monotonic() - began


class TheProcessEndsAtTheDeadline(unittest.TestCase):
    def test_a_read_open_past_the_deadline_does_not_hold_the_process(self):
        done, took = run(budget=1, read=8)
        self.assertLess(took, 4, f'the process waited {took:.1f} s for a read past its 1 s deadline')
        self.assertEqual(done.returncode, 3, done.stderr)
        self.assertIn('engine done', done.stdout)
        self.assertIn('the next search reads', done.stderr)

    def test_a_read_that_ends_before_the_deadline_is_waited_for(self):
        done, took = run(budget=4, read=1)   # its answer is kept for the next search (late_reads.when_done) before the process ends
        self.assertGreaterEqual(took, 1)
        self.assertLess(took, 3.5)
        self.assertEqual(done.returncode, 3, done.stderr)

    def test_a_step_with_its_own_budget_ends_at_its_own_deadline(self):
        """27 Oct 2026, a first press: the employer finder (src/scout.py, no search budget) waited for 6 checks until 379 s of 180."""
        done, took = run(budget=1, read=8, search=False)
        self.assertLess(took, 4, f'the process waited {took:.1f} s for a check past its own 1 s deadline')
        self.assertEqual(done.returncode, 3, done.stderr)
        self.assertIn('run_exit.until(None if scout_core.CENTRAL else deadline)', (ROOT / 'src' / 'scout.py').read_text(),
                      "the app's scout gives the process its deadline; the central one keeps scout_overrun")

    def test_the_command_line_ends_through_it(self):
        main = (ROOT / 'src' / '__main__.py').read_text()
        self.assertRegex(main, re.compile(r"raise SystemExit\(run_exit\.finish\(main\(\)\)\)"))


if __name__ == '__main__':
    unittest.main()
