"""The Strategy page's Locations data (owner, 17 Oct 2026): relocation as a value, the search-only list, and where the person lives, read-only."""
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import desktop, store


def read(search, profile=''):
    with tempfile.TemporaryDirectory() as tmp:
        db = store.connect(Path(tmp) / 'j.sqlite')
        tracker = SimpleNamespace(url_stages=lambda: {}, page_text=lambda: profile, _request=lambda *a, **k: {'results': []})
        os.environ.pop('JOBADABRA_PROFILE_FILE', None)
        with mock.patch.object(desktop.digest, 'eligible_jobs', lambda db: ([], [])), mock.patch('src.paths.load_search_config', lambda matching=True: search), \
                mock.patch('src.paths.local_profile', lambda: ''):
            data = desktop.strategy(db, tracker)
        db.close()
    return data


class StrategyLocationsTests(unittest.TestCase):
    def test_relocation_mode_comes_back_as_a_value(self):
        self.assertEqual(read({'locations': {'relocation': ['no'], 'abroad': ['berlin']}})['relocation'], 'no')
        self.assertEqual(read({'locations': {'abroad': ['berlin']}})['relocation'], 'yes', 'no key: yes when places abroad exist, as the crawl reads it')
        self.assertEqual(read({'locations': {}})['relocation'], 'unspecified')

    def test_the_search_only_list_is_returned_as_words_and_empty_when_unset(self):
        data = read({'locations': {'search_override': ['netherlands', 'germany']}})
        self.assertEqual(len(data['lists']['searchOverride']), 2)
        self.assertEqual(read({'locations': {}})['lists']['searchOverride'], [])


if __name__ == '__main__':
    unittest.main()
