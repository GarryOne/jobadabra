import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import mail, rejection
from src.notion import ledger
from src.stores import memory
from src.stores.notion_blocks import to_blocks
from tests.test_mail import FakeClient, FakeGoogle, FakeTracker, NOW, app, email, result


def verdict(kind='Hard skills', improve=('Add a Postgres replication bullet',)):
    return {'verdict': kind, 'confidence': 'medium', 'stage_reached': 'CV screen (no call)',
            'summary': 'The role needs deep Postgres internals.', 'evidence': ['Posting: "5+ years Postgres"'],
            'improve': list(improve)}


class Client:
    def __init__(self, answer):
        self.answer, self.calls, self.messages = answer, [], self

    def create(self, **params):
        self.calls.append(params)
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(self.answer))],
                               usage=SimpleNamespace(input_tokens=9000, output_tokens=400, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


RECORD = {'job': {'title': 'Staff SRE', 'description': 'We need 5+ years of Postgres internals.'},
          'answers': [{'question': 'Why us?', 'answer': 'I love observability.'}], 'cover_letter': 'Dear team',
          'match': {'Score': 72, 'Reason': 'strong SRE match, Postgres depth unclear'}}


def stores_with(*jobs, record=None):
    """The memory store (any adapter: sqlite on this Mac, Notion) with the Profile and the jobs (company, title, stage, extra)."""
    stores = memory.open_store()
    stores.texts.set('profile', '# Profile\nSRE, 8 years, Kubernetes, Prometheus.')
    made = []
    for company, title, stage, extra in jobs:
        made.append(stores.applications.create({'url': f'https://jobs.test/{len(made) + 1}', 'title': title, 'company': company, **extra}, stage))
    if record is not None:
        stores.applications.set_section(made[0]['id'], ledger.RECORD_HEADING, f"Frozen\n\n```json\n{json.dumps(record)}\n```\n")
    return stores, [stores.applications.get(m['url']) for m in made]


class RejectionTests(unittest.TestCase):
    def test_material_has_the_posting_what_was_sent_the_timeline_and_the_email(self):
        stores, (row, _) = stores_with(('Grafana Labs', 'Staff SRE | Spain', 'Rejected', {}),
                                       ('Grafana Labs', 'Staff SRE | Sweden', 'Rejected', {}), record=RECORD)
        stores.events.add(row['id'], 'Rejected', '2026-09-28T05:00:00Z', source='Gmail', note='not moving forward')
        text = rejection.material(stores, row, 'Subject: Your application\n\nNot moving forward.')
        for part in ('5+ years of Postgres', 'Q: Why us?', 'Dear team', 'strong SRE match', 'Rejected — not moving forward',
                     'Staff SRE | Sweden (Rejected)', '## Rejection email', 'Company: Grafana Labs'):
            self.assertIn(part, text)
        bare_stores, (bare,) = stores_with(('Acme', 'SRE', 'Rejected', {}))
        self.assertIn('No application record was kept', rejection.material(bare_stores, bare))

    def test_review_writes_the_verdict_on_the_application(self):
        stores, (row,) = stores_with(('Canonical', 'Senior SRE', 'Rejected', {}), record=RECORD)
        client = Client(verdict())
        result, line = rejection.review(stores, row, client=client, model='claude-sonnet-5-5', stats={})
        self.assertIn('## Job posting', client.calls[0]['messages'][0]['content'])
        self.assertIn('SRE, 8 years', client.calls[0]['system'][0]['text'])
        saved = stores.applications.get(row['url'])
        self.assertEqual(saved['rejection'], 'Hard skills')
        self.assertIn('Next time: Add a Postgres', saved['rejection_lesson'])
        blocks = to_blocks(stores.applications.section(row['id'], rejection.HEADING))
        self.assertEqual(blocks[0]['type'], 'callout')   # the review keeps its callout and to-dos (the store's codec)
        self.assertIn('to_do', [b['type'] for b in blocks])
        self.assertIn('Hard skills (medium)', line)

    def test_the_reviews_markdown_becomes_todays_blocks_again(self):
        """Notion users see the review as before: the same blocks, the callout's icon included."""
        made = to_blocks(rejection.review_markdown(verdict(), 'claude-sonnet-5-5'))
        today = rejection.blocks(verdict(), 'claude-sonnet-5-5')
        self.assertEqual([b['type'] for b in made], [b['type'] for b in today])
        self.assertEqual(made[0]['callout'].get('icon'), today[0]['callout']['icon'])

    def test_not_on_you_has_nothing_to_improve_and_missing_fields_still_leave_the_section(self):
        stores, (row,) = stores_with(('Grafana Labs', 'Staff SRE | Spain', 'Rejected', {}))
        with mock.patch.object(stores.applications, 'update', side_effect=RuntimeError('400: Rejection reason is not a property')):
            result, _ = rejection.review(stores, row, client=Client(verdict(rejection.NOT_ON_YOU, ('ignored',))), stats={})
        self.assertEqual(result['improve'], [])
        self.assertIn('Nothing to improve here: they were looking for a different profile.', stores.applications.section(row['id'], rejection.HEADING))

    def test_pending_is_the_rejected_jobs_without_a_review(self):
        stores, rows = stores_with(('A', 'x', 'Rejected', {'rejection': 'Unclear'}), ('B', 'y', 'Rejected', {'applied_on': '2026-09-01'}),
                                   ('C', 'z', 'Rejected', {'applied_on': '2026-09-20'}), ('D', 'w', 'Applied', {}))
        self.assertEqual([r['company'] for r in rejection.pending(stores)], ['C', 'B'])   # the latest applied first


class RejectionRunTests(unittest.TestCase):
    def logged(self, argv, rows, stores):
        logged = []
        with mock.patch.object(rejection, 'open_stores', return_value=stores), \
                mock.patch.object(rejection, 'pending', return_value=rows), \
                mock.patch.object(rejection, 'review', side_effect=lambda s, row, **_: (None, f"reviewed {row['id']}")), \
                mock.patch.object(rejection.run_log, 'auto_begin'), \
                mock.patch.object(rejection.run_log, 'log_run', side_effect=lambda s, run: logged.append(run)), \
                mock.patch('builtins.print'):
            rejection.main(argv)
        return logged[0]

    def test_a_review_of_one_job_links_its_run_to_it_several_link_none(self):
        stores, rows = stores_with(('Canonical', 'Senior SRE', 'Rejected', {}), ('Grafana Labs', 'Staff SRE', 'Rejected', {}))
        run = self.logged(['--job', rows[0]['url']], rows[:1], stores)
        self.assertEqual((run['application'], run['subject']), (rows[0]['id'], 'Canonical — Senior SRE'))
        self.assertNotIn('application', self.logged(['--pending'], rows, stores))


class GmailCheckTriggersTests(unittest.TestCase):
    def test_a_rejection_email_starts_a_review_with_the_email_text(self):
        with tempfile.TemporaryDirectory() as folder:
            apps = [app('p1', 'Scale AI', 'Infrastructure Engineer')]
            tracker, google = FakeTracker(apps), FakeGoogle([{**email('m1', 'Update on your application'), 'body': 'Scale AI: not moving forward'}])
            reviewed = []
            fake = lambda stores, row, **kw: (reviewed.append((row['id'], kw['email_text'])) or ({}, '🛠 Why rejected · Scale AI'))
            stats = {}
            with mock.patch.object(rejection, 'review', fake), \
                    mock.patch('src.ai.mail_calendar.interview_stats', lambda s: {'topics_answered_weakly': {}}):
                sent = []
                mail.run(tracker, google, client=FakeClient([[result(0, 0, 'Rejected', 'Not moving forward')]]), days=2,
                         send=sent.append, calendar=False, now=NOW, state_path=Path(folder) / 's.json', stats=stats)
            self.assertEqual(reviewed, [('p1', 'Subject: Update on your application\n\nScale AI: not moving forward')])
            self.assertIn('🛠 Why rejected · Scale AI', sent[0])
            self.assertIn('🛠 Why rejected · Scale AI', stats['updates'])

    def test_turned_off_it_does_nothing(self):
        with mock.patch.dict('os.environ', {'JOBADABRA_DISABLE': 'rejection_review'}):
            self.assertEqual(mail.review_rejections(memory.open_store(), None, [(app('p1', 'A', 'x'), email('m', 's'))], {}), [])


if __name__ == '__main__':
    unittest.main()
