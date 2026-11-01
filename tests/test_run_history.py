"""⏱️ Search runs as the one run history: a row from start (Running) to end, with the result and the log."""
import io
import unittest
from contextlib import redirect_stdout
from unittest import mock

from src import run_log, telegram
from src.notion import cron_runs


class FakeTracker:
    def __init__(self):
        self.calls = []

    def _request(self, method, path, body=None):
        self.calls.append((method, path, body))
        return {'id': 'row-1', 'url': 'https://notion.so/row-1'} if method == 'POST' else {}


class RunHistoryTest(unittest.TestCase):
    def setUp(self):
        run_log._open.clear()   # one run log per process: a row another module left open would raise BothLogs here
        cron_runs._open.clear()
        cron_runs._auto.clear()
        cron_runs._output.clear()
        telegram.MESSAGES.clear()
        self.db = mock.patch.object(cron_runs, 'CRON_RUNS_DATABASE_ID', 'runs-db')
        self.db.start()

    def tearDown(self):
        self.db.stop()
        cron_runs._open.clear()
        cron_runs._auto.clear()

    def test_the_row_opens_as_running_and_the_end_fills_it_with_the_result_and_log(self):
        tracker = FakeTracker()
        cron_runs.auto_begin(tracker)
        with redirect_stdout(io.StringIO()) as out:
            run = cron_runs.new_run('insight')
            print('Reading the market')
            telegram.to_app('💡 <b>Skills</b>\nGo is in 40% of your matches &amp; rising')
            run['headline'] = 'Insight sent: Skills — Go is in 40% of your matches'
            url = cron_runs.log_run(tracker, run)
        self.assertEqual(url, 'https://notion.so/row-1')
        self.assertIn('Cronjob run logged: https://notion.so/row-1', out.getvalue())
        (method, path, body), *rest = tracker.calls
        self.assertEqual((method, path), ('POST', 'pages'))
        self.assertEqual(body['properties']['Status'], {'select': {'name': 'Running'}})
        self.assertNotIn('children', body)
        updates = [call for call in rest if call[0] == 'PATCH']
        props = next(b for m, p, b in updates if p == 'pages/row-1' and 'Status' in b['properties'])['properties']
        self.assertEqual(props['Status'], {'select': {'name': 'OK'}})
        self.assertTrue(props['Summary']['rich_text'][0]['text']['content'].startswith('Insight sent: Skills'))
        blocks = next(b for m, p, b in updates if p == 'blocks/row-1/children')['children']
        texts = [blk[blk['type']]['rich_text'][0]['text']['content'] for blk in blocks]
        self.assertIn('Result', texts)
        self.assertIn('Go is in 40% of your matches & rising', texts)  # plain text, entities decoded
        log = blocks[-1]
        self.assertEqual(log['type'], 'toggle')
        self.assertIn('Reading the market', log['toggle']['children'][0]['code']['rich_text'][0]['text']['content'])

    def test_a_job_that_ends_before_its_report_is_marked_failed_not_left_running(self):
        tracker = FakeTracker()
        cron_runs.auto_begin(tracker)
        with redirect_stdout(io.StringIO()):
            cron_runs.new_run('weekly')
            cron_runs._unfinished()
        status = [b['properties']['Status'] for m, p, b in tracker.calls if m == 'PATCH' and p == 'pages/row-1']
        self.assertEqual(status, [{'select': {'name': 'Failed'}}])

    def test_modes_that_never_log_open_no_row(self):
        tracker = FakeTracker()
        cron_runs.auto_begin(tracker)
        with redirect_stdout(io.StringIO()):
            cron_runs.new_run('more')
        self.assertEqual(tracker.calls, [])

    def test_progress_updates_the_summary_at_most_every_few_seconds(self):
        tracker = FakeTracker()
        cron_runs._open.update(tracker=tracker, id='row-1', url='u', run={'mode': 'scheduled'})
        cron_runs._last_step['at'] = 0.0
        cron_runs._progress('Scoring 12 new jobs')
        cron_runs._progress('Scoring 13 new jobs')  # too soon: skipped
        cron_runs._progress('Warning: x')
        self.assertEqual([b['properties']['Summary']['rich_text'][0]['text']['content'] for _, _, b in tracker.calls],
                         ['⏳ Scoring 12 new jobs'])

    def test_a_crash_never_becomes_the_running_step(self):
        # 7 Oct 2026 (Windows wander suite): the app was killed mid-run, Python died printing its traceback, and the row stayed
        # "Running" with "⏳ Traceback (most recent call last):" as its step in Recent activity.
        for line in ['Traceback (most recent call last):', 'KeyboardInterrupt', 'BrokenPipeError: [Errno 32] Broken pipe',
                     'requests.exceptions.ConnectionError: x', 'SystemExit: 1']:
            tracker = FakeTracker()
            cron_runs._open.update(tracker=tracker, id='row-1', url='u', run={'mode': 'scout'})
            cron_runs._last_step['at'] = 0.0
            cron_runs._progress(line)
            self.assertEqual(tracker.calls, [], line)
        cron_runs._progress('Scout: checking 7 employer(s)…')   # an ordinary step still goes in
        self.assertEqual(len(tracker.calls), 1)


if __name__ == '__main__':
    unittest.main()


class HeartbeatTests(unittest.TestCase):
    """7 Oct 2026: a running row is edited at least every HEARTBEAT_S, through quiet steps too, so the app can tell a lost run (desktop/lib/run-history.js)."""
    def test_an_open_row_gets_its_duration_until_the_run_is_completed(self):
        import threading
        import time
        from unittest import mock
        from src.notion import cron_runs
        calls = []
        tracker = mock.Mock(_request=lambda method, path, body: calls.append((method, path, body)))
        run = {'mode': 'run'}

        def beats():
            return [body for _, path, body in calls if path == 'pages/p1']

        # Why (1 Nov 2026, beta 41316938972 Mac unit shard, 6 shards at once): a fixed 0.3 s sleep saw one beat of a 0.05 s thread under load; the test waits for the
        # thread's state instead, and 10 s is only a hang guard.
        def until(done, cap_s=10.0):
            end = time.monotonic() + cap_s
            while not done() and time.monotonic() < end:
                time.sleep(0.01)
            return done()

        with mock.patch.object(cron_runs, 'HEARTBEAT_S', 0.05), mock.patch.dict(cron_runs._open, {'run': run, 'tracker': tracker, 'id': 'p1'}, clear=True):
            before = set(threading.enumerate())
            cron_runs._heartbeat(run)
            thread = next(item for item in threading.enumerate() if item not in before and item.name == 'run-row-heartbeat')
            self.assertTrue(until(lambda: len(beats()) >= 2), f'the open row got {len(beats())} beat(s), not 2')
            self.assertIn('Duration (s)', beats()[0]['properties'])
            cron_runs._open['run'] = None   # log_run completed the row
            thread.join(10)
            self.assertFalse(thread.is_alive(), 'a completed row is not touched again: its heartbeat must end')
