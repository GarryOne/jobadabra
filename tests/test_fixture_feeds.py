"""JOBADABRA_FIXTURE_DIR: feeds come from a folder, never the network (the end-to-end journey's deterministic jobs)."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src import employer_index
from src.sources import ats


class FixtureFeedsTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        root = Path(self.folder.name)
        (root / 'routes.json').write_text(json.dumps({'/boards/acme/jobs': 'acme.json'}))
        (root / 'acme.json').write_text(json.dumps({'jobs': [
            {'id': 7, 'title': 'Senior SRE', 'location': {'name': 'Zurich, Switzerland'}, 'absolute_url': 'https://boards.example.test/acme/7',
             'content': '<p>Run Kubernetes.</p>', 'updated_at': '2026-10-01'}]}))
        patch = mock.patch.dict('os.environ', {'JOBADABRA_FIXTURE_DIR': self.folder.name})
        patch.start()
        self.addCleanup(patch.stop)
        self.addCleanup(self.folder.cleanup)

    def test_a_routed_feed_is_read_from_the_folder(self):
        jobs = ats.fetch('greenhouse', 'acme')
        self.assertEqual([(j['title'], j['location']) for j in jobs], [('Senior SRE', 'Zurich, Switzerland')])

    def test_a_feed_with_no_route_fails_like_an_unreachable_one_and_never_goes_online(self):
        with mock.patch('urllib.request.urlopen', side_effect=AssertionError('went online')):
            with self.assertRaises(OSError):
                ats.fetch('greenhouse', 'unknown')

    def test_the_employer_index_is_not_downloaded(self):
        with mock.patch('urllib.request.urlopen', side_effect=AssertionError('went online')):
            self.assertEqual(employer_index.load(cache=Path(self.folder.name) / "idx.json"), [])


if __name__ == '__main__':
    unittest.main()


class DiscoveryTest(unittest.TestCase):
    def test_the_jobs_ch_crawl_stays_offline_in_fixture_mode(self):
        from src.sources import boards
        with mock.patch.dict('os.environ', {'JOBADABRA_FIXTURE_DIR': '/nowhere'}), mock.patch('urllib.request.urlopen', side_effect=AssertionError('went online')), \
                mock.patch('sys.argv', ['discover']):
            self.assertEqual(boards.main(), 0)


class ScoutTest(unittest.TestCase):
    def test_the_scout_uses_only_its_seeds_and_the_fixture_feeds_in_fixture_mode(self):
        import sqlite3
        from src import scout
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        root = Path(folder.name)
        (root / 'routes.json').write_text(json.dumps({'/boards/e2e-gamma/jobs': 'gamma.json'}))
        (root / 'gamma.json').write_text(json.dumps({'jobs': [
            {'id': 1, 'title': 'Senior Site Reliability Engineer', 'location': {'name': 'Zurich, Switzerland'}, 'absolute_url': 'https://boards.example.test/g/1', 'content': '<p>x</p>', 'updated_at': '2026-10-01'}]}))
        seeds = {'excluded': [], 'tier1_known': [{'name': 'E2E Gamma', 'ats': 'greenhouse', 'slug': 'e2e-gamma'}], 'tier1': [], 'manual_watch': [], 'regional': {}, 'boards': []}
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        with mock.patch.dict('os.environ', {'JOBADABRA_FIXTURE_DIR': folder.name}), mock.patch('urllib.request.urlopen') as online:
            summary, results = scout.run(db, batch=5, seeds=seeds)
        online.assert_not_called()   # no Hacker News, no whiteboards: the scout swallows a failed source, so only "never tried" proves it
        self.assertEqual([(candidate['name'], outcome['status']) for candidate, outcome in results], [('E2E Gamma', 'found')])
        self.assertEqual(summary['harvested'], 1)
