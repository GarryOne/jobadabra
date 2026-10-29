"""Strategy's one "scored using previous search settings" notice (owner, 18 Oct 2026): every reason a score is outdated (an older scoring method,
other places for an active job) counted once per job, and one Re-score that queues each job once. Nothing is queued without that action."""
import json
import sqlite3
import unittest
from unittest import mock

from src import desktop_strategy
from src.ai import locations, score


def db_with(scores):
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    db.executescript(score.SCORES_TABLE)
    db.executemany('INSERT INTO scores VALUES (?, 1, ?, ?, ?, ?)', [(job_id, 'hash', 'm', '2026-10-01', json.dumps(data)) for job_id, data in scores.items()])
    db.commit()
    return db


NOW = {'locations': {'top_tier': ['zurich']}}
OLD = locations.fingerprint({'locations': {'top_tier': ['berlin']}})
SCORES = {1: {'method': score.PREVIOUS_METHOD, 'locations': OLD},   # both reasons: counted once
          2: {'method': score.CURRENT_METHOD, 'locations': OLD},    # other places, active
          3: {'method': score.PREVIOUS_METHOD},                     # older method only
          4: {'method': score.CURRENT_METHOD, 'locations': OLD},    # other places, but applied (not active): left as it is
          5: {'method': score.CURRENT_METHOD, 'locations': locations.fingerprint(NOW)}}


class OutdatedTests(unittest.TestCase):
    def setUp(self):
        patches = [mock.patch.object(locations, 'current', return_value=NOW), mock.patch.object(locations, 'active_ids', return_value={1, 2, 3, 5})]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_each_job_counts_once_whatever_its_reasons(self):
        summary = desktop_strategy.outdated(db_with(SCORES), {})
        self.assertEqual(summary, {'count': 3, 'method': 2, 'places': 2})

    def test_nothing_outdated_says_zero(self):
        self.assertEqual(desktop_strategy.outdated(db_with({5: SCORES[5]}), {}), {'count': 0, 'method': 0, 'places': 0})

    def test_reading_the_count_queues_nothing(self):
        db = db_with(SCORES)
        desktop_strategy.outdated(db, {})
        self.assertEqual({row['input_hash'] for row in db.execute('SELECT input_hash FROM scores')}, {'hash'})

    def test_re_score_queues_each_outdated_job_once_and_nothing_else(self):
        db = db_with(SCORES)
        self.assertEqual(desktop_strategy.rescore_outdated(db, {}), 3)
        queued = {row['job_id'] for row in db.execute("SELECT job_id FROM scores WHERE input_hash=''")}
        self.assertEqual(queued, {1, 2, 3})


class CommandTests(unittest.TestCase):
    def test_the_window_s_re_score_reaches_this_command(self):
        from pathlib import Path
        source = (Path(__file__).resolve().parents[1] / 'src' / 'desktop.py').read_text()
        self.assertIn("sub.add_parser('rescore-outdated')", source)
        self.assertIn("'rescore-outdated': _rescore_outdated", source)
        handlers = (Path(__file__).resolve().parents[1] / 'src' / 'desktop_tracker.py').read_text()
        self.assertIn("rescore_outdated(db, stages)", handlers)


if __name__ == '__main__':
    unittest.main()
