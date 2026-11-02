"""A fixture run (tests, desktop/e2e) never reaches the real pool, nor reads its downloaded dead-end list.

7 Oct 2026: "E2E Ghost" and "E2E Hollow" were in the central list, and the employers fixtures failed on any Mac with a cached index.
"""
import os
import unittest
from unittest import mock

from src import contribute, employer_index


class FixtureIsolationTest(unittest.TestCase):
    def test_a_fixture_run_sends_nothing_and_reads_no_dead_end_list(self):
        with mock.patch.dict(os.environ, {'JOBADABRA_FIXTURE_DIR': '/tmp/fixtures'}), \
                mock.patch.object(contribute.urllib.request, 'urlopen', side_effect=AssertionError('sent to the real pool')), \
                mock.patch.object(employer_index, '_read', return_value={'nofeed': [{'key': 'e2eghost', 'last': '2099-01-01'}]}):
            self.assertFalse(contribute.send({'v': 2}))
            self.assertEqual(employer_index.central_nofeed(), set())
        with mock.patch.object(employer_index, '_read', return_value={'nofeed': [{'key': 'acme', 'last': '2099-01-01'}]}):
            self.assertEqual(employer_index.central_nofeed(), {'acme'}, 'a real run still reads it')


if __name__ == '__main__':
    unittest.main()
