"""The run history on the store (src/run_log.py): a run's row opens, shows progress and closes with today's title,
report, message, log and numbers on memory and SQLite; and on Notion the row is the one src/notion/cron_runs.log_run
writes today (every column it sets, the same page), for a jobs check and a Gmail check."""
import io
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from src import run_log, telegram
from src.notion import cron_report, cron_runs
from src.stores import base, memory, notion, notion_blocks, sqlite
from tests.test_cron_runs import sample_run
from tests.test_store_notion_blocks import runs as shown
from tests.test_store_notion_cron_runs import RunsNotion, mail_run

RUN_PAGE_COLUMNS = ('Run', 'Started', 'Duration (s)', 'Mode', 'Trigger', 'Status', 'AI cost (USD)', 'Tokens (total)', 'Billed to',
                    'Telegram', 'Summary', 'Feeds', 'Feed errors', 'New jobs', 'Changed jobs', 'Closed stale', 'Scored', 'Kits',
                    'Top new score', 'Emails', 'Updates', 'Application', 'Run URL', 'Run id', 'Kind', 'Where', 'Progress', 'Finished')
MESSAGE = '<b>3 new jobs</b>\nStaff SRE · Grafana Labs'


def value(prop):
    """A property's value as Notion shows it, whatever shape wrote it."""
    if not prop:
        return None
    kind = next(k for k in ('title', 'rich_text', 'select', 'date', 'number', 'url', 'relation', 'checkbox') if k in prop)
    raw = prop[kind]
    if kind in ('title', 'rich_text'):
        return notion_blocks.plain_text(raw) or None
    if kind in ('select', 'date'):
        return (raw or {}).get('name' if kind == 'select' else 'start')
    if kind == 'relation':
        return [r['id'] for r in raw or []] or None
    return raw


class Quiet(unittest.TestCase):
    def setUp(self):
        run_log._open.clear()
        run_log._auto.clear()   # a test that runs a logged command (--log-run) switches logging on for the whole process
        run_log._output.clear()
        run_log._last_step['at'] = 0.0
        for target, new in ((run_log, {'_install': lambda: None, '_heartbeat': lambda run: None, 'STEP_EVERY': 0}),):
            patcher = mock.patch.multiple(target, **new)
            patcher.start()
            self.addCleanup(patcher.stop)
        messages = mock.patch.object(telegram, 'MESSAGES', [MESSAGE])
        messages.start()
        self.addCleanup(messages.stop)
        self.addCleanup(run_log._open.clear)
        self.addCleanup(run_log._auto.clear)


class StoreRunTests(Quiet):
    def stores(self):
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, True)
        return [memory.open_store(), sqlite.open_store({'JOB_PILOTTO_DATA_DIR': str(folder)})]

    def test_a_run_opens_shows_progress_and_closes_with_todays_words_and_numbers(self):
        for stores in self.stores():
            run_log._open.clear()
            run = sample_run(run_id='r-42')
            out = io.StringIO()
            with redirect_stdout(out):
                named = run_log.begin(stores, run)
            self.assertEqual(out.getvalue().strip(), f'Cronjob run logged: {named}')
            entity, row_id = base.parse_ref(named)
            self.assertEqual((entity, stores.cron_runs.get(row_id)['status']), ('cron_runs', 'Running'))
            run_log._progress('Reading 40 feeds')
            run_log._output.extend(['line 1', 'line 2'])
            self.assertEqual(run_log.log_run(stores, run), named)
            row = stores.cron_runs.get(row_id)
            self.assertEqual((row['status'], row['title'], row['log_id'], row['progress']),
                             (cron_report.status(run), cron_report.title(run), 'r-42', ['Reading 40 feeds']))
            self.assertEqual(row['summary'], cron_report.report_lines(run)[0])
            self.assertTrue(row['report'].startswith('### Report'))
            self.assertIn('### Stages', row['report'])
            self.assertEqual(row['result'], '3 new jobs\nStaff SRE · Grafana Labs')
            self.assertIn('line 2', row['log'])
            self.assertEqual({k: row['stats'][k] for k in ('new_jobs', 'scored', 'feeds', 'duration_s', 'top_new_score')},
                             {'new_jobs': 3, 'scored': 2, 'feeds': 40, 'duration_s': 95, 'top_new_score': 88})
            self.assertAlmostEqual(row['stats']['ai_cost_usd'], 0.034)

    def test_a_run_that_sent_no_message_still_leaves_a_result_for_its_card(self):
        # 18 Oct 2026: a Find jobs run with nothing new had no Result block; Actions drew skeleton bars for it for ever.
        from src import telegram
        saved, telegram.MESSAGES = telegram.MESSAGES, []
        self.addCleanup(setattr, telegram, 'MESSAGES', saved)
        for stores in self.stores():
            run_log._open.clear()
            run = sample_run(run_id='r-quiet', new=0, changed=0)
            run_log.begin(stores, run)
            named = run_log.log_run(stores, run)
            row = stores.cron_runs.get(base.parse_ref(named)[1])
            self.assertTrue(row['result'].strip())
            self.assertIn('nothing new', row['result'])
        blocks = cron_report.extra_blocks([], [], {'mode': 'run', 'new': 0, 'changed': 0, 'feeds': 3})
        self.assertEqual(blocks[0]['heading_3']['rich_text'][0]['text']['content'], 'Result')

    def test_a_run_without_an_open_row_gets_a_whole_one_started_when_it_started(self):
        stores = memory.open_store()
        named = run_log.log_run(stores, sample_run())
        row = stores.cron_runs.get(base.parse_ref(named)[1])
        self.assertEqual((row['started_at'], row['status'], row['kind']), ('2026-09-26T08:00:05+00:00', cron_report.status(sample_run()), 'scheduled'))

    def test_a_row_deleted_during_the_run_is_written_again_and_a_failure_says_so(self):
        stores, run = memory.open_store(), sample_run()
        with redirect_stdout(io.StringIO()):
            first = base.parse_ref(run_log.begin(stores, run))[1]
        del stores.cron_runs.rows[first]
        named = run_log.log_run(stores, run, failed=True)
        row = stores.cron_runs.get(base.parse_ref(named)[1])
        self.assertNotEqual(row['id'], first)
        self.assertEqual(row['status'], 'Failed')


class CallerTests(Quiet):
    def test_the_scout_logs_its_run_on_this_macs_store(self):
        import os
        import sys
        from src import scout
        folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, folder, True)
        env = {'JOB_PILOTTO_STORE': 'sqlite', 'JOB_PILOTTO_DATA_DIR': str(folder)}
        from src import store
        with store.connect(folder / 'jobs.sqlite') as db:  # the scout's tables, as an install that ran it has them
            db.executescript(scout.TABLES)
        out = io.StringIO()
        with mock.patch.dict(os.environ, env), mock.patch.object(sys, 'argv', ['scout', '--log-run', '--db', str(folder / 'jobs.sqlite')]), \
                mock.patch.object(scout.notion.Tracker, 'from_env', return_value=None), \
                mock.patch.object(scout, 'run', return_value=({}, [])), mock.patch.object(scout, 'telegram_summary', return_value='No new feeds'), \
                mock.patch.object(scout.contribute, 'maybe_send'), mock.patch.object(scout, 'active_sources', return_value=[]), \
                mock.patch.object(scout.telegram, 'to_app'), redirect_stdout(out):
            os.environ.pop('NOTION_TOKEN', None)
            scout.main()
        [row] = sqlite.open_store(env).cron_runs.list()
        self.assertEqual((row['kind'], row['status'] != 'Running'), ('scout', True))
        self.assertIn(f"Cronjob run logged: {base.ref('cron_runs', row['id'])}", out.getvalue())


class OneLogTests(Quiet):
    def test_a_process_logs_through_run_log_or_cron_runs_never_both(self):
        stores, run = memory.open_store(), sample_run()
        cron_runs._open.update(id='old-row', run=run)
        self.addCleanup(cron_runs._open.clear)
        with self.assertRaises(run_log.BothLogs):
            run_log.begin(stores, run)
        with self.assertRaises(run_log.BothLogs):
            run_log.log_run(stores, run)
        cron_runs._open.clear()
        with redirect_stdout(io.StringIO()):
            run_log.begin(stores, run)
        with self.assertRaises(run_log.BothLogs):
            cron_runs.log_run(OldTracker(), run)
        with self.assertRaises(run_log.BothLogs), mock.patch.object(cron_runs, 'CRON_RUNS_DATABASE_ID', 'runs-db'):
            cron_runs.begin(OldTracker(), run)


class OldTracker:
    """What cron_runs.log_run writes to Notion today (one new row: properties and children)."""
    def __init__(self):
        self.created = []

    def _request(self, method, path, body=None):
        assert (method, path) == ('POST', 'pages'), (method, path)
        self.created.append(body)
        return {'id': 'old', 'url': 'https://notion.test/old'}


class NotionRowTests(Quiet):
    def test_a_notion_run_row_is_todays_for_a_jobs_check_and_a_gmail_check(self):
        for make in (sample_run, lambda **extra: {**mail_run(), **extra}):
            old = OldTracker()
            cron_runs._open.clear()
            cron_runs._output.clear()  # other tests' captured lines would be today's log toggle
            with mock.patch.object(cron_runs, 'CRON_RUNS_DATABASE_ID', 'runs-db'), redirect_stdout(io.StringIO()):
                cron_runs.log_run(old, make(run_id='r-7', application='app-1'))
            [today] = old.created
            fake = RunsNotion(have=RUN_PAGE_COLUMNS)
            stores = notion.open_store({'NOTION_CRON_RUNS_DB': 'runs-db', 'NOTION_TOKEN': 'x'}, tracker=fake)
            with redirect_stdout(io.StringIO()):
                named = run_log.log_run(stores, make(run_id='r-7', application='app-1'))
            [row] = fake.pages.values()
            self.assertEqual(named, stores.link(row['id']))
            for column, prop in today['properties'].items():
                self.assertEqual(value(row['properties'].get(column)), value(prop), f"{today['properties']['Mode']}: {column}")
            # run_log adds the Run details toggle (src/run_details.py) that the retired writer never had: everything else is today's page.
            kept = [b for b in fake.blocks[row['id']] if not (b['type'] == 'toggle' and b['toggle']['rich_text'][0]['text']['content'] == 'Run details')]
            self.assertEqual(shown(kept), shown(today['children']), str(today['properties']['Mode']))


def tearDownModule():
    """Nothing here leaves run logging switched on for the next test module (9 Oct 2026: the scout's --log-run test left
    run_log._auto set, so a later module's logged run opened a run_log row and cron_runs raised BothLogs, in one CI shard only)."""
    left = {name: dict(state) for name, state in (('_auto', run_log._auto), ('_open', run_log._open)) if state}
    run_log._auto.clear()
    run_log._open.clear()
    if left:
        raise AssertionError(f'run_log state left set by tests/test_run_log.py: {sorted(left)}')


if __name__ == '__main__':
    unittest.main()
