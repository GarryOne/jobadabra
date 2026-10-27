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


if __name__ == '__main__':
    unittest.main()
