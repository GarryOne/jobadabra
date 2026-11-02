"""🎯 Job Matches through the store (Matches.sync): the Notion adapter sends exactly today's requests, and after a move into
Notion its first sync adopts the copied rows instead of adding a second one. Guards src/stores/notion_matches.py sync and
src/stores/matches_sync.py (the contract: tests/store_contract.py)."""
import io
import json
import shutil
import sqlite3
import tempfile
import unittest

from src.notion import client, matches as job_matches
from src.notion.client import Tracker
from src.stores import copy as store_copy, sqlite as sqlite_store
from src.stores.notion_matches import NotionMatches
from tests.store_contract import scored
from tests import test_store_notion   # its stand-in, not its class (that would run its suite here again)


def recording_opener(requests):
    """A Notion that answers every request and keeps (method, path, body): no network, nothing paced."""
    pages = iter(range(1, 1000))

    def opener(request, timeout=20):
        body = json.loads(request.data) if request.data else None
        path = request.full_url.split('/v1/', 1)[1]
        requests.append((request.get_method(), path, body))
        answer = {'results': [], 'has_more': False} if path.endswith('/query') else \
            {'id': f'page-{next(pages)}'} if request.get_method() == 'POST' else {'id': path.rsplit('/', 1)[-1]}
        response = io.BytesIO(json.dumps(answer).encode())
        response.status = 200
        return response
    return opener


def cache():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    return db


class NotionRequestsAreTodaysTests(unittest.TestCase):
    def test_the_notion_adapter_sends_exactly_the_searchs_own_requests(self):
        a, b = scored('https://jobs.example/a', 80), scored('https://jobs.example/b', 60)
        runs = (([a, b], {'applied_urls': {b['url']}}), ([a], {'open_urls': set(), 'dismissed_urls': set()}))
        today, through_store = [], []
        old_db, new_db = cache(), cache()
        old, new = Tracker('t', opener=recording_opener(today)), Tracker('t', opener=recording_opener(through_store))
        store = NotionMatches(new, client.MATCHES_DATABASE_ID)   # the one id both read, from NOTION_MATCHES_DB
        for jobs, kwargs in runs:
            self.assertEqual(store.sync(new_db, jobs, **kwargs), job_matches.sync(old_db, old, jobs, **kwargs))
        self.assertTrue(today)
        self.assertEqual(through_store, today)   # same requests, same order, same bodies: every scoring column as today


@unittest.skipUnless(shutil.which('node'), 'node runs the Notion stand-in')
class MoveThenSyncTests(unittest.TestCase):
    setUpClass = classmethod(test_store_notion.NotionStoreTests.setUpClass.__func__)
    tearDownClass = classmethod(test_store_notion.NotionStoreTests.tearDownClass.__func__)
    make = test_store_notion.NotionStoreTests.make

    def test_the_first_sync_after_a_move_adopts_the_copied_rows_and_fills_the_scoring_columns(self):
        a, b = scored('https://jobs.example/a', 80), scored('https://jobs.example/b', 60)
        with tempfile.TemporaryDirectory() as folder:
            local = sqlite_store.open_store({'JOBADABRA_DATA_DIR': folder})
            local.matches.sync(cache(), [a, b])
            notion = self.make()
            store_copy.copy(local, notion)                     # the move: matches upserted into 🎯 Job Matches
        database = self.env['NOTION_MATCHES_DB']
        self.assertEqual(len(self.tracker.query_database(database)), 2)
        notion.matches.sync(cache(), [a, b])                   # a fresh search cache: it knows none of these rows
        pages = self.tracker.query_database(database)
        self.assertEqual(len(pages), 2)                        # adopted by URL, never a second row
        for page in pages:
            self.assertEqual(page['properties']['Tier']['select']['name'], 'Strong')   # the search's own columns, filled
            self.assertEqual(page['properties']['Confidence']['select']['name'], 'High')


if __name__ == '__main__':
    unittest.main()
