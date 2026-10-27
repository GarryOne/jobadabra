"""The scout's minutes count from its start, not from its first employer check (src/scout.py run).
19 Oct 2026, e1's live searches: a driver's scout given 180 s ran 638 s: the lists (a Wikidata timeout, 143 s), the AI's ideas (19 s) and the
role searches (103 s) ran before the clock started."""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import scout, scout_core
from src import store as job_store
from tests.test_budget_tape import contextlib_quiet
from tests.test_scout import SEEDS


class WholeRunBudgetTest(unittest.TestCase):
    def run_scout(self, ideas_cost, search_cost, budget=20):
        """(steps that ran, employers checked) for a run whose idea and role-search steps take this many seconds of the clock."""
        t, ran = [0.0], []

        def ideas(db, harvest_sources=None):
            ran.append('ideas')
            t[0] += ideas_cost
            return None

        def search(db, search, harvest_sources=None):
            ran.append('role search')
            t[0] += search_cost
            return None

        def probe(system, slug):
            t[0] += 1
            return []
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, contextlib_quiet(), \
                mock.patch.object(scout_core, 'CENTRAL', True), mock.patch.object(scout.time, 'monotonic', lambda: t[0]), \
                mock.patch.object(scout, 'ai_ideas', ideas), mock.patch.object(scout.scout_role_search, 'guarded', search):
            scout.harvest(db, SEEDS, sources=[lambda: [dict(name=f'Co{i}', origin='AI idea', priority=99 - i) for i in range(20)]])
            _, results = scout.run(db, batch=20, harvest_sources=[], probe=probe, workers=1, budget=budget)
        return ran, len(results)

    def test_the_steps_before_the_checks_use_the_same_minutes(self):
        ran, checked = self.run_scout(ideas_cost=8, search_cost=0)
        self.assertEqual(ran, ['ideas', 'role search'])
        self.assertLess(checked, self.run_scout(ideas_cost=0, search_cost=0)[1], 'the ideas took 8 of the 20 s: the checks get what is left')

    def test_new_names_wait_when_half_the_minutes_are_gone_so_the_checks_keep_theirs(self):
        ran, checked = self.run_scout(ideas_cost=11, search_cost=0)
        self.assertEqual(ran, ['ideas'], 'past half the budget, no role search starts')
        self.assertGreater(checked, 0, 'the checks still get the rest')

    def test_no_budget_runs_every_step(self):
        ran, checked = self.run_scout(ideas_cost=50, search_cost=50, budget=0)
        self.assertEqual(ran, ['ideas', 'role search'])
        self.assertGreater(checked, 0)


class ChecksUnderWayAtTheEnd(unittest.TestCase):
    def test_a_check_still_running_at_the_end_is_not_waited_for(self):
        """27 Oct 2026, a benchmark first press: 6 checks started at 165 s were waited for until 379 s of the press's 180."""
        import time

        from src import run_exit

        def slow(system, slug):
            time.sleep(4)
            return []
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, contextlib_quiet(), \
                mock.patch.object(scout_core, 'CENTRAL', True), mock.patch.object(scout, 'ai_ideas', lambda db, harvest_sources=None: None), \
                mock.patch.object(scout.scout_role_search, 'guarded', lambda db, search, harvest_sources=None: None):
            scout.harvest(db, SEEDS, sources=[lambda: [dict(name=f'Co{i}', origin='AI idea', priority=99 - i) for i in range(4)]])
            began = time.monotonic()
            _, results = scout.run(db, batch=4, harvest_sources=[], probe=slow, workers=2, budget=1)
            took = time.monotonic() - began
        self.assertLess(took, 3, f'the scout waited {took:.1f} s for checks still under way at its end')
        self.assertEqual(results, [], 'they wait for the next run')
        self.assertIsNone(run_exit._own[0], 'the central scout keeps its own end (scout_overrun), not the process deadline')
        run_exit.until(None)

    def run_late(self):
        """(summary, seconds taken) for a 1 s scout whose 4 checks each take 4 s."""
        import time

        from src import run_exit

        def slow(system, slug):
            time.sleep(4)
            return []
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, contextlib_quiet(), \
                mock.patch.object(scout_core, 'CENTRAL', True), mock.patch.object(scout, 'ai_ideas', lambda db, harvest_sources=None: None), \
                mock.patch.object(scout.scout_role_search, 'guarded', lambda db, search, harvest_sources=None: None):
            scout.harvest(db, SEEDS, sources=[lambda: [dict(name=f'Co{i}', origin='AI idea', priority=99 - i) for i in range(4)]])
            began = time.monotonic()
            summary, _ = scout.run(db, batch=4, harvest_sources=[], probe=slow, workers=2, budget=1)
            took = time.monotonic() - began
        run_exit.until(None)
        return summary, took

    def test_the_scout_ends_by_its_deadline_not_a_second_after(self):
        """Rerun 40454138418 (p4, 27 Oct 2026): the scout's last check started at 172 s with 8 s left, the end waited 1 s more and the
        press took 181 s of 180."""
        _, took = self.run_late()
        self.assertLess(took, 1.4, f'the scout took {took:.1f} s of its 1')

    def test_the_set_aside_count_stays_a_count(self):
        """The same run's message said "-0.0002545769999642289 set aside": the end's seconds left were returned as the employers set aside."""
        summary, _ = self.run_late()
        self.assertEqual(summary['left'], 0)
        self.assertIsInstance(summary['left'], int)


if __name__ == '__main__':
    unittest.main()
