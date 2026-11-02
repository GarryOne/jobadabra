"""The daily insight, weekly report and learning on the store (src/ai/insights.py, insights_data.py, learning.py): they run
with JOBADABRA_STORE=sqlite and no Notion, and the feedback buttons carry the store's own insight id, which the
buttons' handler updates (ins:<u|n|a>:<id> → insights.update(id, {'fields': {'feedback': …}}))."""
import os
import shutil
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from src.ai import insights, learning
from src.stores import memory, open_stores, sqlite
from tests.test_insights import INSIGHT, NOW, FakeClient, patched

MONDAY = datetime(2026, 9, 28, 5, 0, tzinfo=timezone.utc)


class SqliteRunTests(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.folder, True)
        self.env = {'JOBADABRA_STORE': 'sqlite', 'JOBADABRA_DATA_DIR': str(self.folder)}

    def test_the_daily_insight_runs_on_this_macs_store_without_notion(self):
        sqlite.open_store(self.env).texts.set('profile', 'SRE with Kubernetes.')
        sent = []
        with mock.patch.dict(os.environ, self.env, clear=False), patched():
            os.environ.pop('NOTION_TOKEN', None)
            summary = insights.run(None, None, 'claude-sonnet-5-5', send=lambda t, k: sent.append((t, k)), now=NOW,
                                   client=(client := FakeClient()))
        self.assertIn('Insight sent: Skills', summary)
        self.assertIn('SRE with Kubernetes.', client.calls[0]['system'][0]['text'])
        [row] = sqlite.open_store(self.env).insights.list()
        self.assertEqual((row['category'], row['fields']['confidence'], row['fields']['sample_size']), ('Skills', 'medium', 3))
        self.assertEqual(row['fields']['evidence'], '\n'.join(INSIGHT['evidence']))
        self.assertEqual(len(row['id']), 32)
        with mock.patch.dict(os.environ, self.env, clear=False), patched():
            self.assertEqual(insights.run(None, None, now=NOW, client=FakeClient()), 'Insight: not due')

    def test_the_feedback_button_id_is_the_record_the_handler_updates(self):
        for stores in (sqlite.open_store(self.env), memory.open_store()):
            sent = []
            with patched():
                insights.run(None, stores, now=NOW, client=FakeClient(), send=lambda t, k: sent.append(k))
            data = sent[0]['inline_keyboard'][0][0]['callback_data']
            self.assertTrue(data.startswith('ins:u:') and len(data.encode()) <= 64, data)
            stores.insights.update(data.split(':')[2], {'fields': {'feedback': 'Useful'}})
            self.assertEqual([i['fields'].get('feedback') for i in stores.insights.list()], ['Useful'], stores.name)


class LearningTests(unittest.TestCase):
    def test_evidence_comes_from_the_stores_jobs_and_reviewed_interviews(self):
        stores = memory.open_store()
        acme = stores.applications.create({'url': 'https://x.test/a', 'title': 'SRE', 'company': 'Acme',
                                           'employer_feedback': 'Strong on Kubernetes, thin on Postgres.', 'applied_on': '2026-09-10'}, 'Rejected')
        stores.events.add(acme['id'], 'Rejected', '2026-09-20')
        stores.interviews.save(None, {'app_id': acme['id'], 'title': 'Call', 'overall': 'negative', 'weak_topics': 'Postgres',
                                      'at': '2026-09-15', 'review': '### Weak spots\n\n- Postgres failover'})
        stores.interviews.save(None, {'app_id': acme['id'], 'title': 'Not reviewed', 'transcript': 'secret words'})
        found = learning.evidence(stores, NOW)['evidence']
        self.assertEqual(sorted(r['source_type'] for r in found), ['Employer feedback', 'Interview review'])
        feedback = next(r for r in found if r['source_type'] == 'Employer feedback')
        self.assertEqual((feedback['company'], feedback['role'], feedback['date']), ('Acme', 'SRE', '2026-09-20'))
        review = next(r for r in found if r['source_type'] == 'Interview review')
        self.assertIn('Postgres failover', review['text'])
        self.assertNotIn('secret words', ' '.join(r['text'] for r in found))

    def test_a_matchs_fit_gaps_are_evidence_for_its_job(self):
        stores = memory.open_store()
        stores.applications.create({'url': 'https://x.test/a', 'title': 'SRE', 'company': 'Acme'}, 'Applied')
        stores.matches.upsert({'url': 'https://x.test/a/', 'title': 'SRE', 'first_seen': '2026-09-20',
                               'fit_detail': {'gaps': 'No Postgres HA shown'}})
        stores.matches.upsert({'url': 'https://x.test/other', 'fit_detail': {'gaps': 'not this job'}})
        found = learning.evidence(stores, NOW)['evidence']
        self.assertEqual([(r['source_type'], r['text'], r['company']) for r in found],
                         [('CV fit gap', 'No Postgres HA shown', 'Acme')])

    def test_publish_adds_one_process_insight_per_issue_with_its_evidence(self):
        stores = memory.open_store()
        issue = {'issue': 'Postgres depth comes up', 'action': 'Practise failover', 'applications': 3, 'employers': 2,
                 'source_types': ['Employer feedback', 'Interview review'],
                 'sources': [{'company': 'Acme', 'role': 'SRE', 'source_type': 'Employer feedback', 'url': 'https://x.test/a'}],
                 'support': [{'source_id': 's1', 'quote': 'thin on Postgres'}]}
        learning.publish(stores, [issue, dict(issue, issue='Second')], NOW, 'claude-sonnet-5-5')
        rows = stores.insights.list(category='Process')
        self.assertEqual(sorted(r['title'] for r in rows), ['Postgres depth comes up', 'Second'])
        self.assertTrue(rows[0]['fields']['issue_detected'])
        self.assertIn('thin on Postgres', rows[0]['body'])


class OpenStoresTests(unittest.TestCase):
    def test_without_a_tracker_the_insight_reads_the_chosen_store(self):
        with tempfile.TemporaryDirectory() as folder:
            stores = open_stores({'JOBADABRA_STORE': 'sqlite', 'JOBADABRA_DATA_DIR': folder})
            self.assertEqual(stores.name, 'sqlite')


if __name__ == '__main__':
    unittest.main()
