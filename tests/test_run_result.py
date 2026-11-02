"""The engine writes one result object, and the desktop app reads that same shape."""
import json
import os
import tempfile
import unittest
from pathlib import Path

from src import run_result
from src.notion import cron_runs

FIXTURE = Path(__file__).resolve().parents[1] / 'tests' / 'fixtures' / 'run-result.json'
REQUIRED = ('v', 'ok', 'run_id', 'warnings', 'job', 'notion_url', 'mail')


class RunResultTest(unittest.TestCase):
    def setUp(self):
        run_result.reset()

    def tearDown(self):
        run_result.reset()
        os.environ.pop('JOBADABRA_RUN_ID', None)
        os.environ.pop('JOBADABRA_RESULT_FILE', None)

    def test_the_fixture_is_the_contract_both_sides_read(self):
        body = json.loads(FIXTURE.read_text())
        self.assertEqual(body['v'], 1)
        self.assertEqual(tuple(body), REQUIRED)

    def test_publish_writes_that_shape_with_the_runs_id(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'result.json'
            os.environ['JOBADABRA_RESULT_FILE'] = str(path)
            os.environ['JOBADABRA_RUN_ID'] = 'abc123def456'
            run_result.note_job({'page_id': 'page-1', 'url': 'https://www.notion.so/page1', 'title': 'SRE',
                                 'job_url': 'https://jobs.example/1', 'created': True})
            run_result.note_notion('https://www.notion.so/run1')
            run_result.note_mail('spend')
            written = run_result.publish({'run_id': 'abc123def456', 'warnings': ['1 feed failed']})
            self.assertEqual(written, json.loads(path.read_text()))
            self.assertEqual(tuple(written), REQUIRED)
            self.assertFalse(written['ok'])
            self.assertEqual(written['warnings'], [{'message': '1 feed failed'}])

    def test_a_run_row_carries_the_same_id(self):
        os.environ['JOBADABRA_RUN_ID'] = 'abc123def456'
        cron_runs._auto.clear()
        run = cron_runs.new_run('run')
        props, _ = cron_runs.run_page(run)
        self.assertEqual(props['Run id']['rich_text'][0]['text']['content'], 'abc123def456')

    def test_without_a_file_nothing_is_written(self):
        self.assertIsNone(run_result.publish({'run_id': 'abc', 'warnings': []}))


if __name__ == '__main__':
    unittest.main()
