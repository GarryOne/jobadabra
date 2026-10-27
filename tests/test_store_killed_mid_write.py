"""A step ended by the app at the press's 180 s (desktop/lib/search-steps.js) can be killed in the middle of saving: the tracker stays whole."""
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from src.stores import sqlite
from tests.store_contract import JOB

WRITER = """
import sys
from src.stores import sqlite
store = sqlite.open_store({'JOB_PILOTTO_DATA_DIR': sys.argv[1]})
print('ready', flush=True)
n = 0
while True:
    store.applications.create({**%r, 'url': 'https://example.test/job/%%d' %% n}, 'Saved')
    n += 1
""" % (JOB,)


class KilledMidWriteTests(unittest.TestCase):
    def test_a_writer_killed_without_warning_leaves_every_saved_item_whole(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, True)
        child = subprocess.Popen([sys.executable, '-c', WRITER, str(folder)], stdout=subprocess.PIPE, text=True,
                                 cwd=Path(__file__).resolve().parent.parent)
        self.addCleanup(child.kill)
        self.assertEqual(child.stdout.readline().strip(), 'ready')
        time.sleep(0.5)   # long enough that it is saving items, not starting
        os.kill(child.pid, signal.SIGKILL)   # SIGKILL: no handler runs, the worst case of the app's hard end
        child.wait()
        store = sqlite.open_store({'JOB_PILOTTO_DATA_DIR': str(folder)})
        rows = store.applications.list()
        self.assertGreater(len(rows), 0, 'the items saved before the kill are kept')
        for row in rows:
            self.assertTrue(row['url'].startswith('https://example.test/job/'), 'every kept item is whole')
        db = sqlite3.connect(next(folder.rglob('tracker.sqlite')))
        self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')


class StopReasonTests(unittest.TestCase):
    """The app's hard end (a time-up) is told apart from a Stop press: its row is not Failed and does not say Stop was pressed."""
    def test_a_time_up_marker_makes_the_stop_an_ended_by_time_row(self):
        from unittest import mock
        from src.notion import cron_runs
        marker = Path(tempfile.mkdtemp()) / 'timeup'
        self.addCleanup(shutil.rmtree, marker.parent, True)
        with mock.patch.dict(os.environ, {'JOB_PILOTTO_TIME_UP_FILE': str(marker)}):
            self.assertEqual(cron_runs.stop_reason(), (cron_runs.STOPPED_WORDS, True, True), 'no marker: a Stop press')
            marker.write_text('')
            self.assertEqual(cron_runs.stop_reason(), (cron_runs.TIME_UP_WORDS, False, False))


if __name__ == '__main__':
    unittest.main()
