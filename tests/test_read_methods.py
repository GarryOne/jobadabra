"""How sources were read (src/read_methods.py): five fixed names, one method per source (the later step wins), failed reads uncounted, AI cost and
seconds per method, the install report's flat fields, and the scout run record that carries the tally."""
import os
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from src import read_methods as rm
from src import scout_index


class ReadMethods(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        patch = mock.patch.object(rm, '_file', lambda: Path(self.dir.name) / 'read_methods.json')
        patch.start(); self.addCleanup(patch.stop); self.addCleanup(self.dir.cleanup)
        ext = mock.patch.object(rm, '_extension_file', lambda: Path(self.dir.name) / 'read_extension.json')
        ext.start(); self.addCleanup(ext.stop)
        rm.reset('2026-10-24T10:00:00')
        self.addCleanup(rm._state.update, on=False)   # counting off again: no other test writes a tally

    def test_each_source_counts_once_under_the_last_step_that_gave_its_jobs(self):
        with rm.reading('a', 'ai_board') as read:
            rm.mark('browser')
            read.jobs = 4
        with rm.reading('a', 'ai_board') as read:   # a second pass of the same source with a lower method does not take it back
            read.jobs = 9
        with rm.reading('b', 'feed_api') as read:
            read.jobs = 2
        snap = rm.snapshot()
        self.assertEqual((snap['browser']['sources'], snap['browser']['jobs']), (1, 4))
        self.assertEqual(snap['ai_board']['sources'], 0)
        self.assertEqual((snap['feed_api']['sources'], snap['feed_api']['jobs']), (1, 2))

    def test_a_failed_read_is_not_a_source_read(self):
        with self.assertRaises(ValueError):
            with rm.reading('a', 'feed_api'):
                raise ValueError('down')
        with rm.reading('b', 'feed_api') as read:
            read.failed = True
        self.assertEqual(rm.snapshot()['feed_api']['sources'], 0)

    def test_seconds_and_ai_cost_go_to_the_source_being_read(self):
        with rm.reading('a', 'ai_board'):
            rm.ai(0.021)
            time.sleep(0.01)
        rm.ai(5)   # outside a read: nobody's
        snap = rm.snapshot()
        self.assertEqual(snap['ai_board']['ai_cents'], 2)
        self.assertEqual(sum(row['ai_cents'] for row in snap.values()), 2)

    def test_flat_has_every_method_and_measure_or_nothing(self):
        self.assertEqual(rm.flat(), {})
        with rm.reading('a', 'feed_api'):
            pass
        fields = rm.flat()
        self.assertEqual(set(fields), {f'read_{m}_{x}' for m in rm.METHODS for x in rm.MEASURES})
        self.assertEqual(fields['read_feed_api_sources'], 1)

    def test_the_search_saves_its_tally_for_the_report_and_only_that_search(self):
        with rm.reading('a', 'feed_api'):
            pass
        self.assertEqual(rm.saved('2026-10-24T09:59:50.000Z')['read_feed_api_sources'], 1)
        self.assertEqual(rm.saved('2026-10-24T10:30:00Z'), {}, 'a later search has not run yet')

    def test_the_scout_keeps_its_tally_in_memory_and_never_overwrites_the_search(self):
        with rm.reading('a', 'feed_api'):
            pass
        rm.reset(persist=False)
        with rm.reading('b', 'plain_page'):
            pass
        self.assertEqual(rm.saved('2026-10-24T09:00:00Z')['read_feed_api_sources'], 1)
        self.assertEqual(scout_index.run_record({}, [], at=datetime(2026, 10, 24, 4, 20, tzinfo=timezone.utc))['reads']['plain_page']['sources'], 1)

    def test_a_site_read_in_the_users_tab_joins_the_next_report_once(self):
        rm.note_extension('careers.example', 3)
        rm.note_extension('careers.example', 5)
        self.assertEqual(rm.take_extension(), (1, 5))
        self.assertEqual(rm.take_extension(), (0, 0))


if __name__ == '__main__':
    unittest.main()
