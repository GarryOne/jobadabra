import io
import json
import sqlite3
import sys
import unittest
from argparse import Namespace
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import doctor
from src.ai import budget
from src.stores import memory, notion

NOW = datetime(2026, 9, 27, 14, 0, tzinfo=timezone.utc)


class FakeTracker:
    def __init__(self, rows):
        self.rows, self.filters = rows, []

    def query_database(self, database_id, filter_=None):
        self.filters.append(filter_)
        return self.rows


def run_history(*runs):
    """A store whose run history holds these runs: (usd, started_at[, feeds, feed_errors])."""
    stores = memory.open_store()
    for usd, started, *feeds in runs:
        stats = {'ai_cost_usd': usd, **({'feeds': feeds[0], 'feed_errors': feeds[1]} if feeds else {})}
        stores.cron_runs.put({'kind': 'search', 'where': 'mac', 'status': 'Done', 'started_at': started, 'stats': stats})
    return stores


class BudgetTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(budget, 'admin_key', return_value=None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_levels_from_the_run_log(self):
        with mock.patch.dict('os.environ', {'JOB_PILOTTO_MONTHLY_BUDGET_USD': '15'}):
            ok = budget.status(run_history((3.0, '2026-09-20T10:00:00+00:00'), (2.0, '2026-09-21T10:00:00+00:00')), NOW)
            warn = budget.status(run_history((11.0, '2026-09-20T10:00:00+00:00')), NOW)
            pause = budget.status(run_history((14.0, '2026-09-20T10:00:00+00:00')), NOW)
        self.assertEqual((ok['spent'], ok['level'], ok['source']), (5.0, 'ok', 'Jobadabra log'))
        self.assertEqual((warn['level'], pause['level']), ('warn', 'pause'))

    def test_only_this_months_runs_count(self):
        stores = run_history((4.0, '2026-08-31T23:00:00+00:00'), (1.5, '2026-09-01T00:30:00+00:00'))
        self.assertEqual(budget.ledger_spend(stores, NOW), 1.5)

    def test_on_notion_only_this_months_search_runs_are_asked_for(self):
        tracker = FakeTracker([])
        budget.ledger_spend(notion.open_store({'NOTION_TOKEN': 't'}, tracker=tracker), NOW)
        self.assertEqual(tracker.filters[0], {'property': 'Started', 'date': {'on_or_after': '2026-09-01'}})

    def test_admin_cost_report_is_summed_in_cents_across_pages(self):
        pages = iter([{'data': [{'results': [{'amount': '512.5', 'currency': 'USD'}]}], 'has_more': True, 'next_page': 'p2'},
                      {'data': [{'results': [{'amount': '489.5'}, {'amount': '0'}]}], 'has_more': False}])
        seen = []
        def opener(request, timeout=None):
            seen.append(request.full_url)
            return io.BytesIO(json.dumps(next(pages)).encode())
        self.assertAlmostEqual(budget.admin_spend('sk-ant-admin-x', NOW, opener), 10.02)
        self.assertIn('starting_at=2026-09-01T00%3A00%3A00Z', seen[0])
        self.assertIn('page=p2', seen[1])

    def test_pause_caps_optional_ai_and_alerts_once_per_month_and_level(self):
        args = Namespace(auto_kit_max=5, score_max=60, enrich_max=100)
        warnings = []
        info = {'spent': 13.8, 'budget': 15.0, 'pct': 0.92, 'level': 'pause', 'source': 'Jobadabra log'}
        self.assertTrue(budget.apply_caps(args, info, warnings))
        self.assertEqual((args.auto_kit_max, args.score_max, args.enrich_max), (0, 10, 30))
        db, sent = sqlite3.connect(':memory:'), []
        self.assertTrue(budget.alert_once(db, info, sent.append, NOW))
        self.assertFalse(budget.alert_once(db, info, sent.append, NOW))
        self.assertEqual(len(sent), 1)
        self.assertIn('92% used', sent[0])
        self.assertFalse(budget.apply_caps(Namespace(auto_kit_max=5, score_max=60, enrich_max=100),
                                           dict(info, level='warn'), []))


class HealthTests(unittest.TestCase):
    def test_google_expired_and_expiring(self):
        expired = mock.Mock(scopes=None, profile=mock.Mock(side_effect=RuntimeError('Google token refresh failed (400): invalid_grant')))
        with mock.patch('src.sources.google.Google.from_env', return_value=expired):
            check = doctor.check_google(NOW)
        self.assertEqual((check.state, check.detail), (doctor.FAIL, 'sign-in expired or revoked'))
        self.assertIn('--client-json', check.fix)
        ok = mock.Mock(scopes=None, profile=mock.Mock(return_value={'emailAddress': 'me@gmail.com'}))
        with mock.patch('src.sources.google.Google.from_env', return_value=ok), \
                mock.patch.dict('os.environ', {'JOB_PILOTTO_GOOGLE_AUTH_AT': '2026-09-22T12:00:00+00:00'}):
            check = doctor.check_google(NOW)
        self.assertEqual(check.state, doctor.WARN)
        self.assertIn('expires in about 2 day(s)', check.detail)

    def test_mail_workflow_states(self):
        connected = mock.patch('src.sources.google.Google.from_env', return_value=mock.Mock())
        connected.start()
        self.addCleanup(connected.stop)
        with mock.patch.object(doctor, 'gh', return_value=[{'status': 'completed', 'conclusion': 'failure',
                                                          'createdAt': '2026-09-27T12:00:00Z', 'event': 'schedule'}]):
            self.assertEqual(doctor.check_mail_workflow(NOW).state, doctor.FAIL)
        with mock.patch.object(doctor, 'gh', return_value=[{'status': 'completed', 'conclusion': 'success',
                                                          'createdAt': '2026-09-27T10:00:00Z', 'event': 'schedule'}]):
            self.assertEqual(doctor.check_mail_workflow(NOW).state, doctor.OK)
        connected.stop()
        with mock.patch('src.sources.google.Google.from_env', return_value=None):
            self.assertEqual(doctor.check_mail_workflow(NOW).state, doctor.INFO)  # not connected: nothing to judge

    def test_feeds_failing_in_the_last_crawl(self):
        stores = run_history((0.1, '2026-09-26T10:00:00+00:00', 29, 0), (0.1, '2026-09-27T10:00:00+00:00', 29, 29), (0.1, '2026-09-27T12:00:00+00:00'))
        check = doctor.check_feeds(stores)   # the newest run that read feeds; a run without feeds (a Gmail check) is passed over
        self.assertEqual((check.state, check.detail), (doctor.FAIL, '29 of 29 feeds failed in the last crawl'))

    def test_alert_sends_one_line_only_when_something_is_wrong(self):
        bad = doctor.Check('Health', 'Gmail + Calendar', doctor.FAIL, 'sign-in expired or revoked', 'Sign in again')
        good = doctor.Check('Health', 'Feeds', doctor.OK, 'all 29 feeds answered')
        sent = []
        with mock.patch.object(doctor, 'health_checks', return_value=[bad, good]):
            doctor.alert(None, sent.append, NOW)
        self.assertEqual(len(sent), 1)
        self.assertIn('<b>Gmail + Calendar · Failed</b>\nsign-in expired or revoked\n<b>Next step:</b> Sign in again', sent[0])
        sent.clear()
        with mock.patch.object(doctor, 'health_checks', return_value=[good]):
            self.assertEqual(doctor.alert(None, sent.append, NOW), 'Health: all good')
        self.assertEqual(sent, [])


if __name__ == '__main__':
    unittest.main()
