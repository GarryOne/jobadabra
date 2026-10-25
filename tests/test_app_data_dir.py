"""tools/app_data_dir.py finds the app's data folder under its new name, or its old one on an install not moved yet."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
import app_data_dir  # noqa: E402


class AppDataDir(unittest.TestCase):
    def pick(self, *existing):
        with tempfile.TemporaryDirectory() as tmp:
            for name in existing:
                (Path(tmp) / name).mkdir()
            app_data_dir.SUPPORT = Path(tmp)
            return app_data_dir.app_data_dir().name

    def test_names(self):
        self.assertEqual(self.pick(), 'Jobadabra')
        self.assertEqual(self.pick('Job Pilotto'), 'Job Pilotto')
        self.assertEqual(self.pick('Job Pilotto', 'Jobadabra'), 'Jobadabra')


if __name__ == '__main__':
    unittest.main()
