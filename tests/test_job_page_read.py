"""`job_page read`: a drawer page in one store call, each GET made once (src/stores/job_page.py)."""
import io
import json
import os
import unittest
from unittest import mock

from src.stores import __main__ as cli
import tempfile

from src.stores import job_page, memory, sqlite


class FakeTracker:
    def __init__(self):
        self.calls = []

    def _request(self, method, path, body=None):
        self.calls.append((method, path))
        return {'path': path}


class Part:
    def __init__(self, tracker, paths):
        self.tracker, self.paths = tracker, paths

    def sections(self, app_id):
        return [self.tracker._request('GET', p) for p in self.paths]

    def list(self, app_id=None):
        return [self.tracker._request('GET', p) for p in self.paths]


class JobPageReadTests(unittest.TestCase):
    def test_the_same_get_is_made_once_across_the_three_reads(self):
        tracker = FakeTracker()
        shared = ['pages/a', 'blocks/a/children']
        stores = mock.Mock(applications=Part(tracker, shared), events=Part(tracker, shared), interviews=Part(tracker, shared))
        answer = job_page.read(stores, 'a')
        self.assertEqual(sorted(tracker.calls), sorted([('GET', p) for p in shared]))
        self.assertEqual(len(answer['sections']), 2)
        self.assertEqual(answer['events'], answer['interviews'])

    def test_the_tracker_is_put_back_and_writes_pass_through(self):
        tracker = FakeTracker()
        original = tracker._request
        with job_page.read_once([tracker]):
            tracker._request('PATCH', 'blocks/x', {})
            tracker._request('PATCH', 'blocks/x', {})
        self.assertEqual(tracker.calls, [('PATCH', 'blocks/x')] * 2)
        self.assertEqual(tracker._request.__func__, original.__func__)

    def test_the_cli_answers_sections_events_interviews_and_nothing_else(self):
        stores = memory.open_store()
        out = io.StringIO()
        with mock.patch.object(cli, 'open_stores', return_value=stores), mock.patch.dict(os.environ, {'JOBADABRA_STORE': 'memory'}):
            code = cli.main(['call', 'job_page', 'read', json.dumps({'app_id': 'nope'})], out=out)
            self.assertEqual((code, sorted(json.loads(out.getvalue())['result'])), (0, ['events', 'interviews', 'sections']))
            out2 = io.StringIO()
            self.assertEqual(cli.main(['call', 'job_page', 'read', json.dumps({'app_id': 'a', 'x': 1})], out=out2), 2)

    def test_the_default_sqlite_store_is_read_on_the_calling_thread(self):
        # 21 Oct 2026 (7cc945d): the three reads ran in pool threads, and a SQLite connection refuses another thread: every drawer on the default store said
        # "Could not read this job" (the beta gate's stores suite). A store with no Notion tracker has no network GET to overlap: it is read in turn.
        with tempfile.TemporaryDirectory() as folder:
            stores = sqlite.open_store({'JOBADABRA_DATA_DIR': folder})
            answer = job_page.read(stores, 'nope')
        self.assertEqual(sorted(answer), ['events', 'interviews', 'sections'])


if __name__ == '__main__':
    unittest.main()
