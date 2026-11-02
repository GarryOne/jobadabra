"""The interview commands and the prep kit open Notion only through the store: with the Notion store chosen in the environment
(JOBADABRA_STORE=notion and a token), `src.ai.interviews`, `src.ai.interview_insights` and `src.ai.prep` reach Notion through
src.stores (its notion adapter's client), never a client of their own; JOBADABRA_DISABLE=notion still reads as "not connected"
(as Tracker.from_env did); and none of the four files calls the Notion API directly. Guards src/ai/interviews.py
(open_for_commands), interview_insights.py, prep.py and interviews_blocks.py (the job line now lives in the notion adapter)."""
import io
import json
import os
import re
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src.ai import interview_insights as ii
from src.ai import interviews, prep
from tests.interviews_fixtures import NotionPages, app

ROOT = Path(__file__).resolve().parents[1]
FILES = ('src/ai/interviews.py', 'src/ai/interviews_blocks.py', 'src/ai/interview_insights.py', 'src/ai/prep.py')
DIRECT = re.compile(r'Tracker\.from_env|Tracker\(|\._request\(|update_page\(|create_page\(|query_database\(')
NOTION = {'JOBADABRA_STORE': 'notion', 'NOTION_TOKEN': 'secret_test', 'NOTION_INTERVIEWS_DB': 'iv-db', 'NOTION_APPLICATIONS_DB': 'apps'}


class Pages(NotionPages):
    """The interview pages, plus a job's page read by its id (prep reads the job it builds for)."""
    def _request(self, method, path, body=None):
        if method == 'GET' and path.startswith('pages/app-'):
            return dict(next(a for a in self.apps if a['id'] == path.split('/')[1]), parent={'database_id': 'apps'})
        return super()._request(method, path, body)


def call(module, *argv):
    out = io.StringIO()
    with redirect_stdout(out), mock.patch('sys.stderr', io.StringIO()):
        code = module.main(list(argv))
    return code, json.loads(out.getvalue().strip().splitlines()[-1])


class NotionOpenedByTheStore(unittest.TestCase):
    def setUp(self):
        self.notion = Pages([app('app-1', 'Acme', 'Interview scheduled', '2026-09-01')])
        self.enterContext(mock.patch.dict(os.environ, NOTION))
        self.enterContext(mock.patch.object(interviews, 'INTERVIEWS_DATABASE_ID', 'iv-db'))
        self.opened = self.enterContext(mock.patch('src.stores.notion.tracker_for', return_value=self.notion))
        os.environ.pop('JOBADABRA_DISABLE', None)

    def test_the_list_reaches_notion_through_the_store(self):
        self.notion.pages['iv-1'] = {'id': 'iv-1', 'url': 'https://notion.test/iv-1', 'properties': {
            'Interview': {'title': [{'text': {'content': 'Acme, round 1'}}]}, 'Application': {'relation': [{'id': 'app-1'}]}}}
        with mock.patch.object(interviews, 'saved_insight', return_value=None):
            code, listed = call(interviews, 'list')
        self.assertEqual((code, [(r['id'], r['title'], r['application']) for r in listed['interviews']]),
                         (0, [('iv-1', 'Acme, round 1', ['app-1'])]))
        self.assertEqual(self.opened.call_count, 1)  # the store's own Notion client, once

    def test_disabled_notion_reads_as_not_connected(self):
        with mock.patch.dict(os.environ, {'JOBADABRA_DISABLE': 'notion'}):
            self.assertEqual(call(interviews, 'list'), (1, {'ok': False, 'error': interviews.NOT_CONNECTED}))
            self.assertEqual(call(ii, 'refresh'), (1, {'ok': False, 'error': 'Connect Notion first'}))

    def test_prep_reads_the_job_from_notion_through_the_store(self):
        with mock.patch.object(prep, 'describe', return_value={'ok': True}) as described:
            self.assertEqual(call(prep, 'describe', 'app-1', '--text', 'SRE role'), (0, {'ok': True}))
        stores, record = described.call_args.args[:2]
        self.assertEqual((stores.name, record['id'], self.opened.call_count), ('notion', 'app-1', 1))


class NoDirectNotionCalls(unittest.TestCase):
    def test_the_four_files_reach_notion_only_through_the_store(self):
        for name in FILES:
            hits = [line for line in (ROOT / name).read_text(encoding='utf-8').splitlines() if DIRECT.search(line)]
            self.assertEqual(hits, [], name)


if __name__ == '__main__':
    unittest.main()
