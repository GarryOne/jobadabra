"""Interview insights: refresh locking, ticked steps, neighbouring rows and the daily run hook, the effort setting.
See also test_interview_insights.py."""
from datetime import date
import io
import json
from pathlib import Path
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import interview_insights as ii
from src.stores import open_stores
from src.ai import insights, interviews
from tests.model_stand_ins import rounds as setUpModule  # noqa: F401 (the model's answer)
from tests.interview_insights_fakes import NOW, text, select, interview, FakeNotion, FakeClient, ONE, PAGES, RESULT, env, of, recs


class TakeTurns(unittest.TestCase):
    """14:09 on 30 Sep 2026: two refreshes on this Mac (the app and the terminal) both saw an old insight and both paid
    Opus. They now take turns (a lock per data folder); the second then finds it current and makes no AI call."""

    def test_a_second_refresh_waits_for_the_first(self):
        import tempfile
        import threading
        from src import paths
        with tempfile.TemporaryDirectory() as folder:
            waited, order = [], []
            with paths.run_lock(folder, name='insights'):
                other = threading.Thread(target=lambda: self._second(paths, folder, waited, order))
                other.start()
                other.join(0.3)
                order.append('first done')
            other.join(2)
            self.assertEqual(waited, ['waiting'])
            self.assertEqual(order, ['first done', 'second ran'])
            self.assertTrue((__import__('pathlib').Path(folder) / 'insights.lock').exists())
            self.assertFalse((__import__('pathlib').Path(folder) / 'run.lock').exists())  # never blocks a jobs search

    @staticmethod
    def _second(paths, folder, waited, order):
        with paths.run_lock(folder, name='insights', on_wait=lambda: waited.append('waiting'), poll=0.05):
            order.append('second ran')

    def test_update_runs_under_the_insights_lock(self):
        import inspect
        self.assertIn("run_lock(name='insights'", inspect.getsource(ii.update))


class Ticks(unittest.TestCase):
    """The "Practice next" tick boxes: saved in the insight row's Data (Notion is the one copy), kept across a Refresh only
    for a step whose words are still there."""
    STEP = 'Practise a Postgres failover story with RTO numbers'

    def setUp(self):
        self.fake = FakeNotion(list(ONE), PAGES)
        self.client = FakeClient(RESULT)
        a, b = env()
        self.enter = (a, b)
        a.start(), b.start()
        self.addCleanup(a.stop), self.addCleanup(b.stop)
        ii.update(stores=open_stores(tracker=self.fake), client=self.client, now=NOW, budget_status=lambda t: {'level': 'ok'})

    def data(self):
        return json.loads(''.join(t['plain_text'] for t in self.fake.insights[0]['properties']['Data']['rich_text']))

    def test_a_step_key_ignores_case_spacing_and_punctuation(self):
        self.assertEqual(ii.step_key('  Practise a Postgres failover story, with RTO numbers! '), ii.step_key(self.STEP.lower()))

    def test_ticking_a_step_saves_it_in_the_row_and_saved_reads_it_back(self):
        out = ii.set_step_done(of(self.fake), self.STEP, True)
        self.assertEqual(out['done_steps'], [ii.step_key(self.STEP)])
        self.assertEqual(self.data()['done_steps'], [ii.step_key(self.STEP)])
        self.assertEqual(self.data()['patterns'][0]['interviews'], ['iv-1'])  # the rest of the row is untouched
        self.assertEqual(ii.saved(of(self.fake))['done_steps'], [ii.step_key(self.STEP)])
        ii.set_step_done(of(self.fake), self.STEP, False)
        self.assertEqual(self.data()['done_steps'], [])

    def test_saved_marks_each_step_done_or_not_for_the_window(self):
        self.assertEqual([step['done'] for step in ii.saved(of(self.fake))['next_steps']], [False])
        ii.set_step_done(of(self.fake), self.STEP, True)
        self.assertEqual([step['done'] for step in ii.saved(of(self.fake))['next_steps']], [True])

    def test_ticking_twice_keeps_one_entry_and_an_unknown_step_is_refused(self):
        ii.set_step_done(of(self.fake), self.STEP, True)
        ii.set_step_done(of(self.fake), self.STEP, True)
        self.assertEqual(len(self.data()['done_steps']), 1)
        with self.assertRaisesRegex(ValueError, 'not a step'):
            ii.set_step_done(of(self.fake), 'Something that is not there', True)

    def test_a_refresh_keeps_the_ticks_of_steps_that_are_still_there_and_drops_the_rest(self):
        ii.set_step_done(of(self.fake), self.STEP, True)
        self.fake.rows.append(interview('iv-2', 'Technical 2', 'negative', '2026-09-25'))
        again = dict(RESULT, next_steps=[RESULT['next_steps'][0], {'action': 'A brand new step', 'interviews': ['I1']}])
        ii.update(stores=open_stores(tracker=self.fake), client=FakeClient(again), now=NOW, budget_status=lambda t: {'level': 'ok'})
        self.assertEqual(self.data()['done_steps'], [ii.step_key(self.STEP)])
        gone = dict(RESULT, next_steps=[{'action': 'Only this now', 'interviews': ['I1']}])
        self.fake.rows.append(interview('iv-3', 'Screen', 'positive', '2026-09-26'))
        ii.update(stores=open_stores(tracker=self.fake), client=FakeClient(gone), now=NOW, budget_status=lambda t: {'level': 'ok'})
        self.assertEqual(self.data()['done_steps'], [])


class Neighbours(unittest.TestCase):
    def test_the_daily_insight_is_not_blocked_by_the_interview_patterns_row(self):
        from src.ai import insights_data
        from src.stores import memory
        stores = memory.open_store()
        stores.insights.add({'day': '2026-09-30', 'category': 'Interview patterns', 'title': 'patterns'})
        self.assertFalse(insights_data.sent_today(stores, date(2026, 9, 30)))
        stores.insights.add({'day': '2026-09-30', 'category': 'Skills', 'title': 'daily'})
        self.assertTrue(insights_data.sent_today(stores, date(2026, 9, 30)))

    def test_focus_does_not_show_it_as_the_page_insight(self):
        from src import focus
        patterns = {'id': 'p', 'url': '', 'created_time': '2026-09-30T10:00:00Z', 'properties': {
            'Insight': {'type': 'title', 'title': [{'plain_text': 'Interview patterns headline'}]},
            'Category': select('Interview patterns'), 'Date': {'type': 'date', 'date': {'start': '2026-09-30'}}}}
        built = focus.build([], [], [], now=NOW, insights=[patterns])
        self.assertEqual(built['suggestions'], [])

    def test_a_review_run_updates_the_insights_and_counts_their_cost(self):
        from src import daily, daily_modes
        from tests.interviews_fixtures import FakeTracker
        argv = ['daily', '--mode', 'interview', '--interview', 'iv-1']
        env_ = {k: v for k, v in daily.os.environ.items() if k not in ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID')}

        def after(stats=None, stores=None):
            stats.update(usd=0.04, pending=1, done=1)
            return 'Interview insights updated'
        with mock.patch.object(sys, 'argv', argv), mock.patch.dict(daily.os.environ, env_, clear=True), \
                mock.patch.object(daily.telegram, 'keychain_token', return_value=None), \
                mock.patch.object(daily.notion.Tracker, 'from_env', return_value=FakeTracker([])), \
                mock.patch.object(daily_modes, 'log_ai_run') as logged, \
                mock.patch.object(daily.interviews, 'run', return_value='Interview analysed (x) https://n.test/1'), \
                mock.patch.object(daily.interview_insights, 'after_review', side_effect=after) as hook, \
                mock.patch('sys.stdout', io.StringIO()):
            self.assertEqual(daily.main(), 0)
        hook.assert_called_once()
        self.assertEqual(logged.call_args.args[1]['insight']['usd'], 0.04)

    def test_a_workspace_without_the_interview_patterns_option_yet_reads_no_row_not_an_error(self):
        # Owner, 30 Sep 2026: the app ran the new code before its schema repair added the option; Notion answers a
        # select filter on an option it doesn't know with 400. That is "no row yet", and the rows are read unfiltered.
        import urllib.error

        class Missing(FakeNotion):
            def query_database(self, database_id, filter_=None):
                if database_id == 'insights-db' and filter_:
                    raise urllib.error.HTTPError('https://api.notion.com/v1/databases/x/query', 400, 'Bad Request', {}, None)
                return super().query_database(database_id, filter_)
        fake = Missing(list(ONE), PAGES)
        a, b = env()
        with a, b:
            self.assertIsNone(ii.saved(of(fake)))
            fake.insights.append({'id': 'daily', 'url': '', 'last_edited_time': NOW.isoformat(),
                                  'properties': {'Category': select('Skills')}})
            self.assertIsNone(ii.existing(of(fake)))
            fake.insights.append({'id': 'ins-9', 'url': '', 'last_edited_time': NOW.isoformat(),
                                  'properties': {'Category': select('Interview patterns'), 'Insight': text('h')}})
            self.assertEqual(ii.existing(of(fake))['id'], 'ins-9')

    def test_an_unreadable_insight_is_reported_with_the_list_never_instead_of_it(self):
        problems = []
        with mock.patch.object(ii, 'saved', side_effect=RuntimeError('HTTP Error 400: Bad Request')):
            self.assertIsNone(interviews.saved_insight(object(), problems))
        self.assertEqual(problems, ['RuntimeError: HTTP Error 400: Bad Request'])
        with mock.patch.object(interviews, 'open_for_commands', return_value=(object(), None)), \
                mock.patch.object(interviews, 'listing', return_value=[{'id': 'iv-1'}]), \
                mock.patch.object(ii, 'saved', side_effect=RuntimeError('HTTP Error 400: Bad Request')), \
                mock.patch.object(interviews, 'INTERVIEWS_DATABASE_ID', 'interviews-db'), \
                mock.patch('sys.stdout', new_callable=io.StringIO) as out, mock.patch('sys.stderr', io.StringIO()):
            code = interviews.main(['list'])
        shown = json.loads(out.getvalue().strip().splitlines()[-1])
        self.assertEqual(code, 0)
        self.assertEqual(shown['interviews'], [{'id': 'iv-1'}])
        self.assertIsNone(shown['insight'])
        self.assertIn('400', shown['insight_error'])

    def test_the_interviews_list_carries_the_insight(self):
        with mock.patch.object(ii, 'saved', side_effect=RuntimeError('Notion down')):
            self.assertIsNone(interviews.saved_insight(object()))
        with mock.patch.object(ii, 'saved', return_value={'headline': 'h'}):
            self.assertEqual(interviews.saved_insight(object()), {'headline': 'h'})


class EffortTests(unittest.TestCase):
    def test_haiku_is_not_sent_an_effort_and_others_are(self):
        for model, expected in (('claude-haiku-4-5', None), ('claude-sonnet-5-5', 'medium')):
            client = FakeClient(RESULT)
            ii.generate(client, model, [])
            self.assertEqual(client.calls[0]['output_config'].get('effort'), expected, model)


class OwnStepName(unittest.TestCase):
    """27 Oct 2026 (owner): the patterns call is its own AI step, so the Pro lane can route it apart from the call review ('interview')."""

    def test_the_default_client_is_asked_for_interview_patterns(self):
        a, b = env()
        a.start(), b.start()
        self.addCleanup(a.stop), self.addCleanup(b.stop)
        with mock.patch('src.ai.engine.client', return_value=FakeClient(RESULT)) as made:
            ii.update(stores=open_stores(tracker=FakeNotion(list(ONE), PAGES)), now=NOW, budget_status=lambda t: {'level': 'ok'})
        made.assert_called_once_with(action='interview_patterns')


if __name__ == '__main__':
    unittest.main()
