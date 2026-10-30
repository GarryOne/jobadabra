"""The scout's minutes count from its start, not from its first employer check (src/scout.py run).
19 Oct 2026, e1's live searches: a driver's scout given 180 s ran 638 s: the lists (a Wikidata timeout, 143 s), the AI's ideas (19 s) and the
role searches (103 s) ran before the clock started."""
import tempfile
import unittest
from concurrent.futures import ALL_COMPLETED, Future
from pathlib import Path
from unittest import mock

from src import run_exit, scout, scout_core, scout_run
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


class ScheduledChecks:
    """Run checks only when their four fake seconds elapse; no threads or real sleeps."""
    def __init__(self, ignore_timeout=False):
        self.seconds = 100.0
        self.ignore_timeout = ignore_timeout
        self.tasks = {}

    def clock(self):
        return self.seconds

    def submit(self, check, candidate):
        future = Future()
        self.tasks[future] = (self.seconds + 4, check, candidate)
        return future

    def wait(self, futures, timeout, return_when):
        ends = [self.tasks[f][0] for f in futures]
        end = max(ends) if return_when == ALL_COMPLETED else min(ends)
        self.seconds = end if self.ignore_timeout else min(self.seconds + timeout, end)
        finished = {f for f in futures if self.tasks[f][0] <= self.seconds}
        for future in finished:
            _, check, candidate = self.tasks[future]
            future.set_result(check(candidate))
        return finished, set(futures) - finished

    def shutdown(self, wait, cancel_futures):
        if wait:
            self.wait(list(self.tasks), timeout=float('inf'), return_when=ALL_COMPLETED)
        if cancel_futures:
            for future in self.tasks:
                future.cancel()


class ChecksUnderWayAtTheEnd(unittest.TestCase):
    def run_late(self, ignore_timeout=False):
        """(summary, results, fake seconds) for four 4 s checks on two workers, budget 1 s."""
        checks = ScheduledChecks(ignore_timeout)
        began = checks.clock()
        self.addCleanup(run_exit.until, None)
        with tempfile.TemporaryDirectory() as tmp, job_store.connect(Path(tmp) / 'jobs.sqlite') as db, contextlib_quiet(), \
                mock.patch.object(scout_core, 'CENTRAL', True), mock.patch.object(scout, 'ai_ideas', return_value=None), \
                mock.patch.object(scout.scout_role_search, 'guarded', return_value=None), \
                mock.patch.object(scout.time, 'monotonic', checks.clock), \
                mock.patch.object(scout, 'ThreadPoolExecutor', return_value=checks), \
                mock.patch.object(scout, 'wait', checks.wait):
            scout.harvest(db, SEEDS, sources=[lambda: [dict(name=f'Co{i}', origin='AI idea', priority=99 - i) for i in range(4)]])
            summary, results = scout.run(db, batch=4, harvest_sources=[], probe=lambda *_: [], workers=2, budget=1)
        return summary, results, checks.clock() - began

    def assert_deadline(self, took):
        # The final wait allows 0.25 s when already at the deadline; a whole extra second must fail.
        self.assertLessEqual(took, 1.25, f'the scout took {took:.2f} s of its 1')

    def test_a_check_still_running_at_the_end_is_not_waited_for(self):
        """27 Oct 2026: checks started at 165 s were waited for until 379 s of the press's 180."""
        summary, results, took = self.run_late()
        self.assert_deadline(took)
        self.assertEqual(results, [], 'they wait for the next run')
        self.assertEqual(summary['queued'], 4, 'unfinished checks remain pending')
        self.assertIsNone(run_exit._own[0], 'the central scout keeps its own end (scout_overrun), not the process deadline')

    def test_the_scout_ends_by_its_deadline_not_a_second_after(self):
        """Rerun 40454138418: the final check made the press take 181 s of 180."""
        _, _, took = self.run_late()
        self.assertEqual(took, 1.0, 'unfinished checks use only the remaining budget')
        self.assert_deadline(took)
        # Mutation control: a waiter that never stops at its timeout must trip the same guard.
        _, _, overrun = self.run_late(ignore_timeout=True)
        with self.assertRaisesRegex(AssertionError, 'the scout took'):
            self.assert_deadline(overrun)

    def test_a_wait_at_the_deadline_has_only_a_quarter_second_grace(self):
        checks = ScheduledChecks()
        began = checks.clock()
        future = checks.submit(lambda _: {}, None)
        with mock.patch.object(scout.time, 'monotonic', checks.clock), mock.patch.object(scout, 'wait', checks.wait):
            finished, retained = scout_run.wait_finished(scout, {future: 0}, began)
        self.assertEqual(checks.clock() - began, 0.25)
        self.assertEqual(finished, set())
        self.assertEqual(retained, {}, 'a check still running after the grace waits for the next run')

    def test_the_set_aside_count_stays_a_count(self):
        """The same run's message said "-0.0002545769999642289 set aside" by returning seconds left as a count."""
        summary, _, _ = self.run_late()
        self.assertEqual(summary['left'], 0)
        self.assertIsInstance(summary['left'], int)


if __name__ == '__main__':
    unittest.main()
