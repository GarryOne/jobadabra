"""Your answer about an email: "Is this about …?" (src/ai/reassign.py)."""
import json
import tempfile
import unittest
from datetime import datetime, timezone
from unittest import mock

from src import focus
from src.ai import reassign

NOW = datetime(2026, 9, 29, 13, 0, tzinfo=timezone.utc)


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


def job(page_id, company, title, stage='Screening', via='', interview=None):
    return {'id': page_id, 'url': f'https://notion.test/{page_id}', 'properties': {
        'Company': text(company), 'Via': text(via), 'Job': {'type': 'title', 'title': [{'plain_text': title}]},
        'Stage': {'type': 'select', 'select': {'name': stage}}, 'Contact': text(''), 'Feedback status': text(''),
        'Next interview': {'type': 'date', 'date': {'start': interview} if interview else None},
        'Job URL': {'type': 'url', 'url': f'https://x.test/{page_id}'}}}


def event(event_id, kind, application=None, changes=None, suggested=''):
    return {'id': event_id, 'properties': {
        'Kind': {'type': 'select', 'select': {'name': kind}}, 'Note': text('Teams call (email: "Connect Igor / Jaya - SRE")'),
        'At': {'type': 'date', 'date': {'start': '2026-09-29T14:35:00+02:00'}}, 'Source ID': text('h1'),
        'Application': {'type': 'relation', 'relation': [{'id': application}] if application else []},
        'Needs you': {'type': 'checkbox', 'checkbox': not application},
        'Suggested job': {'type': 'url', 'url': suggested or None},
        'Changes': text(json.dumps(changes or {}))}}


from src.notion import ledger  # noqa: E402
from src.stores import memory, open_stores, sqlite  # noqa: E402
from tests.mail_fakes import FakeTracker  # noqa: E402

HUX = {'url': 'https://x.test/hux', 'title': 'Principal SRE', 'company': '', 'via': 'Huxley'}


def asked(stores, kind='Interview scheduled', interview_at='2026-09-30T08:30:00+02:00'):
    """A question the Gmail check left: an email event on no job (Needs you), with the job it would pick."""
    return stores.events.add('', kind, '2026-09-29T14:35:00+02:00', source='Gmail', source_id='h1', needs_you=True,
                             interview_at=interview_at, suggested_job=HUX['url'], note='Teams call (email: "Connect Igor / Jaya - SRE")',
                             changes={'fields': {}, 'from': 'Jaya <jaya@huxley.test>', 'subject': 'Connect Igor / Jaya - SRE'})


class MoveTests(unittest.TestCase):
    """On the store (src/stores): the same answer on every adapter; the contract covers events.get/update on each."""

    def test_answering_is_this_about_moves_the_email_and_the_job(self):
        stores = memory.open_store()
        hux, _ = stores.applications.set_stage(HUX, 'Screening')
        question = asked(stores)
        result = reassign.move(stores, question['id'], HUX['url'], now=NOW)
        self.assertTrue(result['ok'], result)
        self.assertIn('Huxley', result['text'])
        self.assertEqual(stores.applications.get(HUX['url'])['next_interview'], '2026-09-30T08:30:00+02:00')
        event = stores.events.get(question['id'])
        self.assertEqual((event['app_id'], bool(event['needs_you'])), (hux['id'], False))
        self.assertEqual((event['changes']['from'], event['changes']['subject']), ('Jaya <jaya@huxley.test>', 'Connect Igor / Jaya - SRE'))
        self.assertIn('Next interview', event['changes']['fields'])

    def test_a_job_no_longer_there_or_an_answered_email_is_said(self):
        stores = memory.open_store()
        question = asked(stores)
        self.assertIs(reassign.move(stores, question['id'], 'https://x.test/gone', now=NOW)['ok'], False)
        self.assertTrue(stores.events.get(question['id'])['needs_you'])   # nothing changed
        self.assertIs(reassign.move(stores, 'no-such-event', HUX['url'], now=NOW)['ok'], False)

    def test_not_about_a_job_closes_the_question_on_no_job(self):
        stores = memory.open_store()
        question = asked(stores)
        self.assertTrue(reassign.move(stores, question['id'], reassign.NONE, now=NOW)['ok'])
        event = stores.events.get(question['id'])
        self.assertEqual((event['app_id'], bool(event['needs_you'])), ('', False))


class NewJobTests(unittest.TestCase):
    """"A new job": the job is made from the email on the active store (opportunity.track) on this Mac's and on Notion."""

    def check_new_job(self, stores):
        question = asked(stores)
        result = reassign.move(stores, question['id'], reassign.NEW, now=NOW)
        self.assertTrue(result['ok'], result)
        job = stores.applications.get('https://mail.google.com/mail/u/0/#all/h1')   # the email is its Job URL
        self.assertEqual((job['title'], job['contact']), ('Connect Igor / Jaya - SRE', 'Jaya · jaya@huxley.test'))
        self.assertEqual(job['next_interview'], '2026-09-30T08:30:00+02:00')
        event = stores.events.get(question['id'])
        self.assertEqual((event['app_id'], bool(event['needs_you'])), (job['id'], False))
        self.assertTrue([e for e in stores.events.list(app_id=job['id']) if e['note'].startswith('From an email you placed')])
        # Asked again (another question from the same email): the same job, not a second one.
        again = asked(stores)
        self.assertTrue(reassign.move(stores, again['id'], reassign.NEW, now=NOW)['ok'])
        self.assertEqual(stores.events.get(again['id'])['app_id'], job['id'])
        return job

    def test_a_new_job_on_this_macs_store(self):
        with tempfile.TemporaryDirectory() as folder:
            self.check_new_job(sqlite.open_store({'JOBADABRA_DATA_DIR': folder}))

    def test_a_new_job_on_notion(self):
        tracker = FakeTracker([])
        with mock.patch.object(ledger, 'EVENTS_DATABASE_ID', 'events-db'):
            stores = open_stores(env={'NOTION_EVENTS_DB': 'events-db'}, tracker=tracker)   # the Notion store, whatever the environment says
            self.assertEqual(stores.name, 'notion')
            job = self.check_new_job(stores)
        self.assertEqual(len(tracker.apps), 1)
        self.assertIn('Connect Igor / Jaya - SRE', tracker.written_under(job['id']))   # the message section on the page


class FocusQuestionTests(unittest.TestCase):
    def test_an_open_question_is_asked_with_the_likeliest_job(self):
        from tests.test_focus import from_notion  # the rows the Gmail check writes, as the notion store reads them
        hux = from_notion(job('hux', '', 'Principal SRE', via='Huxley'))
        asked = from_notion(event('q', 'Interview scheduled', suggested='https://x.test/hux'), 'events')
        items = focus.build([hux], [asked], target=0, now=NOW)['items']
        [ask] = [i for i in items if i['kind'] == 'which_job']
        self.assertEqual(ask['title'], 'Is this email about Huxley — Principal SRE?')
        self.assertEqual((ask['event_id'], ask['suggested_url'], ask['badge']), ('q', 'https://x.test/hux', 'Which job?'))
        answered = from_notion(event('q', 'Interview scheduled', application='hux'), 'events')
        self.assertFalse([i for i in focus.build([hux], [answered], target=0, now=NOW)['items'] if i['kind'] == 'which_job'])


if __name__ == '__main__':
    unittest.main()
