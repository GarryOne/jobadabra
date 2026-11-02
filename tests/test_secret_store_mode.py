"""The run's own secrets file (job-site passwords of a test run or the twin) is private to this user, whoever made it first (src/secret_store.py)."""
import json
import os
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from src import secret_store  # noqa: E402


@unittest.skipIf(os.name == 'nt', 'POSIX file modes')
class SecretFileModeTest(unittest.TestCase):
    def test_a_saved_file_is_private_even_when_it_existed_readable(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'isolated-secrets.json')
            with open(path, 'w', encoding='utf-8') as handle:
                json.dump({}, handle)
            os.chmod(path, 0o644)
            secret_store._isolated_save(path, {'jobadabra.example.test.password': {'value': 'x'}})
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)

    def test_a_new_file_is_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'sub', 'isolated-secrets.json')
            secret_store._isolated_save(path, {})
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)


if __name__ == '__main__':
    unittest.main()
