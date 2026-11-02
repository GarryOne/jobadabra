"""tools/check-slot.sh (9 Oct 2026): at most N push checks at once on this Mac; a dead owner's slot is taken over; the exit code is kept."""
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from tests.heavy_wait import gate_loop

SCRIPT = str(Path(__file__).resolve().parent.parent / 'tools/check-slot.sh')


def held_by(slot_dir, proc, timeout=60):
    """Wait until THIS run (its pid) holds a slot: the lock's own state, not a guessed nap."""
    deadline = time.monotonic() + timeout
    while not any((p / 'pid').is_file() and (p / 'pid').read_text().strip() == str(proc.pid) for p in Path(slot_dir).glob('slot*')):
        if proc.poll() is not None or time.monotonic() > deadline:
            raise AssertionError(f'pid {proc.pid} holds no slot ({"it ended, exit " + str(proc.returncode) if proc.poll() is not None else f"{timeout}s"}): '
                                 f'{[(p.name, (p / "pid").read_text().strip() if (p / "pid").is_file() else None) for p in Path(slot_dir).glob("slot*")]}')
        time.sleep(0.05)   # clock: a poll of the slot's state


def gated(gate):
    """A command that holds its slot until the test writes the gate file."""
    return ['bash', '-c', f'{gate_loop(Path(gate).as_posix(), 0.05)}']


def said(path, text, proc, timeout=60):
    deadline = time.monotonic() + timeout
    while text not in Path(path).read_text():
        if proc.poll() is not None or time.monotonic() > deadline:
            raise AssertionError(f'never said {text!r}: {Path(path).read_text()!r}')
        time.sleep(0.05)   # clock: a poll of what the run said


def run(args, slot_dir, slots='1', wait='20', timing=None, **kw):
    env = dict(os.environ, JOBADABRA_CHECK_SLOT_DIR=slot_dir, JOBADABRA_CHECK_SLOTS=slots, JOBADABRA_CHECK_WAIT=wait)
    if timing:
        env['JOBADABRA_CHECK_TIMING_LOG'] = timing
    kw.setdefault('stderr', subprocess.PIPE)
    return subprocess.Popen(['bash', SCRIPT, *args], env=env, stdout=subprocess.PIPE, text=True, **kw)


class SlotTests(unittest.TestCase):
    def test_the_command_runs_and_its_exit_code_is_kept(self):
        with tempfile.TemporaryDirectory() as d:
            p = run(['bash', '-c', 'echo hi; exit 3'], d)
            out, _ = p.communicate(timeout=20)
            self.assertEqual((p.returncode, out.strip()), (3, 'hi'))
            self.assertEqual(os.listdir(d), [])                       # the slot is freed

    def test_a_second_run_waits_for_the_first_with_one_slot(self):
        with tempfile.TemporaryDirectory() as d:
            gate = Path(d).parent / f'go-{Path(d).name}'
            self.addCleanup(lambda: gate.unlink(missing_ok=True))
            first = run(gated(gate), d)
            held_by(d, first)
            err_path = Path(d).parent / f'err-{Path(d).name}'
            self.addCleanup(lambda: err_path.unlink(missing_ok=True))
            with open(err_path, 'w') as err_out:
                second = run(['true'], d, stderr=err_out)
            said(err_path, 'waiting for a free slot', second)
            self.assertIsNone(second.poll(), 'it waits while the slot is held')   # no stopwatch: it said it waits and has not run
            gate.write_text('go')
            second.communicate(timeout=30)
            self.assertEqual(second.returncode, 0)
            first.communicate(timeout=30)

    def test_a_wait_is_logged_for_the_next_measurement_and_a_free_slot_logs_nothing(self):
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory() as t:
            log = os.path.join(t, 'gate-timing.log')
            run(['true'], d, timing=log).communicate(timeout=20)
            self.assertFalse(os.path.exists(log), 'no wait, no line')
            gate = os.path.join(t, 'go-1')
            first = run(gated(gate), d, timing=log)
            held_by(d, first)
            err_path = os.path.join(t, 'err-1')
            with open(err_path, 'w') as err_out:
                second = run(['true'], d, timing=log, stderr=err_out)
            said(err_path, 'waiting for a free slot', second)
            Path(gate).write_text('go')
            second.communicate(timeout=30)
            first.communicate(timeout=30)
            self.assertRegex(Path(log).read_text(), r'# \S+ check slot wait=\d+s slots=1')
            gate = os.path.join(t, 'go-2')
            off = run(gated(gate), d, timing=log)
            held_by(d, off)
            err_path = os.path.join(t, 'err-2')
            with open(err_path, 'w') as err_out:
                second = subprocess.Popen(['bash', SCRIPT, 'true'], env=dict(os.environ, JOBADABRA_CHECK_SLOT_DIR=d, JOBADABRA_CHECK_SLOTS='1', GATE_TIMING='0', JOBADABRA_CHECK_TIMING_LOG=log), stdout=subprocess.PIPE, stderr=err_out)
            said(err_path, 'waiting for a free slot', second)
            Path(gate).write_text('go')
            second.communicate(timeout=30)
            off.communicate(timeout=30)
            self.assertEqual(Path(log).read_text().count('check slot wait'), 1, 'GATE_TIMING=0 logs nothing')

    def test_a_slot_whose_owner_is_gone_is_taken_over_at_once(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / 'slot1').mkdir()
            (Path(d) / 'slot1' / 'pid').write_text('999999')           # no such process
            p = run(['true'], d)
            _, err = p.communicate(timeout=20)
            self.assertNotIn('waiting', err)   # it said no wait: no stopwatch (a loaded runner is slow, not waiting)

    def test_zero_slots_skips_the_queue(self):
        with tempfile.TemporaryDirectory() as d:
            p = run(['echo', 'x'], d, slots='0')
            out, _ = p.communicate(timeout=10)
            self.assertEqual(out.strip(), 'x')


if __name__ == '__main__':
    unittest.main()
