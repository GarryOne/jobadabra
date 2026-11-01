"""src/tz.py: the user's time zone, also on a Windows machine with no time-zone database (no tzdata package)."""
import unittest
from datetime import datetime
from unittest import mock

from src import tz


class NoTimeZoneDatabaseTests(unittest.TestCase):
    def test_without_any_zone_data_the_computers_offset_is_used_not_a_crash(self):
        # Windows without tzdata: zoneinfo cannot load even "UTC" (every engine run crashed there, e2e on Windows 3 Oct 2026).
        with mock.patch.object(tz, 'ZoneInfo', side_effect=Exception('No time zone found with key UTC')):
            zone = tz.local_zone()
        self.assertEqual(datetime.now(zone).utcoffset(), datetime.now().astimezone().utcoffset())

    def test_a_known_zone_is_still_the_named_one(self):
        with mock.patch.dict('os.environ', {'JOBADABRA_TZ': 'Europe/Zurich'}):
            self.assertEqual(str(tz.local_zone()), 'Europe/Zurich')


if __name__ == '__main__':
    unittest.main()
