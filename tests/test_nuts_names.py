"""Eurostat's NUTS table as data (src/sources/nuts_names.py): parsed and checked, kept once, never guessed. No network."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.sources import nuts_names  # noqa: E402

HEAD = 'CNTR_CODE,NUTS_ID,NAME_LATN,NUTS_NAME,MOUNT_TYPE,URBN_TYPE,COAST_TYPE\n'
TABLE = HEAD + ''.join(f'BG,BG{n:03d},Area {n},Област {n},0,0,0\n' for n in range(1200)) + 'BG,BG411,Sofia (stolitsa),София (столица),3,1,3\n'


class NutsNamesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        mock.patch.object(nuts_names, 'STORE', Path(self.tmp.name) / 'nuts_names.json').start()
        nuts_names._loaded.clear()
        self.addCleanup(mock.patch.stopall)
        self.addCleanup(self.tmp.cleanup)

    def test_the_table_gives_the_latin_name_of_a_code(self):
        self.assertEqual(nuts_names.parse(TABLE)['BG411'], 'Sofia (stolitsa)')

    def test_a_page_that_is_not_the_table_is_never_kept(self):
        for text in ('<html>404 Not Found</html>', HEAD + 'BG,BG411,Sofia,София,3,1,3\n', ''):
            self.assertEqual(nuts_names.parse(text), {})
        self.assertEqual(nuts_names.names(lambda: nuts_names.parse('<html>')), {})
        self.assertFalse(nuts_names.STORE.exists())

    def test_it_is_fetched_once_and_kept(self):
        fetched = []
        first = nuts_names.names(lambda: fetched.append(1) or nuts_names.parse(TABLE))
        nuts_names._loaded.clear()   # a new run
        second = nuts_names.names(lambda: fetched.append(1) or {})
        self.assertEqual((first['BG411'], second['BG411'], len(fetched)), ('Sofia (stolitsa)', 'Sofia (stolitsa)', 1))
        self.assertEqual(json.loads(nuts_names.STORE.read_text())['BG411'], 'Sofia (stolitsa)')

    def test_a_failed_fetch_is_no_table_not_an_error(self):
        def down():
            raise OSError('offline')
        self.assertEqual(nuts_names.names(down), {})


if __name__ == '__main__':
    unittest.main()
