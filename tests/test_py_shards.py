"""tools/py-shards.py (9 Oct 2026): the Python suite split across parallel processes. The split must never drop or duplicate a test module."""
import contextlib
import importlib.util
import io
import tempfile
import unittest
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('py_shards', ROOT / 'tools/py-shards.py')
shards = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shards)


class WidthTests(unittest.TestCase):
    def test_width_is_cores_over_slots_plus_two_extra_with_spare_memory(self):
        self.assertEqual(shards.default_jobs(8, 2, 8.0), 6)   # the measured gain: 52 s -> 39 s on a loaded 8-core Mac, 11 Oct 2026
        self.assertEqual(shards.default_jobs(16, 2, 8.0), 10)

    def test_a_busy_mac_keeps_the_base_width(self):
        self.assertEqual(shards.default_jobs(8, 2, 1.0), 4)
        self.assertEqual(shards.default_jobs(8, 2, None), 4)   # memory unknown (Windows): never wider than the base

    def test_the_width_never_exceeds_three_quarters_of_the_cores_and_is_at_least_two(self):
        self.assertEqual(shards.default_jobs(2, 2, 8.0), 2)
        self.assertEqual(shards.default_jobs(4, 4, 8.0), 3)
        self.assertEqual(shards.default_jobs(8, 0, 8.0), 8)   # slots 0 = no queue

    def test_free_memory_is_read_from_vm_stat_text(self):
        text = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:   10000.\nPages inactive:   90000.\nPages active: 5.\n'
        self.assertAlmostEqual(shards.free_gb_from_vm_stat(text), 100000 * 16384 / 1073741824, places=3)
        self.assertIsNone(shards.free_gb_from_vm_stat('nothing useful'))


class ShardTests(unittest.TestCase):
    def test_every_module_lands_in_exactly_one_shard_for_any_job_count(self):
        modules = shards.all_modules()
        self.assertGreater(len(modules), 100)
        for jobs in (1, 2, 4, 7, 500):
            flat = [m for shard in shards.split(modules, jobs) for m in shard]
            self.assertEqual(sorted(flat), sorted(modules), f'jobs={jobs}')

    def test_the_slow_modules_land_in_different_shards_and_the_weights_name_real_modules(self):
        # 11 Oct 2026: balanced by file size, test_ship and test_heavy_lock (50 s each) could share a shard; the weights are measured seconds
        weights = shards.weights()
        modules = shards.all_modules()
        self.assertTrue(set(weights) <= set(modules), f'weights for modules that do not exist: {sorted(set(weights) - set(modules))}')
        slowest = sorted(weights, key=weights.get, reverse=True)[:4]
        placed = shards.split(modules, 8)
        homes = [next(i for i, shard in enumerate(placed) if name in shard) for name in slowest]
        self.assertEqual(len(set(homes)), len(slowest), f'the slowest modules {slowest} share a shard')

    def test_the_bootstrap_module_that_sets_the_fake_ids_exists(self):
        self.assertIn(shards.BOOTSTRAP, shards.all_modules())

    def test_the_dev_tooling_left_out_of_the_build_exist_and_are_the_only_difference(self):
        everything = shards.all_modules()
        for name in shards.DEV_TOOLING:
            self.assertIn(name, everything, f'{name} is listed as dev tooling but there is no tests/{name}.py: a renamed file would silently join the Build box')
        app = [m for m in everything if m not in shards.DEV_TOOLING]
        self.assertEqual(len(app) + len(shards.DEV_TOOLING), len(everything))
        self.assertGreater(len(app), 150, 'the Build box still runs the product\'s Python tests')


class SlowestTests(unittest.TestCase):
    """CI names its slow tests (12 Oct 2026: one test waited 300 s and nobody could see which)."""
    def test_unittest_durations_are_summed_per_module_and_ranked(self):
        shard_a = ('Slowest test durations\n' + '-' * 70 + '\n'
                   '300.100s   test_status (test_heavy_lock_reap.ReapTest.test_status)\n'
                   '2.000s     test_one (test_ship.ShipTest.test_one)\n')
        shard_b = '5.500s     test_two (tests.test_ship.ShipTest.test_two)\n\nRan 3 tests in 307.6s\n'
        modules, tests = shards.slowest([shard_a, shard_b])
        self.assertEqual([m for m, _ in modules], ['test_heavy_lock_reap', 'test_ship'])
        self.assertAlmostEqual(dict(modules)['test_ship'], 7.5)
        self.assertEqual(tests[0], ('ReapTest.test_status', 300.1))

    def test_the_shards_ask_unittest_for_every_duration_on_3_12(self):
        import sys
        self.assertEqual(shards.DURATIONS, ['--durations', '0'] if sys.version_info >= (3, 12) else [])



class EndedTests(unittest.TestCase):
    """26 Oct 2026: a test reached the scout's os._exit(0); the unittest process ended halfway with exit 0 and no summary, and the shard passed."""
    def test_a_shard_without_unittests_summary_failed_even_with_exit_0(self):
        self.assertIsNone(shards.ended_badly('...\nRan 12 tests in 1.0s\n\nOK (skipped=1)\n', 0))
        self.assertIn('summary', shards.ended_badly('Published 1 feeds\nscout: 3 check thread(s) still running; leaving without them\n', 0))
        self.assertIn('summary', shards.ended_badly('Ran 12 tests in 1.0s\n', 0))

    def test_a_shard_that_exited_non_zero_failed(self):
        self.assertIn('exit 1', shards.ended_badly('Ran 3 tests in 1.0s\n\nFAILED (failures=1)\n', 1))


class NonBlockingOutputTests(unittest.TestCase):
    """26 Oct 2026, #2136: a shard exited 120 with every test passed. Its output was a pipe shared by the processes its tests start; one of them
    (Node does this) left the pipe non-blocking, so decide's exit line met a full pipe: BlockingIOError, and Python could not flush at exit.
    A shard writes to a file now, which never answers "try again"."""
    LOUD = (
        'import atexit, os, stat, sys, unittest\n'
        'def _loud():\n'
        '    os.set_blocking(2, False)\n'
        "    print('x' * 4_000_000, file=sys.stderr, flush=True)\n"
        'atexit.register(_loud)\n'
        'class T(unittest.TestCase):\n'
        '    def test_the_output_is_not_a_pipe(self):\n'   # the race above fails about one run in two; this fails every time
        '        self.assertFalse(stat.S_ISFIFO(os.fstat(1).st_mode))\n')

    def test_a_shard_whose_output_turned_non_blocking_still_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, 'test_boot.py').write_text('import unittest\nclass B(unittest.TestCase):\n    def test_b(self):\n        pass\n', encoding='utf-8')
            Path(tmp, 'test_loud.py').write_text(self.LOUD, encoding='utf-8')
            with mock.patch.multiple(shards, ROOT=Path(tmp), TESTS=Path(tmp), BOOTSTRAP='test_boot'), contextlib.redirect_stdout(io.StringIO()), \
                    contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(shards.main(['--jobs', '1', 'test_loud']), 0)


if __name__ == '__main__':
    unittest.main()
