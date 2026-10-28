import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import insights, insights_data
from src.stores import open_stores
from src.stores import memory, notion_blocks
from src.notion import ledger

NOW = datetime(2026, 9, 26, 5, 0, tzinfo=timezone.utc)
PROFILE = 'SRE with Kubernetes, AWS (Amazon Web Services), Terraform, Datadog and Python.'


def facts(techs, language=None, salary='', seniority='senior', family='sre'):
    return {'technologies': techs, 'languages': [{'language': language, 'level': 'required', 'evidence': ''}] if language else [],
            'english_is_enough': {'value': 'yes', 'evidence': ''}, 'seniority': {'value': seniority, 'evidence': ''},
            'work_mode': {'value': 'hybrid', 'remote_scope': '', 'evidence': ''}, 'salary': {'stated': bool(salary), 'text': salary},
            'employer_type': {'value': 'direct_employer', 'evidence': ''}, 'role_family': family}


def fit(score, gaps=()):
    return {'score': score, 'gaps': list(gaps), 'components': {'role_fit': score, 'location': 80, 'compensation': 40,
                                                               'growth': 70, 'risk': 30}}


JOBS = [
    {'id': 1, 'title': 'SRE', 'company': 'A', 'location': 'Zürich', 'city': 'Zürich', 'first_seen_at': '2026-09-25T00:00:00+00:00'},
    {'id': 2, 'title': 'Platform Engineer', 'company': 'B', 'location': 'Berlin', 'city': '', 'first_seen_at': '2026-09-01T00:00:00+00:00'},
    {'id': 3, 'title': 'DevOps', 'company': 'C', 'location': 'Bern', 'city': 'Bern', 'first_seen_at': '2026-09-24T00:00:00+00:00'},
    {'id': 4, 'title': 'SRE', 'company': 'D', 'location': 'London', 'city': '', 'first_seen_at': '2026-09-20T00:00:00+00:00'},
]
FACTS = {1: facts(['Kubernetes', 'Prometheus', 'AWS']), 2: facts(['k8s', 'Prometheus', 'Go'], salary='EUR 90k'),
         3: facts(['Ansible'], language='German'), 4: facts(['Prometheus', 'GCP'])}
FITS = {1: fit(75, ['no Prometheus shown']), 2: fit(62), 4: fit(50, ['GCP depth'])}


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def app_row(page_id, stage, applied, **extra):
    props = {'Stage': {'type': 'select', 'select': {'name': stage}},
             'Applied on': {'type': 'date', 'date': {'start': applied}}, 'Location': text(extra.get('location', 'Zürich')),
             'Seniority': {'type': 'select', 'select': {'name': extra.get('seniority', 'Senior')}},
             'Fit score': {'type': 'number', 'number': extra.get('score')},
             'Days to apply': {'type': 'number', 'number': extra.get('days')},
             'Cover letter': {'type': 'checkbox', 'checkbox': True}}
    return {'id': page_id, 'properties': props}


class FakeTracker:
    database_id = 'apps'

    def __init__(self, apps=(), events=(), past=()):
        self.apps, self.events, self.past, self.created = list(apps), list(events), list(past), []

    def query_database(self, database_id, filter_=None):
        if filter_ and 'date' in filter_:
            return [r for r in self.past if r['properties']['Date']['date']['start'] == filter_['date']['equals']]
        if database_id == ledger.EVENTS_DATABASE_ID:
            return self.events
        if database_id == insights.INSIGHTS_DATABASE_ID:
            if filter_ and 'date' in filter_:
                return [r for r in self.past if r['properties']['Date']['date']['start'] == filter_['date']['equals']]
            return self.past
        return self.apps

    def page_text(self, page_id=None):
        return PROFILE

    def _children(self, page_id):  # the Profile page, as the notion store's texts read it
        return [{'type': 'paragraph', 'paragraph': {'rich_text': [{'plain_text': PROFILE}]}}] if page_id == 'profile-page' else []

    def create_page(self, database_id, properties):
        self.created.append((database_id, properties))
        return {'id': '4c79aec0-91df-4dcc-8a88-27cd4d43a5ef'}

    def _request(self, method, path, body):
        self.created.append((body['parent']['database_id'], body['properties'], body.get('children')))
        return {'id': '4c79aec0-91df-4dcc-8a88-27cd4d43a5ef', 'url': 'https://notion.test/weekly'}


INSIGHT = {'skip': False, 'category': 'Skills', 'headline': 'Prometheus is in 3/3 of your eligible jobs & not on your CV',
           'evidence': ['Prometheus: 3/3 eligible jobs (100%)', 'Kubernetes: 2/3 (67%)'],
           'action': 'Add Prometheus work to the CV if you have it; otherwise a 2-week project.',
           'confidence': 'medium', 'basis': 'Market', 'sample_size': 3}


class FakeClient:
    def __init__(self, answer=INSIGHT):
        self.calls, self.messages = [], self
        self.answer = answer

    def create(self, **params):
        self.calls.append(params)
        return SimpleNamespace(stop_reason='end_turn', content=[SimpleNamespace(type='text', text=json.dumps(self.answer))],
                               usage=SimpleNamespace(input_tokens=6000, output_tokens=400, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


def patched():
    return mock.patch.multiple('src.ai.insights', store=mock.Mock(digest_jobs=lambda db, limit: [dict(j) for j in JOBS]),
                               enrich=mock.Mock(load=lambda db: FACTS), score=mock.Mock(load=lambda db: FITS))


class MarketTests(unittest.TestCase):
    def test_technology_demand_is_normalized_and_checked_against_the_profile(self):
        with patched():
            stats = insights.market_stats(None, PROFILE, NOW)
        self.assertEqual((stats['open_jobs'], stats['eligible'], stats['language_blocked']), (4, 3, 1))
        techs = {row['tech']: row for row in stats['technologies_in_eligible_jobs']}
        self.assertEqual(techs['prometheus']['jobs'], '3/3 (100%)')
        self.assertFalse(techs['prometheus']['in_profile'])
        self.assertEqual(techs['kubernetes']['jobs'], '2/3 (67%)')  # k8s counted as kubernetes
        self.assertTrue(techs['kubernetes']['in_profile'])
        self.assertTrue(techs['aws']['in_profile'])
        self.assertEqual(stats['good_fit (score>=60)'], 2)
        self.assertEqual(stats['by_region']['Your country']['language_blocked'], 1)
        self.assertEqual(stats['new_last_7_days'], 3)
        self.assertEqual(stats['salary_stated'], '1/3 (33%)')
        self.assertEqual(stats['fit_components_avg_near_miss']['compensation'], 40)

    def test_in_profile_uses_word_boundaries_and_aliases(self):
        self.assertTrue(insights.in_profile('aws', 'amazon web services certified'))
        self.assertFalse(insights.in_profile('go', 'google cloud'))
        self.assertTrue(insights.in_profile('go', 'python, go, rust'))


def memory_store(apps=(), events=(), insights_=()):
    """A memory store holding these applications ({ref, stage, applied_on, …}), events ({ref, kind, at, …}) and insights."""
    found = memory.open_store()
    ids = {}
    for app in apps:
        ref, job = app['ref'], {k: v for k, v in app.items() if k not in ('ref', 'stage')}
        ids[ref] = found.applications.create({'url': f'https://x.test/{ref}', **job}, app['stage'])['id']
    for event in events:
        found.events.add(ids.get(event.get('ref'), ''), event['kind'], event.get('at', ''),
                         **{k: v for k, v in event.items() if k not in ('ref', 'kind', 'at')})
    for insight in insights_:
        found.insights.add(insight)
    return found


def app(ref, stage, applied, **extra):
    return {'ref': ref, 'stage': stage, 'applied_on': applied, 'location': extra.get('location', 'Zürich'),
            'seniority': extra.get('seniority', 'Senior'), 'fit': extra.get('score', ''), 'days_to_apply': extra.get('days', ''),
            'cover_letter': True, **({'channel': extra['channel']} if 'channel' in extra else {})}


class ApplicationTests(unittest.TestCase):
    def test_outcomes_and_small_groups(self):
        stores = memory_store([app('p1', 'Applied', '2026-09-24', score=80, days=2),
                               app('p2', 'Rejected', '2026-09-01', location='Berlin', score=55, days=10),
                               app('p3', 'Applied', '2026-09-10')], [{'ref': 'p3', 'kind': 'Screening'}])
        stats = insights_data.application_stats(stores, NOW)
        self.assertEqual(stats['outcomes'], {'waiting': 1, 'rejected': 1, 'interview': 1})
        self.assertEqual(stats['interview_rate_of_decided'], '1/2 (50%)')
        self.assertEqual(stats['applied_last_7_days'], 1)
        self.assertEqual(stats['days_since_last_application'], 2)
        self.assertTrue(stats['by_group']['Region']['Best places']['too_small'])
        self.assertEqual(stats['by_group']['Days to apply']['<=3']['waiting'], 1)

    def test_replies_channels_and_time_to_first_reply(self):
        stores = memory_store([app('p1', 'Applied', '2026-09-20', channel='Recruiter platform'),
                               app('p2', 'Applied', '2026-09-10', channel='Direct')],
                              [{'ref': 'p1', 'kind': 'Reply received', 'at': '2026-09-23'},
                               {'ref': 'p1', 'kind': 'Screening', 'at': '2026-09-25'}])
        stats = insights_data.application_stats(stores, NOW)
        self.assertEqual(stats['reply_rate_of_all'], '1/2 (50%)')
        self.assertEqual(stats['days_to_first_reply'], [3])
        self.assertEqual(stats['by_group']['Channel']['Recruiter platform']['interview'], 1)
        self.assertEqual(stats['by_group']['Channel']['Direct']['waiting'], 1)

    def test_no_applications(self):
        stats = insights_data.application_stats(memory_store(), NOW)
        self.assertEqual((stats['applications'], stats['days_since_last_application']), (0, None))


class RunTests(unittest.TestCase):
    def test_insight_output_schemas_use_supported_array_constraints(self):
        # Anthropic rejects maxItems in output_config.format.schema with HTTP 400.
        def check(schema):
            if schema.get('type') == 'array':
                self.assertFalse(set(schema) - {'type', 'items', 'description', 'minItems'})
                check(schema['items'])
            elif schema.get('type') == 'object':
                for child in schema['properties'].values():
                    check(child)

        for schema in (insights.SCHEMA, insights.WEEKLY_SCHEMA):
            with self.subTest(schema='weekly' if schema is insights.WEEKLY_SCHEMA else 'daily'):
                check(schema)

    def test_both_insight_calls_leave_room_for_the_model_thinking(self):
        # effort 'medium' makes the model think, and thinking is drawn from max_tokens like the answer itself:
        # a 3000 cap cut both answers off (stop_reason 'max_tokens') and failed the whole scheduled run.
        daily = FakeClient()
        with patched():
            insights.run(None, open_stores(tracker=FakeTracker()), 'claude-sonnet-5-5', now=NOW, client=daily)
        monday, weekly = datetime(2026, 9, 28, 5, 0, tzinfo=timezone.utc), FakeClient(WEEKLY)
        with patched():
            insights.run(None, open_stores(tracker=FakeTracker()), 'claude-sonnet-5-5', now=monday, client=weekly)
        self.assertEqual(len(daily.calls), len(weekly.calls))  # one call each: the daily insight, the weekly report
        for call in (daily.calls[0], weekly.calls[0]):
            self.assertEqual(call['output_config']['effort'], 'medium')
            self.assertEqual(call['max_tokens'], insights.MAX_TOKENS)
        self.assertGreaterEqual(insights.MAX_TOKENS, 8000)

    def test_sends_one_insight_with_feedback_buttons_and_records_cost(self):
        tracker, client, sent, stats = FakeTracker(), FakeClient(), [], {}
        with patched(), mock.patch.dict('os.environ', {'NOTION_PROFILE_PAGE_ID': 'profile-page'}):
            summary = insights.run(None, open_stores(tracker=tracker), 'claude-sonnet-5-5', send=lambda t, k: sent.append((t, k)),
                                   now=NOW, client=client, stats=stats)
        self.assertIn('Insight sent: Skills', summary)
        text, keyboard = sent[0]
        self.assertIn('&amp; not on your CV', text)  # HTML-escaped
        self.assertIn('<b>Next step</b>\nAdd Prometheus', text)
        self.assertEqual([b['callback_data'] for b in keyboard['inline_keyboard'][0]],
                         [f'ins:{k}:4c79aec091df4dcc8a8827cd4d43a5ef' for k in 'una'])
        props = tracker.created[0][1]
        self.assertEqual(props['Category'], {'select': {'name': 'Skills'}})
        self.assertAlmostEqual(props['Cost (USD)']['number'], 0.016)  # 6000 in x $2 + 400 out x $10
        self.assertEqual((stats['done'], round(stats['usd'], 3)), (1, 0.016))
        payload = json.loads(client.calls[0]['messages'][0]['content'].split('\n', 1)[1])
        self.assertEqual(set(payload), {'market', 'applications', 'interviews', 'recent_insights', 'learning'})
        self.assertIn(PROFILE, client.calls[0]['system'][0]['text'])

    def test_not_due_before_the_hour_or_twice_a_day(self):
        early = datetime(2026, 9, 26, 2, 30, tzinfo=timezone.utc)
        client = FakeClient()
        self.assertEqual(insights.run(None, memory_store(), now=early, client=client), 'Insight: not due')
        sent = memory_store(insights_=[{'day': '2026-09-26', 'category': 'Skills', 'title': 'today'}])
        self.assertEqual(insights.run(None, sent, now=NOW, client=client), 'Insight: not due')
        self.assertEqual(client.calls, [])

    def test_force_and_skip(self):
        stores, sent = memory_store(), []
        with patched():
            summary = insights.run(None, stores, now=datetime(2026, 9, 26, 1, tzinfo=timezone.utc), force=True,
                                   client=FakeClient(dict(INSIGHT, skip=True)), send=lambda t, k: sent.append(t))
        self.assertIn('nothing new today', summary)
        self.assertEqual((stores.insights.list(), sent), ([], []))


WEEKLY = {'headline': 'Quiet week: 2 applications, no replies yet', 'summary': 'You sent 2 applications.',
          'worked': [], 'change': ['Apply within 3 days of posting'], 'focus': 'Five applications in Zurich',
          'confidence': 'low'}


class WeeklyTests(unittest.TestCase):
    def test_monday_sends_the_weekly_report_instead_of_the_daily_insight(self):
        monday = datetime(2026, 9, 28, 5, 0, tzinfo=timezone.utc)
        stores = memory_store([app('p1', 'Screening', '2026-09-20')], [
            {'ref': 'p1', 'kind': 'Screening', 'at': '2026-09-25T10:00:00+00:00', 'source': 'Telegram', 'note': 'Screening · Acme'},
            {'ref': 'p1', 'kind': 'Applied', 'at': '2026-09-26', 'source': 'Backfill'}])
        client, sent, stats = FakeClient(WEEKLY), [], {}
        with patched():
            summary = insights.run(None, stores, 'claude-sonnet-5-5', send=lambda t, k: sent.append((t, k)),
                                   now=monday, client=client, stats=stats)
        self.assertIn('Weekly report sent', summary)
        [row] = stores.insights.list()
        self.assertEqual((row['category'], row['day'], row['fields']['basis']), ('Weekly report', '2026-09-28', 'Both'))
        self.assertLessEqual(len(notion_blocks.to_blocks(row['body'])), 100)
        self.assertIn('Change next week', row['body'])
        payload = json.loads(client.calls[0]['messages'][0]['content'].split('\n', 1)[1])
        self.assertEqual(payload['week']['event_counts'], {'Screening': 1})  # backfill events don't count
        self.assertNotIn('Full report in Notion', sent[0][0])  # this Mac's store has no page to open
        self.assertIn('<b>Change next week</b>', sent[0][0])
        self.assertNotIn('✅ <b>Worked</b>', sent[0][0])  # empty list, no padding
        self.assertEqual(sent[0][1]['inline_keyboard'][0][0]['callback_data'], f"ins:u:{row['id']}")
        self.assertEqual(stats['done'], 1)

    def test_the_door_the_ai_picked_is_kept_on_the_row_and_any_other_is_dropped(self):
        """Your week's first button (src/suggestions.door): only a known door with a short label is kept; else Read the week alone."""
        monday = datetime(2026, 9, 28, 5, 0, tzinfo=timezone.utc)
        picks = [({'door': 'find_jobs', 'label': 'Find jobs now'}, {'door': 'find_jobs', 'label': 'Find jobs now'}),
                 ({'door': 'none', 'label': ''}, None), ({'door': 'leave_agencies_out', 'label': 'Leave agencies out'}, None),
                 ({'door': 'tune', 'label': 'x' * 41}, None)]
        for picked, kept in picks:
            stores = memory_store()
            with patched():
                insights.run(None, stores, 'claude-sonnet-5-5', now=monday, client=FakeClient(dict(WEEKLY, next_action=picked)))
            [row] = stores.insights.list()
            self.assertEqual(json.loads(row['fields']['data']) if 'data' in row['fields'] else None, kept, picked)
        self.assertIn('next_action', insights.WEEKLY_SCHEMA['required'])


class MessageTests(unittest.TestCase):
    """The Telegram text of one insight (insights.message)."""

    INSIGHT = {'category': 'Market', 'headline': 'H', 'evidence': ['e'], 'action': 'a',
               'confidence': 'Medium', 'basis': 'Applications', 'sample_size': 1}

    def test_a_sample_size_of_one_is_not_plural(self):
        text = insights.message(self.INSIGHT)
        self.assertIn('1 application', text)
        self.assertNotIn('1 applications', text)  # what it used to send, on the most common sample size
        self.assertIn('applications data, 1 application', text)

    def test_larger_samples_and_a_jobs_basis_read_normally(self):
        self.assertIn('4 applications', insights.message({**self.INSIGHT, 'sample_size': 4}))
        self.assertIn('1 job', insights.message({**self.INSIGHT, 'basis': 'Jobs'}))
        self.assertIn('2 jobs', insights.message({**self.INSIGHT, 'basis': 'Jobs', 'sample_size': 2}))


class EffortTests(unittest.TestCase):
    """Haiku 4.5 rejects the `effort` setting (400 "This model does not support the effort parameter"): the end-to-end journey runs every step on it."""

    def sent(self, call, model):
        seen = {}
        class Client:
            class messages:
                @staticmethod
                def create(**kwargs):
                    seen.update(kwargs)
                    return SimpleNamespace(stop_reason='end_turn', usage=None, content=[SimpleNamespace(type='text', text='{}')])
        call(Client, model)
        return seen['output_config']

    def test_no_effort_for_haiku_and_medium_for_the_rest(self):
        call = lambda client, model: insights.generate(client, model, PROFILE, {})
        self.assertNotIn('effort', self.sent(call, 'claude-haiku-4-5'))
        self.assertEqual(self.sent(call, 'claude-sonnet-5-5')['effort'], 'medium')
        self.assertEqual(self.sent(call, 'claude-haiku-4-5')['format']['type'], 'json_schema')

    def test_the_shared_helper_the_weekly_report_uses(self):
        from src.ai import engine
        self.assertEqual(engine.structured({'a': 1}, 'claude-haiku-4-5'), {'format': {'type': 'json_schema', 'schema': {'a': 1}}})
        self.assertEqual(engine.structured({'a': 1}, 'claude-opus-5-5'), {'format': {'type': 'json_schema', 'schema': {'a': 1}}, 'effort': 'medium'})


if __name__ == '__main__':
    unittest.main()


class SearchAnalysisMessageTests(unittest.TestCase):
    """The weekly report, shown as "Search analysis": the top finding leads, and an older report without one still renders."""
    REPORT = dict(WEEKLY, finding='Replies came only from jobs posted under 3 days ago (4 of 4)', issues=[])

    def test_the_message_opens_with_the_finding_when_there_is_one(self):
        lines = insights.weekly_message(self.REPORT).split('\n')
        self.assertEqual(lines[:2], ['📊 <b>Search analysis</b>', 'Last 7 days'])
        self.assertEqual(lines[3], '<b>Quiet week: 2 applications, no replies yet</b>')
        self.assertEqual(lines[4], '<b>Finding:</b> Replies came only from jobs posted under 3 days ago (4 of 4)')

    def test_a_report_without_a_finding_has_no_empty_line_for_it(self):
        text = insights.weekly_message(dict(self.REPORT, finding=''))
        self.assertNotIn('Finding', text)
        self.assertNotIn('Search review', text)

    def test_the_notion_page_starts_with_the_finding_as_a_callout(self):
        stats = {'applications': {'applications': 2, 'applied_last_7_days': 2, 'outcomes': {}, 'interview_rate_of_decided': 0},
                 'market': {'open_jobs': 1, 'eligible': 1, 'language_blocked': 0, 'new_last_7_days': 1, 'technologies_in_good_fit_jobs': []},
                 'week': {'event_counts': {}, 'insights_last_7_days': []}}
        first = insights.weekly_blocks(self.REPORT, stats)[0]
        self.assertEqual(first['type'], 'callout')
        self.assertIn('Replies came only', first['callout']['rich_text'][0]['text']['content'])
        self.assertEqual(insights.weekly_blocks(dict(self.REPORT, finding=''), stats)[0]['type'], 'paragraph')
