"""python -m src: which commands take the one-search-at-a-time run lock (src/__main__.py)."""
import sys
import unittest
from contextlib import contextmanager
from unittest import mock


class RunLockTest(unittest.TestCase):
    def run_main(self, *argv):
        taken, ran = [], []

        @contextmanager
        def lock(**kwargs):
            taken.append(kwargs)
            yield

        module = mock.Mock(main=lambda: ran.append(1) or 0)
        with mock.patch.object(sys, 'argv', ['src', *argv]), mock.patch('src.paths.run_lock', lock), mock.patch('src.field_redraft.refresh_quietly'), \
                mock.patch('importlib.import_module', return_value=module), \
                mock.patch('src.notion.search_settings.sync_quietly'), mock.patch('src.places.refresh_quietly'), \
                mock.patch('src.crash_reporting.install'):
            from src import __main__ as entry
            self.assertEqual(entry.main(), 0)
        return taken, ran

    def test_a_search_takes_the_lock(self):
        taken, ran = self.run_main('daily', '--mode', 'scheduled')
        self.assertEqual((len(taken), len(ran)), (1, 1))

    def test_the_log_boxs_reading_never_waits_for_a_search(self):
        taken, ran = self.run_main('daily', '--mode', 'add', '--from-app', '--propose')
        self.assertEqual((taken, len(ran)), ([], 1))

    def test_preparing_one_kit_never_waits_for_a_search(self):
        taken, ran = self.run_main('daily', '--mode', 'prepare', '--log-run', '--job', '12bc5f58', '--action', 'applied')
        self.assertEqual((taken, len(ran)), ([], 1))

    def test_prepare_without_a_job_is_not_exempt(self):
        taken, _ = self.run_main('daily', '--mode', 'prepare')
        self.assertEqual(len(taken), 1)

    def test_saving_the_log_still_takes_turns(self):
        taken, _ = self.run_main('daily', '--mode', 'add', '--from-app', '--reading', 'x.json')
        self.assertEqual(len(taken), 1)


if __name__ == '__main__':
    unittest.main()
