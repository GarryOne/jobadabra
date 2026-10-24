"""One finished search as counts and seconds (src/search_report.py): measured from the run's start, nothing but numbers, a fixed family and a place."""
import json
import sqlite3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import role_kinds, search_report  # noqa: E402

FIELDS = {'family', 'country', 'city', 'in_places', 'scored', 'fit70', 'first_s', 'tenth_s', 'first_fit70_s'}


def jobs_db(rows):
    db = sqlite3.connect(':memory:')
    db.execute("CREATE TABLE jobs (id INTEGER PRIMARY KEY, title TEXT, location TEXT, first_seen_at TEXT, state TEXT)")
    db.execute("CREATE TABLE scores (job_id INTEGER, created_at TEXT, data_json TEXT)")
    for i, (location, seen, score_at, score) in enumerate(rows, 1):
        db.execute('INSERT INTO jobs VALUES (?,?,?,?,?)', (i, f'Title {i}', location, seen, 'open'))
        if score_at:
            db.execute('INSERT INTO scores VALUES (?,?,?)', (i, score_at, json.dumps({'score': score})))
    return db


class SearchReportTests(unittest.TestCase):
    def test_seconds_run_from_the_start_and_only_jobs_in_places_count(self):
        rows = [('Zurich', f'2026-10-18T10:00:{5 + i:02d}Z', f'2026-10-18T10:00:{20 + i:02d}Z', 80 if i == 3 else 40) for i in range(12)]
        rows += [('Mars', '2026-10-18T10:00:02Z', '2026-10-18T10:00:03Z', 90), ('Zurich', '2026-10-17T09:00:00Z', None, 0)]
        got = search_report.timings(jobs_db(rows), '2026-10-18T10:00:00Z', lambda location, title: location == 'Zurich')
        self.assertEqual(got, {'in_places': 12, 'scored': 12, 'fit70': 1, 'first_s': 5, 'tenth_s': 14, 'first_fit70_s': 23})

    def test_the_report_carries_how_the_sources_were_read_when_the_search_counted_them(self):
        from unittest import mock
        fields = {'read_feed_api_sources': 4, 'read_feed_api_jobs': 30}
        with mock.patch('src.read_methods.saved', return_value=fields), mock.patch('src.read_methods.take_extension', return_value=(2, 5)):
            got = search_report.reads('2026-10-18T10:00:00Z')
        self.assertEqual((got['read_feed_api_sources'], got['read_extension_tab_sources'], got['read_extension_tab_jobs']), (4, 2, 5))
        with mock.patch('src.read_methods.saved', return_value={}), mock.patch('src.read_methods.take_extension', return_value=(0, 0)):
            self.assertEqual(search_report.reads('2026-10-18T10:00:00Z'), {}, 'a build or a run with nothing counted sends no read fields')

    def test_a_search_that_found_nothing_has_no_seconds(self):
        got = search_report.timings(jobs_db([]), '2026-10-18T10:00:00Z', lambda *_: True)
        self.assertEqual(got, {'in_places': 0, 'scored': 0, 'fit70': 0, 'first_s': None, 'tenth_s': None, 'first_fit70_s': None})

    def test_the_record_has_only_listed_fields_and_a_family_from_the_fixed_list(self):
        from unittest import mock
        with mock.patch.object(role_kinds, 'kinds_of', return_value={'barista': 'hospitality', 'cook': 'hospitality', 'x': 'other'}), \
                mock.patch.object(search_report, 'place', return_value=('CH', 'zurich')), mock.patch.object(search_report, 'reads', return_value={}):
            got = search_report.build('2026-10-18T10:00:00Z', jobs_db([]), {'role_keywords': ['barista', 'cook', 'x']}, lambda *_: True)
        self.assertEqual(set(got), FIELDS)
        self.assertIn(got['family'], role_kinds.KINDS)
        self.assertEqual(got['family'], 'hospitality')
        self.assertEqual(search_report.family({'role_keywords': []}), 'other')


if __name__ == '__main__':
    unittest.main()
