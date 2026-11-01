"""A replay of a search tape starts the scout checks its recording started, however fast its clock runs (src/budget_tape.py until).
19 Oct 2026: lab proof 4 failed: the recording's scout ran out of its minutes, its faster replay checked 54 more employers on 6 job-site
hosts (487 web answers the tape did not have), because the scout's deadline read the clock, not the tape."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import budget_tape, scout, scout_core
from src import store as job_store
from tests.test_budget_tape import contextlib_quiet
from tests.test_scout import SEEDS


class ScoutTapeTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        for patch in (mock.patch.dict(os.environ, {'JOBADABRA_SEARCH_TAPE': self.dir.name}), mock.patch('src.paths.DATA', Path(self.dir.name)),
                      mock.patch.object(scout_core, 'CENTRAL', True)):
            patch.start()
            self.addCleanup(patch.stop)

    def checked(self, mode, step, run='run'):
        """The employers one scout run checks with a 3 s budget, when each job-site probe takes `step` seconds of the clock."""
        (Path(self.dir.name) / 'scout_runs.txt').unlink(missing_ok=True)   # a fresh run of the same processes
        budget_tape._seen.clear()
        budget_tape._tape.clear()
        t = [0.0]

        def probe(system, slug):
            t[0] += step
            return []
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, \
                mock.patch.dict(os.environ, {'JOBADABRA_SEARCH_TAPE_MODE': mode}), mock.patch.object(scout.time, 'monotonic', lambda: t[0]), \
                contextlib_quiet():
            names = [f'Co{i}' for i in range(10)]
            scout.harvest(db, SEEDS, sources=[lambda: [dict(name=n, origin='AI idea', priority=99 - i) for i, n in enumerate(names)]])
            _, results = scout.run(db, batch=10, harvest_sources=[], probe=probe, workers=1, budget=3)
        return sorted(c['name'] for c, _ in results)

    def test_a_faster_replay_checks_the_employers_the_recording_checked(self):
        recorded = self.checked('record', 0.2)
        self.assertTrue(0 < len(recorded) < 10, f'the recording runs out of time, so the test shows a real decision: {recorded}')
        for step in (0.0, 0.01, 1.0):
            with self.subTest(step=step):
                self.assertEqual(self.checked('replay', step), recorded)

    def test_a_live_run_keeps_its_own_clock(self):
        with mock.patch.dict(os.environ, {'JOBADABRA_SEARCH_TAPE': ''}):
            self.assertEqual(len(self.checked('record', 0.0)), 10, 'no time used: every employer is checked')
            self.assertLess(len(self.checked('record', 0.2)), 10)
        self.assertFalse((Path(self.dir.name) / 'budget.jsonl').exists(), 'a live run writes no tape')


if __name__ == '__main__':
    unittest.main()
