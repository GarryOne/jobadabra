import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import desktop
from src.ai import mail, opportunity
from tests.test_mail import NOW, FakeGoogle, FakeTracker, app, email, result
from tests.mail_fakes import content, stores_for

EMAIL_PITCH = """Hi Sam,

A logistics software company whose platform runs live warehouse operations is adding a second Senior DevOps
Engineer. Fully remote across Europe on a B2B contract. €70,000 to €90,000, maybe €100,000 plus equity.

Would you be open to hearing more?

Alex Morgan, Founder | Tech Recruiter, Example Talent, alex@example-talent.test"""
EMAIL_LEAD = {'is_opportunity': True, 'title': 'Senior DevOps Engineer', 'company': '', 'client': 'logistics software, Series A',
              'location': 'Remote (Europe)', 'work_mode': 'Remote', 'salary': '€70k–90k (maybe €100k) + equity',
              'contract': 'B2B contract', 'recruiter_name': 'Alex Morgan', 'recruiter_email': 'alex@example-talent.test',
              'recruiter_company': 'Example Talent', 'in_house': False, 'platform': 'Email', 'job_url': '', 'summary': 'AWS, EKS, Aurora',
              'owner_agreed': False}
CHAT_PITCH = """Jordan Lee: Hi Sam, I'm currently looking for a remote SRE for Acme Robotics (a new seed-stage startup).
120-220K EUR, 1 day every other month in Vienna. Could this be interesting?
Sam Example: Yes"""
CHAT_LEAD = dict(EMAIL_LEAD, title='Site Reliability Engineer', company='Acme Robotics', client='', location='Remote, Vienna monthly',
                 salary='€120k–220k', contract='', recruiter_name='Jordan Lee', recruiter_email='',
                 recruiter_company='Sample Search Partners', platform='LinkedIn', owner_agreed=True)


class Client:
    """Anthropic client double: answers each call with the next canned JSON."""

    def __init__(self, *answers):
        self.answers, self.calls, self.messages = list(answers), [], self

    def create(self, **params):
        self.calls.append(params)
        return SimpleNamespace(content=[SimpleNamespace(type='text', text=json.dumps(self.answers.pop(0)))],
                               usage=SimpleNamespace(input_tokens=900, output_tokens=200, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))


class Tracker(FakeTracker):
    def __init__(self, apps=(), events=()):
        super().__init__(list(apps), events)
        self.bodies = {}

    def find(self, url):
        return next((p for p in self.created if p.get('Job URL', {}).get('url') == url), None)

    def create_page(self, database_id, properties):
        page = super().create_page(database_id, properties)
        return dict(page, url=f"https://notion.test/{page['id']}")

    def replace_after_heading(self, page_id, heading, blocks):
        self.bodies[page_id] = (heading, blocks)


class OpportunityTests(unittest.TestCase):
    def test_authored_backbone_opportunity_reply_follows_the_product_schema(self):
        file = Path(__file__).resolve().parents[1] / 'desktop/e2e/fixtures/golden/ai-answers.json'
        reply = json.loads(file.read_text())['kinds']['opportunity']['answer']['reply']
        lead = json.loads(reply['content'][0]['text'])
        self.assertEqual(set(lead), set(opportunity.SCHEMA['required']))
        for key, schema in opportunity.SCHEMA['properties'].items():
            self.assertIsInstance(lead[key], {'string': str, 'boolean': bool}[schema['type']])
            if 'enum' in schema:
                self.assertIn(lead[key], schema['enum'])
        self.assertEqual((lead['title'], lead['company']), ('DevOps Engineer', 'Initech'))
        self.assertEqual(lead['recruiter_email'], 'recruiter@initech-hr.test')

    def test_extract_names_opportunity_even_on_a_shared_mail_client(self):
        from src.ai.providers.anthropic_api import AnthropicApi
        sdk = Client(EMAIL_LEAD)
        client = AnthropicApi(client=sdk)
        lead = opportunity.extract(client, 'claude-haiku-5-5', EMAIL_PITCH)
        self.assertEqual(lead, EMAIL_LEAD)
        self.assertEqual(sdk.calls[0].get('extra_headers'), {'x-jp-action': 'opportunity'})

    def test_a_recruiter_email_becomes_a_recruiter_lead_with_the_message_on_its_page(self):
        tracker, client = Tracker(), Client(EMAIL_LEAD)
        line = opportunity.add_from_text(stores_for(tracker), EMAIL_PITCH, client=client)
        row, event = tracker.created
        self.assertEqual(row['Stage'], {'select': {'name': 'Recruiter lead'}})
        self.assertEqual(row['Channel'], {'select': {'name': 'Agency'}})
        self.assertEqual(row['Via']['rich_text'][0]['text']['content'], 'Example Talent')
        self.assertEqual(row['Contact']['rich_text'][0]['text']['content'], 'Alex Morgan · alex@example-talent.test')
        self.assertEqual(row['Company'], {'rich_text': []})  # hidden employer: nothing for the Gmail check to mis-match
        self.assertIn('Client: logistics software', row['Notes']['rich_text'][0]['text']['content'])
        self.assertEqual(row['Work mode'], {'select': {'name': 'Remote'}})
        self.assertEqual(event['Kind'], {'select': {'name': 'Recruiter lead'}})
        written = tracker.written_under('new-1')  # the job's page: the message section, as replace_after_heading wrote it
        self.assertIn(opportunity.HEADING, written)
        self.assertIn('Would you be open', written)
        self.assertIn('Senior DevOps Engineer — logistics software, Series A (client) via Example Talent', line)
        self.assertIn('(Recruiter lead)', line)

    def test_pasting_the_same_message_twice_keeps_one_row(self):
        tracker = Tracker()
        opportunity.add_from_text(stores_for(tracker), EMAIL_PITCH, client=Client(EMAIL_LEAD))
        again = opportunity.add_from_text(stores_for(tracker), EMAIL_PITCH + '\n', client=Client(EMAIL_LEAD))
        self.assertTrue(again.startswith('Already tracked'))
        self.assertEqual(len([p for p in tracker.created if 'Stage' in p]), 1)

    def test_where_the_recruiter_reached_you_is_kept(self):
        tracker = Tracker()
        opportunity.add_from_text(stores_for(tracker), CHAT_PITCH, client=Client(CHAT_LEAD))
        self.assertEqual(tracker.created[0]['Reached via'], {'select': {'name': 'LinkedIn'}})
        # Source = where it started: a LinkedIn chat pasted into the app is LinkedIn; a pasted email keeps the app's
        self.assertEqual(tracker.created[0]['Source'], {'select': {'name': 'LinkedIn'}})
        opportunity.add_from_text(stores_for(tracker), EMAIL_PITCH, client=Client(EMAIL_LEAD))
        self.assertEqual([p for p in tracker.created if 'Stage' in p][-1]['Source'], {'select': {'name': 'Manual'}})

    def test_the_same_pitch_from_gmail_and_pasted_is_one_lead(self):
        emailed = app('g1', '', 'Senior DevOps Engineer', stage='Recruiter lead', contact='Alex Morgan · alex@example-talent.test')

        tracker = Tracker([emailed])
        line = opportunity.add_from_text(stores_for(tracker), EMAIL_PITCH, client=Client(EMAIL_LEAD))
        self.assertTrue(line.startswith('Already tracked'))
        self.assertEqual(tracker.created, [])

    def test_older_leads_get_reached_via_from_their_notes(self):
        old = app('o1', '', 'SRE', stage='Recruiter lead')
        old['properties'].update({'Notes': {'type': 'rich_text', 'rich_text': [{'plain_text': 'Recruiter message (LinkedIn). Client: x'}]},
                                  'Reached via': {'type': 'select', 'select': None}})
        done = app('o2', '', 'SRE', stage='Recruiter lead')
        done['properties']['Reached via'] = {'type': 'select', 'select': {'name': 'Email'}}
        tracker = Tracker([old, done])
        self.assertEqual(opportunity.backfill_reached(stores_for(tracker)), 1)
        self.assertEqual(tracker.updates, [('o1', {'Reached via': {'select': {'name': 'LinkedIn'}}})])

    def test_a_conversation_where_the_owner_said_yes_starts_at_screening(self):
        tracker = Tracker()
        line = opportunity.add_from_text(stores_for(tracker), CHAT_PITCH, client=Client(CHAT_LEAD))
        row = tracker.created[0]
        self.assertEqual(row['Stage'], {'select': {'name': 'Screening'}})
        self.assertTrue(row['Job URL']['url'].startswith('https://www.linkedin.com/messaging/#jp-'))
        self.assertEqual([p['Kind']['select']['name'] for p in tracker.created[1:]], ['Recruiter lead', 'Screening'])
        self.assertIn('Acme Robotics', line)

    def test_short_text_and_non_pitches_are_refused_without_writing(self):
        tracker = Tracker()
        with self.assertRaisesRegex(ValueError, 'whole recruiter message'):
            opportunity.add_from_text(stores_for(tracker), 'on or before 23 Sep', client=Client())
        with self.assertRaisesRegex(ValueError, "doesn't read like"):
            opportunity.add_from_text(stores_for(tracker), 'Your weekly job alert: 25 new DevOps jobs near Zurich …',
                                      client=Client(dict(EMAIL_LEAD, is_opportunity=False)))
        self.assertEqual(tracker.created, [])

    def test_a_posting_link_in_the_message_is_the_job_url(self):
        lead = dict(EMAIL_LEAD, job_url='https://jobs.ashbyhq.com/acme/1')
        self.assertEqual(opportunity.lead_url(lead, EMAIL_PITCH), 'https://jobs.ashbyhq.com/acme/1')
        self.assertEqual(opportunity.lead_url(EMAIL_LEAD, EMAIL_PITCH, 'm42'), 'https://mail.google.com/mail/u/0/#all/m42')

    def test_the_app_lists_a_lead_as_saved_until_you_are_talking(self):
        self.assertEqual(desktop.stage_status('Recruiter lead'), 'saved')
        self.assertEqual(desktop.stage_status('Screening'), 'applied')


class MailOutreachTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name) / 'state.json'

    def tearDown(self):
        self.tmp.cleanup()

    def run_mail(self, tracker, google, classified, *leads):
        client = Client(*([{'results': r} for r in classified] + list(leads)))
        sent = []
        summary = mail.run(tracker, google, client=client, days=2, send=sent.append, calendar=False, now=NOW,
                           state_path=self.state, stats={})
        return summary, sent, client

    def test_a_recruiters_first_email_becomes_a_lead_and_telegram_says_so(self):
        tracker = Tracker([app('p1', 'Scale AI', 'Infrastructure Engineer')])
        google = FakeGoogle([email('m1', 'DevOps Engineer - Fully Remote', sender='Alex Morgan <alex@example-talent.test>')])
        _, sent, client = self.run_mail(tracker, google, [[result(0, -1, mail.OUTREACH, company='Example Talent')]], EMAIL_LEAD)
        row, event = tracker.created[0], tracker.created[1]
        self.assertEqual(row['Source'], {'select': {'name': 'Gmail'}})
        self.assertEqual(row['Job URL']['url'], 'https://mail.google.com/mail/u/0/#all/m1')
        self.assertEqual(event['At'], {'date': {'start': '2026-09-26T09:00:00+02:00'}})
        self.assertIn(('new-2', 'm1'), [(page, content(u['Source ID'])) for page, u in tracker.updates if 'Source ID' in u])
        self.assertIn('<b>New recruiter lead · Senior DevOps Engineer', sent[0])
        self.assertIn('Recruiter outreach', client.calls[0]['system'][0]['text'])

    def test_the_recruiters_follow_up_is_a_reply_on_the_lead_not_a_second_lead(self):
        lead = app('p9', '', 'Site Reliability Engineer', stage='Recruiter lead', via='Sample Search Partners', contact='Jordan Lee')
        tracker = Tracker([lead])
        google = FakeGoogle([email('m2', 'Should we chat about the role?', sender='Jordan Lee <jordan@sample-search.test>')])
        self.run_mail(tracker, google, [[result(0, 0, mail.OUTREACH)]])
        self.assertEqual([p['Kind']['select']['name'] for p in tracker.created], ['Reply received'])

    def test_the_search_includes_linkedin_message_emails(self):
        q = mail.query([], 2)
        self.assertIn('from:messages-noreply@linkedin.com', q)
        self.assertNotIn('subject:', q)   # a recruiter's pitch from anyone else is found by the inbox triage (mail_triage), in any language

    def test_recruiter_leads_are_among_the_applications_emails_can_belong_to(self):
        lead = app('p1', '', 'Senior DevOps Engineer', stage='Recruiter lead', via='Example Talent')
        tracker, filters = Tracker([lead, app('p2', 'Acme', 'SRE', stage='Dismissed')]), []
        tracker.query_database = lambda db, f=None: filters.append(f) or tracker.apps
        self.assertEqual([r['id'] for r in mail.applications(stores_for(tracker))], ['p1'])  # the lead, not the dismissed job
        self.assertEqual(filters, [None])  # no Stage filter: Notion refuses one for a choice the workspace lacks

    def test_a_workspace_without_the_recruiter_lead_choice_still_gets_its_mail_checked(self):
        # The choice a workspace lacks is only ever a row this check filters out itself, never a 400.
        tracker, filters = Tracker([app('p1', 'Scale AI', 'SRE')]), []
        tracker.query_database = lambda db, f=None: filters.append(f) or [app('p1', 'Scale AI', 'SRE')]
        self.assertEqual([r['id'] for r in mail.applications(stores_for(tracker))], ['p1'])
        self.assertEqual(filters, [None])


if __name__ == '__main__':
    unittest.main()


class CleanMessageTests(unittest.TestCase):
    def test_a_teams_invite_keeps_only_the_message_and_folds_the_original(self):
        from src.ai import opportunity as o
        raw = ('Subject: Connect Igor / Jaya - SRE\n' + '_' * 40 + '\nMicrosoft Teams meeting\nJoin: https://teams.microsoft.com/meet/314?p=x\n'
               'Meeting ID: 314 743\nPasscode: bJ6\nDial in by phone\n+44 141 488 0901,,893664350#<tel:+441414880901> United Kingdom\n'
               'This e-mail is sent for and on behalf of Huxley Associates | Registered No. 5908145\n\nLooking forward to our call.\nJaya')
        self.assertEqual(o.clean_message(raw), 'Subject: Connect Igor / Jaya - SRE\n\nLooking forward to our call.\nJaya')
        blocks = o.message_blocks(raw)
        self.assertEqual(blocks[-1]['type'], 'toggle')  # the full original, folded
        self.assertEqual(blocks[-1]['toggle']['rich_text'][0]['text']['content'], '📧 Full message')

    def test_a_clean_message_has_no_fold(self):
        from src.ai import opportunity as o
        self.assertNotIn('toggle', [b['type'] for b in o.message_blocks('Hi Igor,\n\nA Senior SRE role in Zurich.')])


class OpportunityOnTheMemoryStoreTests(unittest.TestCase):
    """The same command without Notion (the memory store, as sqlite runs it)."""

    def setUp(self):
        from src.stores import memory
        self.s = memory.open_store({})

    def test_a_pasted_pitch_is_a_lead_with_its_message_and_event_once(self):
        line = opportunity.add_from_text(self.s, EMAIL_PITCH, client=Client(EMAIL_LEAD))
        self.assertIn('(Recruiter lead)', line)
        [job] = self.s.applications.list()
        self.assertEqual((job['stage'], job['via'], job['company'], job['origin'], job['reached_via']),
                         ('Recruiter lead', 'Example Talent', '', 'Inbound', 'Email'))
        self.assertIn('Would you be open', self.s.applications.section(job['id'], opportunity.HEADING))
        self.assertEqual([e['kind'] for e in self.s.events.list(app_id=job['id'])], ['Recruiter lead'])
        self.assertTrue(opportunity.add_from_text(self.s, EMAIL_PITCH + '\n', client=Client(EMAIL_LEAD)).startswith('Already tracked'))
        self.assertEqual(len(self.s.applications.list()), 1)

    def test_older_leads_get_reached_via_from_their_notes(self):
        old = self.s.applications.create({'url': 'https://x.test/o1', 'title': 'SRE', 'notes': 'Recruiter message (LinkedIn). x'},
                                         'Recruiter lead')
        self.assertEqual(opportunity.backfill_reached(self.s), 1)
        self.assertEqual(self.s.applications.get('https://x.test/o1')['reached_via'], 'LinkedIn')
        self.assertEqual(opportunity.backfill_reached(self.s), 0, old['id'])
