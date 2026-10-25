import unittest
from unittest import mock
from src import feedback, focus
from src.ai import learning, mail
from src.notion import ledger
from src.stores import base, memory, notion_rows
from tests.mail_fakes import app as notion_row
from tests.test_focus import NOW, event, row
from tests.test_mail import FakeTracker, event_row
from tests.mail_fakes import rec, stores_for


def as_record(page):
    """A Notion row (what the Gmail check still writes) as the store record Focus reads."""
    return {**notion_rows.to_record(page, notion_rows.APPLICATION_COLUMNS, base.APPLICATION_FIELDS), 'link': page.get('url', '')}


class FeedbackTests(unittest.TestCase):
    def test_only_verbatim_employer_words_are_accepted_from_gmail(self):
        body = 'Hi Sam,\nYour incident examples needed clearer trade-offs.\nThank you.'
        self.assertEqual(mail.verified_feedback('Your incident examples needed clearer trade-offs.', body),
                         'Your incident examples needed clearer trade-offs.')
        self.assertEqual(mail.verified_feedback('You lack seniority and cannot communicate.', body), '')
        self.assertEqual(mail.verified_feedback('Your incident examples needed clearer trade-offs.', body.replace('examples ', 'examples\n')), 
                         'Your incident examples needed clearer trade-offs.')
    def test_request_requires_screening_before_rejection_not_just_a_reply(self):
        app = row('a', 'Acme', 'SRE', stage='Rejected')
        for stage, expected in [('Applied', False), ('Confirmation received', False), ('Reply received', False),
                                ('Screening', True), ('Interview scheduled', True), ('Interviewing', True), ('Offer', True)]:
            items = focus.build([app], [event('a', stage, '2026-09-27'), event('a', 'Rejected', '2026-09-28')],
                                target=0, now=NOW)['items']
            self.assertEqual(any(i['kind'] == 'feedback' for i in items), expected, stage)
        self.assertFalse(feedback.eligible_status(app['feedback_status'], [{'kind': 'Rejected', 'at': '2026-09-27'},
                                                                           {'kind': 'Screening', 'at': '2026-09-28'}]))

    def test_requested_skipped_and_received_feedback_replace_the_request(self):
        app = row('a', 'Acme', 'SRE', stage='Rejected')
        events = [event('a', 'Screening', '2026-09-25'), event('a', 'Rejected', '2026-09-26', source_id='gmail1')]
        item = focus.build([app], events, target=0, now=NOW)['items'][0]
        self.assertEqual(item['link'], 'https://mail.google.com/mail/u/0/#all/gmail1')
        self.assertIn('Could you share what mainly influenced the decision?', item['draft'])
        item = focus.build([app], events + [event('a', feedback.REQUESTED, '2026-09-27')], target=0, now=NOW)['items'][0]
        self.assertEqual(item['kind'], 'feedback_wait')
        self.assertEqual(focus.build([app], events + [event('a', feedback.SKIPPED, '2026-09-27')], target=0, now=NOW)['items'], [])
        app['employer_feedback'] = 'Explain the recovery checks more clearly.'
        item = focus.build([app], events, target=0, now=NOW)['items'][0]
        self.assertEqual(item['kind'], 'feedback_review')

    def test_waiting_for_feedback_says_connect_gmail_when_it_is_not_connected(self):
        # #312: the row said "Gmail checks for replies" while the app's bottom bar said "Gmail not connected".
        app = row('a', 'Acme', 'SRE', stage='Rejected')
        events = [event('a', 'Screening', '2026-09-25'), event('a', 'Rejected', '2026-09-26'), event('a', feedback.REQUESTED, '2026-09-27')]
        on = focus.build([app], events, target=0, now=NOW)['items'][0]
        off = focus.build([app], events, target=0, now=NOW, gmail=False)['items'][0]
        self.assertIn('Gmail checks for replies · or add feedback here', on['meta'])
        self.assertIn('Gmail checks will collect', on['detail'])
        self.assertIn('Connect Gmail to collect replies · or add feedback here', off['meta'])
        for item in (off,):
            self.assertNotIn('Gmail checks', ' '.join([item['detail'], *item['meta']]))

    def test_feedback_can_be_collected_during_screening_without_changing_stage(self):
        app = notion_row('a', 'Acme', 'SRE', stage='Screening')
        tracker = FakeTracker([app])
        changed = mail.record(stores_for(tracker), rec(stores_for(tracker), app), feedback.RECEIVED, NOW.isoformat(), 'Gmail', 'msg1',
                              'Specific feedback', (set(), {}), feedback_text='Show how you validated database recovery.')
        self.assertEqual(changed, feedback.RECEIVED)
        self.assertEqual(ledger.plain(app['properties']['Stage']), 'Screening')
        self.assertEqual(ledger.plain(app['properties']['Feedback status']), 'Received feedback')
        self.assertEqual(tracker.created[0]['Kind']['select']['name'], feedback.RECEIVED)
        items = focus.build([as_record(app)], [], target=0, now=NOW)['items']
        self.assertIn('feedback_review', [i['kind'] for i in items])

    def test_two_gmail_replies_in_one_check_are_kept_and_message_ids_deduplicate(self):
        app = notion_row('a', 'Acme', 'SRE', stage='Rejected')
        tracker, index = FakeTracker([app]), (set(), {})
        for message_id, words in [('msg1', 'Give more concrete incident examples.'), ('msg2', 'Also explain database recovery checks.')]:
            mail.record(stores_for(tracker), rec(stores_for(tracker), app), feedback.RECEIVED, NOW.isoformat(), 'Gmail', message_id, 'Feedback', index, feedback_text=words)
        kept = ledger.plain(app['properties']['Employer feedback'])
        self.assertIn('incident examples', kept)
        self.assertIn('recovery checks', kept)
        self.assertEqual(len(tracker.created), 2)
        self.assertIsNone(mail.record(stores_for(tracker), rec(stores_for(tracker), app), feedback.RECEIVED, NOW.isoformat(), 'Gmail', 'msg2', 'Feedback', index,
                                     feedback_text='Also explain database recovery checks.'))
        self.assertEqual(len(tracker.created), 2)

    def test_gmail_rejection_captures_prior_screening_and_received_feedback(self):
        for words, status in [('', 'Not asked'), ('Your failover answer missed data consistency checks.', 'Received feedback')]:
            app = notion_row('a', 'Acme', 'SRE', stage='Screening')
            tracker = FakeTracker([app])
            mail.record(stores_for(tracker), rec(stores_for(tracker), app), 'Rejected', NOW.isoformat(), 'Gmail', 'msg1', 'Rejected', (set(), {}), feedback_text=words)
            self.assertEqual(ledger.plain(app['properties']['Stage']), 'Rejected')
            self.assertEqual(ledger.plain(app['properties']['Feedback status']), status)
        app = notion_row('a', 'Acme', 'SRE')
        tracker = FakeTracker([app])
        mail.record(stores_for(tracker), rec(stores_for(tracker), app), 'Rejected', NOW.isoformat(), 'Gmail', 'msg1', 'Rejected', (set(), {}))
        self.assertNotIn('Feedback status', app['properties'])

    def test_reviewer_can_mark_feedback_read_then_new_feedback_reappears(self):
        app = row('a', 'Acme', 'SRE', stage='Rejected', Employer_feedback='More concrete examples please.')
        events = [event('a', feedback.RECEIVED, '2026-09-26'), event('a', feedback.REVIEWED, '2026-09-27')]
        self.assertEqual(focus.build([app], events, target=0, now=NOW)['items'], [])
        events.append(event('a', feedback.RECEIVED, '2026-09-28'))
        self.assertEqual(focus.build([app], events, target=0, now=NOW)['items'][0]['kind'], 'feedback_review')

    def test_a_failed_store_write_does_not_change_the_feedback(self):
        from src.stores import memory
        stores = memory.open_store()
        app, _ = stores.applications.set_stage({'url': 'https://a/1', 'title': 'SRE', 'company': 'Acme'}, 'Rejected')
        with mock.patch.object(stores.applications, 'update', side_effect=RuntimeError('the store refused')):
            with self.assertRaises(RuntimeError):
                feedback.save_received(stores, app, 'Show more concrete incident examples.')
        self.assertEqual(stores.applications.by_id(app['id'])['employer_feedback'], '')

    def test_request_and_manual_feedback_have_distinct_events_and_keep_stage(self):
        stores = memory.open_store()
        app = stores.applications.create({'url': 'https://x.test/a', 'company': 'Acme', 'feedback_status': 'Not asked'}, 'Rejected')
        stores.events.add(app['id'], 'Screening', '2026-09-20')
        feedback.act(stores, app, 'request')
        feedback.act(stores, stores.applications.by_id(app['id']), 'request')  # a second click writes nothing
        self.assertEqual([e['kind'] for e in stores.events.list(app_id=app['id'])], ['Screening', feedback.REQUESTED])
        self.assertEqual(stores.applications.by_id(app['id'])['feedback_status'], 'Asked for feedback')
        app = stores.applications.update(app['id'], {'stage': 'Interviewing'})
        words = 'The systems answer needed clearer trade-offs.'
        feedback.act(stores, app, 'receive', words)
        feedback.act(stores, stores.applications.by_id(app['id']), 'receive', words)  # the same words again: once
        app = stores.applications.by_id(app['id'])
        self.assertEqual((app['stage'], app['feedback_status'], app['employer_feedback']), ('Interviewing', 'Received feedback', words))
        received = stores.events.list(app_id=app['id'], kind=feedback.RECEIVED)
        self.assertEqual([(e['note'], e['source'], e['source_id'][:9]) for e in received], [(words, 'Jobadabra app', 'feedback:')])
        feedback.act(stores, app, 'review')
        self.assertEqual(stores.applications.by_id(app['id'])['feedback_status'], 'Received feedback')
        self.assertEqual(len(stores.events.list(app_id=app['id'], kind=feedback.REVIEWED)), 1)

    def test_the_command_saves_on_the_store_by_the_jobs_id(self):
        import io
        import json as _json
        from contextlib import redirect_stdout
        stores = memory.open_store()
        app = stores.applications.create({'url': 'https://x.test/a', 'feedback_status': 'Not asked'}, 'Rejected')
        out = io.StringIO()
        with mock.patch('src.stores.open_stores', return_value=stores), redirect_stdout(out):
            self.assertEqual(feedback.main([app['id'], 'skip']), 0)
            self.assertEqual(feedback.main(['gone', 'skip']), 1)
        self.assertEqual([_json.loads(line)['ok'] for line in out.getvalue().splitlines()], [True, False])
        self.assertEqual(stores.applications.by_id(app['id'])['feedback_status'], 'Skipped')


def source(sid, app, company, kind, words='Explain failover checks with a concrete incident.'):
    return {'source_id': sid, 'application': app, 'company': company, 'source_type': kind,
            'text': words, 'url': f'https://notion.test/{app}', 'role': 'SRE'}


class LearningTests(unittest.TestCase):
    def setUp(self):
        self.sources = [source('a', 'app1', 'Acme', 'Employer feedback'),
                        source('b', 'app2', 'Beta', 'Interview review'),
                        source('c', 'app3', 'Gamma', 'CV fit gap')]
        self.issue = {'issue': 'Failover examples need clearer recovery checks.', 'action': 'Practise one failover incident story.',
                      'support': [{'source_id': s['source_id'], 'quote': s['text']} for s in self.sources]}

    def test_global_advice_needs_three_apps_two_employers_two_types_and_primary_evidence(self):
        self.assertEqual(len(learning.validate([self.issue], {'evidence': self.sources})), 1)
        for bad in [self.sources[:2],
                    [dict(s, application='same') for s in self.sources],
                    [dict(s, company='Acme') for s in self.sources],
                    [dict(s, source_type='CV fit gap') for s in self.sources],
                    [self.sources[0], dict(self.sources[1], source_type='Rejection hypothesis'), self.sources[2]]]:
            self.assertEqual(learning.validate([self.issue], {'evidence': bad}), [])

    def test_unknown_references_and_fabricated_quotes_never_produce_global_advice(self):
        for support in [[{'source_id': 'fake', 'quote': 'Totally invented feedback'}],
                        [{'source_id': s['source_id'], 'quote': 'Invented words never said'} for s in self.sources]]:
            self.assertEqual(learning.validate([dict(self.issue, support=support)], {'evidence': self.sources}), [])

    def test_repeating_one_application_many_times_does_not_inflate_evidence(self):
        repeated = dict(self.issue, support=[self.issue['support'][0]] * 20)
        self.assertEqual(learning.validate([repeated], {'evidence': self.sources}), [])

    def test_focus_shows_a_supported_insight_and_its_next_action(self):
        insight = {**base.record(base.INSIGHT_FIELDS, {
            'id': 'i', 'day': '2026-09-28', 'category': 'Process', 'title': 'Make incident answers more concrete',
            'fields': {'action': 'Practise one incident story', 'evidence': 'Three applications, two employers',
                       'issue_detected': True}}), 'link': 'https://notion.test/i'}
        result = focus.build([], [], target=0, now=NOW, insights=[insight])['insight']
        self.assertEqual(result['reason'], 'Issue detected')
        self.assertEqual(result['detail'], 'Practise one incident story')
        self.assertEqual(result['notion_url'], insight['link'])

    def test_supported_advice_is_saved_to_notion_with_traceable_evidence(self):
        from src.stores import memory
        stores = memory.open_store()
        issues = learning.validate([self.issue], {'evidence': self.sources})
        learning.publish(stores, issues, NOW, 'existing-insight-model')
        [row] = stores.insights.list()
        self.assertTrue(row['fields']['issue_detected'])
        self.assertEqual((row['fields']['sample_size'], row['fields']['model']), (3, 'existing-insight-model'))
        self.assertIn('https://notion.test/app1', row['body'])
        stores = memory.open_store()
        learning.publish(stores, learning.validate([self.issue], {'evidence': self.sources[:1]}), NOW, 'model')
        self.assertEqual(stores.insights.list(), [])
