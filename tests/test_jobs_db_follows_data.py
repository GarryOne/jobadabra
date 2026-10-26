"""Every reader that opens the job database when it runs finds it in the data folder as it is then (26 Oct 2026: paths.JOBS_DB is fixed at
import, so a test that patched src.paths.DATA still wrote into the checkout's data/jobs.sqlite through the AI answers' cache, page recipes and
~7 more readers; ~9 test files left that file behind). New code that opens the database at call time uses paths.jobs_db()."""
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import paths

SRC = Path(__file__).resolve().parents[1] / 'src'


class JobsDbFollowsData(unittest.TestCase):
    def test_a_patched_data_folder_moves_the_job_database(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.paths.DATA', Path(tmp)):
            self.assertEqual(paths.jobs_db(), Path(tmp) / 'jobs.sqlite')
            from src.ai import decide
            decide._db().close()   # the AI answers' cache: the first reader found writing into the checkout
            self.assertTrue((Path(tmp) / 'jobs.sqlite').exists())

    def test_a_patched_job_database_still_wins(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch('src.paths.JOBS_DB', Path(tmp) / 'x.sqlite'):
            self.assertEqual(paths.jobs_db(), Path(tmp) / 'x.sqlite')

    def test_no_reader_imports_the_fixed_path_when_it_runs(self):
        """The class: an indented `from ..paths import JOBS_DB` reads the import-time path at call time; it must call jobs_db()."""
        found = [f'{f.relative_to(SRC)}:{n}' for f in sorted(SRC.rglob('*.py')) for n, line in enumerate(f.read_text().splitlines(), 1)
                 if re.match(r'\s+from \.+paths import .*\bJOBS_DB\b', line)]
        self.assertEqual(found, [])


if __name__ == '__main__':
    unittest.main()
