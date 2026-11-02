"""A replay takes the recording's path whatever its clock says: the time budget's decisions come from the search tape (src/budget_tape.py).
18 Oct 2026: two replays of one tape disagreed (35 vs 39 places, 67 vs 522 missing web answers) because over()/in_calls() read a wall clock."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import budget_tape, time_budget as budget


def search(clock):
    """One search's budget decisions as the steps ask them, at simulated clock speed `clock` (seconds per read of the clock)."""
    t = [0.0]
    def tick():
        t[0] += clock
        return t[0]
    with mock.patch.object(budget.time, 'monotonic', tick):
        budget.start(180)
        got = [budget.in_calls('place_rounds', 400, 60, 2), budget.batch('score', 50, say=False)]
        got += [budget.over('titles') for _ in range(12)]
        got += [budget.may_score() for _ in range(6)]
    return got


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        patch = mock.patch.dict(os.environ, {'JOBADABRA_SEARCH_TAPE': self.dir.name, 'JOBADABRA_DATA_DIR': self.dir.name})
        patch.start()
        self.addCleanup(patch.stop)
        self.addCleanup(self.dir.cleanup)
        self.addCleanup(budget.start, 0)
        patch = mock.patch('src.paths.DATA', Path(self.dir.name))
        patch.start()
        self.addCleanup(patch.stop)

    def run_mode(self, mode, clock):
        (Path(self.dir.name) / 'budget_epoch.txt').unlink(missing_ok=True)   # a fresh run of the same processes
        budget_tape._seen.clear()
        budget_tape._tape.clear()
        with mock.patch.dict(os.environ, {'JOBADABRA_SEARCH_TAPE_MODE': mode}), contextlib_quiet():
            return search(clock)


class BudgetTapeTest(Base):
    def test_replays_at_different_speeds_decide_like_the_recording(self):
        recorded = self.run_mode('record', 20.0)
        self.assertIn(True, recorded[2:14], 'the recording runs out of time, so the test shows a real decision')
        for clock in (0.01, 1.0, 5.0, 60.0):
            with self.subTest(clock=clock):
                self.assertEqual(self.run_mode('replay', clock), recorded)

    def test_a_decision_the_tape_lacks_comes_from_the_clock(self):
        with contextlib_quiet():
            plain = search(0.01)
        self.assertEqual(self.run_mode('replay', 0.01), plain)

    def test_without_a_tape_nothing_is_written(self):
        with mock.patch.dict(os.environ, {'JOBADABRA_SEARCH_TAPE': ''}), contextlib_quiet():
            search(1.0)
        self.assertFalse((Path(self.dir.name) / 'budget.jsonl').exists())


class TwoSearchesTest(Base):
    def test_each_process_of_a_run_replays_its_own_decisions(self):
        def two(clock):
            first = search(clock)
            second = search(clock * 50)   # the run's next process: a different pace, its own decisions
            return first, second
        for mode in ('record',):
            budget_tape._seen.clear(), budget_tape._tape.clear()
            with mock.patch.dict(os.environ, {'JOBADABRA_SEARCH_TAPE_MODE': mode}), contextlib_quiet():
                recorded = two(20.0)
        (Path(self.dir.name) / 'budget_epoch.txt').unlink()   # a fresh replay run
        budget_tape._seen.clear(), budget_tape._tape.clear()
        with mock.patch.dict(os.environ, {'JOBADABRA_SEARCH_TAPE_MODE': 'replay'}), contextlib_quiet():
            self.assertEqual(two(0.01), recorded)


def contextlib_quiet():
    import contextlib
    import io
    return contextlib.redirect_stdout(io.StringIO())


if __name__ == '__main__':
    unittest.main()
