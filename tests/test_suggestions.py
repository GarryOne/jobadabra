"""Focus's Suggestions pool (src/suggestions.py; spec docs/superpowers/specs/2026-10-28-insights-with-actions-design.md, PR 1a):
each engine producer shows only when its evidence holds, every entry has an action, the person's answers hide it as decided
(Not now 14 days, Not true for that evidence), Up next keeps only what can't wait, and no producer here asks the AI."""
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from src import suggestions

NOW = datetime(2026, 10, 28, 9, 0, tzinfo=timezone.utc)   # a Wednesday
TODAY = NOW.date().isoformat()


def day(days_ago):
    return (NOW - timedelta(days=days_ago)).date().isoformat()


def row(rid, category, title, days_ago=0, **fields):
    return {'id': rid, 'day': day(days_ago), 'category': category, 'title': title, 'body': '', 'fields': fields,
            'created_at': f'{day(days_ago)}T07:00:00Z', 'link': ''}


def events(kind, count, days_ago=1, source='Gmail'):
    return [{'id': f'{kind}-{i}', 'kind': kind, 'at': f'{day(days_ago)}T10:00:00Z', 'source': source} for i in range(count)]


TUNE = {'ok': True, 'proposals': [
    {'id': 'exclude_title:title_exclude_keywords:\\bjunior\\b', 'kind': 'exclude_title', 'label': 'junior', 'dismissed': 9,
     'why': '"junior" is in 9 job titles you dismissed and in none you kept'},
    {'id': 'drop_place:abroad:Paris', 'kind': 'drop_place', 'label': 'Paris', 'dismissed': 12,
     'why': '12 place "Paris" jobs dismissed, none kept or applied to'}],
    'basis': {'jobs': 40, 'dismissed': 30, 'engaged': 8, 'interviews': 1, 'min_dismissed': 5}}


class TuneTests(unittest.TestCase):
    def test_a_supported_change_makes_a_strategy_entry_with_review(self):
        entry = suggestions.tune_entry(TUNE)
        self.assertEqual((entry['home'], entry['topic']), ('strategy', 'search'))
        self.assertEqual(entry['title'], '2 changes your results support')
        self.assertEqual(entry['actions'], [{'label': 'Review', 'do': 'tune'}])
        self.assertIn('drop Paris', entry['detail'])
        self.assertEqual(entry['evidence'], [p['why'] for p in TUNE['proposals']])

    def test_its_key_is_the_set_of_changes_not_their_counts(self):
        recount = {**TUNE, 'proposals': [{**p, 'dismissed': p['dismissed'] + 3} for p in reversed(TUNE['proposals'])]}
        self.assertEqual(suggestions.tune_entry(recount)['key'], suggestions.tune_entry(TUNE)['key'])

    def test_no_change_shows_nowhere(self):
        self.assertIsNone(suggestions.tune_entry({'ok': True, 'proposals': [], 'basis': {'jobs': 40}}))
        self.assertIsNone(suggestions.tune_entry({'ok': False, 'error': 'no store'}))


class AnalyzeNowTests(unittest.TestCase):
    last = [row('w1', 'Weekly report', 'Last week', days_ago=9)]

    def test_enough_new_applications_and_outcomes_since_the_last_analysis(self):
        found = events('Applied', 6, days_ago=3) + events('Rejected', 4, days_ago=2)
        entry = suggestions.analyze_entry(found, self.last, NOW)
        self.assertEqual(entry['actions'], [{'label': 'Analyze now', 'do': 'analyze'}])
        self.assertIn('10 new applications and outcomes', entry['detail'])
        self.assertEqual(entry['topic'], 'search')

    def test_one_short_of_the_threshold_shows_nothing(self):
        found = events('Applied', 6, days_ago=3) + events('Rejected', 3, days_ago=2)
        self.assertIsNone(suggestions.analyze_entry(found, self.last, NOW))

    def test_events_before_the_last_analysis_and_backfills_do_not_count(self):
        found = events('Applied', 20, days_ago=12) + events('Applied', 20, days_ago=2, source='Backfill') + events('Reply received', 1)
        self.assertIsNone(suggestions.analyze_entry(found, self.last, NOW))

    def test_replies_that_stopped_after_a_run_of_applications(self):
        found = events('Applied', suggestions.QUIET_APPLIED, days_ago=8) + events('Reply received', 2, days_ago=suggestions.QUIET_DAYS + 1)
        entry = suggestions.analyze_entry(found, [row('w1', 'Weekly report', 'Last week', days_ago=6)], NOW)
        self.assertIn('no replies', entry['detail'])

    def test_a_fresh_install_and_a_fresh_analysis_show_nothing(self):
        self.assertIsNone(suggestions.analyze_entry([], [], NOW))
        busy = events('Applied', 30, days_ago=0)
        self.assertIsNone(suggestions.analyze_entry(busy, [row('w0', 'Weekly report', 'Today', days_ago=0)], NOW))


class WeekTests(unittest.TestCase):
    def week(self, door=None, days_ago=2):
        data = json.dumps({'door': door, 'label': 'Find jobs now'}) if door else ''
        return row('w', 'Weekly report', '4 of your 5 replies came within 3 days of posting', days_ago=days_ago,
                   action='Apply within 3 days of posting', **({'data': data} if data else {}))

    def test_the_door_the_ai_picked_is_the_first_button_when_the_app_can_do_it(self):
        entry = suggestions.week_entry([self.week('find_jobs')], NOW, doors={'find_jobs'})
        self.assertEqual(entry['actions'], [{'label': 'Find jobs now', 'do': 'find_jobs'}, {'label': 'Read the week', 'do': 'read_week', 'link': ''}])
        self.assertEqual((entry['row_id'], entry['source']), ('w', 'Your week'))

    def test_a_door_the_app_cannot_do_now_or_an_unknown_one_leaves_read_the_week(self):
        for door, doors in (('prep', {'find_jobs'}), ('leave_agencies_out', {'find_jobs', 'leave_agencies_out'})):
            entry = suggestions.week_entry([self.week(door)], NOW, doors=doors)
            self.assertEqual(entry['actions'], [{'label': 'Read the week', 'do': 'read_week', 'link': ''}], door)

    def test_only_this_weeks_report(self):
        self.assertIsNone(suggestions.week_entry([self.week('find_jobs', days_ago=8)], NOW, doors={'find_jobs'}))


class InsightTests(unittest.TestCase):
    def test_todays_insight_is_the_strongest_entry(self):
        daily = row('d', 'Skills', 'Missing ML tools in profile', days_ago=0, action='Add scikit-learn to profile')
        pool = suggestions.pool(insights=[daily], tune={'ok': True, 'proposals': TUNE['proposals']}, events=[], now=NOW, doors=set())
        self.assertEqual([entry['kind'] for entry in pool], ['insight', 'tune'])

    def test_an_issue_detected_wins_over_a_newer_daily_insight(self):
        found = [row('d', 'Skills', 'Newer', days_ago=0), row('i', 'Process', 'Issue', days_ago=1, issue_detected=True)]
        self.assertEqual(suggestions.insight_entry(found, NOW)['row_id'], 'i')


class AnswerTests(unittest.TestCase):
    def setUp(self):
        self.entry = suggestions.tune_entry(TUNE)

    def answer(self, state, until='', key=None):
        return row('a', suggestions.ANSWER_CATEGORY, 'x', state=state, input_hash=key or self.entry['key'],
                   **({'hidden_until': until} if until else {}))

    def test_not_now_hides_for_14_days_then_shows_again(self):
        until = suggestions.hidden_until(NOW)
        self.assertEqual(until, (NOW + timedelta(days=14)).date().isoformat())
        self.assertEqual(suggestions.answered([self.entry], [self.answer('Not now', until)], NOW), [])
        later = NOW + timedelta(days=15)
        self.assertEqual(suggestions.answered([self.entry], [self.answer('Not now', until)], later), [self.entry])

    def test_not_true_hides_this_evidence_for_good_but_new_evidence_shows(self):
        self.assertEqual(suggestions.answered([self.entry], [self.answer('Not true')], NOW + timedelta(days=400)), [])
        self.assertEqual(suggestions.answered([self.entry], [self.answer('Not true', key='tune:other')], NOW), [self.entry])

    def test_a_finding_carries_its_own_answer(self):
        daily = row('d', 'Skills', 'Missing ML tools', days_ago=0, state='Done')
        entry = suggestions.insight_entry([daily], NOW)
        self.assertEqual(entry['row_id'], 'd')
        self.assertEqual(suggestions.answered([entry], [daily], NOW), [])


class FindingTests(unittest.TestCase):
    def test_only_the_daily_insight_and_weekly_report_are_findings(self):
        self.assertTrue(suggestions.is_finding(row('d', 'Skills', 'x')))
        self.assertTrue(suggestions.is_finding(row('w', 'Weekly report', 'x')))
        for category in (suggestions.ANSWER_CATEGORY, 'Interview patterns'):
            self.assertFalse(suggestions.is_finding(row('a', category, 'x')), category)

    def test_an_answer_saved_today_is_not_todays_insight(self):
        """The class trap: readers that excluded only Interview patterns took any other row for the daily insight (sent_today
        would have skipped the day's insight after a Not now on Tune)."""
        from datetime import date
        from src.ai import insights_data
        from src.stores import memory
        stores = memory.open_store()
        stores.insights.add({'day': TODAY, 'category': suggestions.ANSWER_CATEGORY, 'title': 'Tune', 'fields': {'state': 'Not now'}})
        self.assertFalse(insights_data.sent_today(stores, date.fromisoformat(TODAY)))
        self.assertEqual(insights_data.recent_insights(stores, date.fromisoformat(TODAY)), [])


class UpNextTests(unittest.TestCase):
    def test_up_next_keeps_only_what_cant_wait(self):
        self.assertEqual(suggestions.UP_NEXT, {'offer', 'book', 'reply', 'prepare', 'follow_up'})
        for kind in ('happened', 'review', 'which_job', 'details', 'feedback', 'feedback_wait', 'feedback_review', 'nudge', 'apply'):
            self.assertEqual(suggestions.place(kind), 'suggestions', kind)
        self.assertIsNone(suggestions.place('waiting'), 'no button: it leaves Focus')
        self.assertEqual(suggestions.place('reply'), 'up_next')


class EveryEntryTests(unittest.TestCase):
    def test_every_engine_entry_has_an_action_evidence_home_and_topic_and_no_ai_is_asked(self):
        """Criteria 1 and 7: the class, over every producer here; a client that throws proves no AI call."""
        weekly = row('w', 'Weekly report', 'Your week', days_ago=1, data=json.dumps({'door': 'find_jobs', 'label': 'Find jobs now'}))
        daily = row('d', 'Skills', 'Missing ML tools', days_ago=0, action='Add scikit-learn')
        rejected = {'id': 'app1', 'url': 'https://jobs.example/1', 'title': 'SRE', 'company': 'Acme', 'stage': 'Rejected',
                    'rejection': 'After interview', 'rejection_lesson': 'Practise system design. Then apply again.',
                    'updated_at': f'{TODAY}T08:00:00Z', 'link': ''}
        with mock.patch('src.ai.engine.client', side_effect=AssertionError('no AI call in Suggestions')):
            entries = [suggestions.insight_entry([daily], NOW), suggestions.rejection_entry([rejected], NOW),
                       suggestions.week_entry([weekly], NOW, doors={'find_jobs'}), suggestions.tune_entry(TUNE),
                       suggestions.analyze_entry(events('Applied', 12, days_ago=3), [row('w9', 'Weekly report', 'x', days_ago=9)], NOW)]
            from src import suggestions_search
            from tests.test_suggestions_search import IDEAS, VERDICT
            entries += suggestions_search.entries(VERDICT, IDEAS, 'ideas:k')   # Strategy's search rows (PR 1b)
            from src import suggestions_pay
            from tests.test_suggestions_pay import job
            entries.append(suggestions_pay.entry(suggestions_pay.held_back([job(n) for n in range(3)])))   # the pay row (PR 3)
        self.assertEqual({entry['kind'] for entry in entries}, set(suggestions.PRODUCERS), 'every producer is in this test')
        for entry in entries:
            self.assertTrue(entry['actions'] and all(a['label'] and a['do'] for a in entry['actions']), entry['kind'])
            self.assertTrue(entry['title'] and entry['key'], entry['kind'])
            self.assertIn(entry['home'], suggestions.HOMES, entry['kind'])
            self.assertIn(entry['topic'], suggestions.TOPICS, entry['kind'])


if __name__ == '__main__':
    unittest.main()
