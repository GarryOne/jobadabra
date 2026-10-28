import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src import focus
from src.notion.ledger import plain
from src.stores.base import APPLICATION_FIELDS, EVENT_FIELDS, INTERVIEW_FIELDS, record
from tests import zone
from tests.model_stand_ins import booking  # the model's answer (src/ai/meanings.py)

_pin, tearDownModule = zone.pinned()
setUpModule = lambda: (_pin(), booking())  # noqa: E731

NOW = datetime(2026, 9, 28, 15, 0, tzinfo=timezone.utc)  # Monday 17:00 in Zurich


def text(value):
    return {'type': 'rich_text', 'rich_text': [{'plain_text': value}]}


# Store records (src/stores/base.py). An extra is named as its Notion column with "_" for spaces (Fit_score, Via): it
# becomes that field; a Notion-shaped value is read as plain.
FIELDS = {'Fit score': 'fit', 'Rejection reason': 'rejection', 'Job URL': 'url'}


def _value(value):
    return plain(value) if isinstance(value, dict) else value


def row(page_id, company, job, stage='Applied', applied='2026-09-26', interview=None, **extra):
    fields = {'company': company, 'title': job, 'stage': stage, 'applied_on': applied or '', 'next_interview': interview or '',
              'url': f'https://x.test/{page_id}'}
    for name, value in extra.items():
        column = name.replace('_', ' ')
        fields[FIELDS.get(column, column.lower().replace(' ', '_'))] = _value(value)
    return {**record(APPLICATION_FIELDS, {'id': page_id, 'updated_at': '2026-09-28T14:00:00Z', **fields}),
            'link': f'https://notion.test/{page_id}'}


def event(page_id, kind, at, note='', source_id='', source=''):
    return record(EVENT_FIELDS, {'id': f'e-{page_id}-{kind}-{at}', 'app_id': page_id, 'kind': kind, 'at': at, 'note': note,
                                 'source_id': source_id, 'source': source})


def from_notion(page, entity='applications'):
    """A Notion row (as the engine wrote it) as the notion store reads it: the record Focus gets on Notion."""
    from src.stores import notion
    adapter = {'applications': notion.Applications, 'events': notion.Events}[entity]
    return {**adapter.__new__(adapter)._record(page), 'link': page.get('url', '')}


def reviewed_interview(app_id, day, overall='positive', next_step='', **extra):
    return record(INTERVIEW_FIELDS, {'id': f'iv-{app_id}-{day}', 'app_id': app_id, 'at': day, 'overall': overall,
                                     'next_step': next_step, **extra})



class FocusTests(unittest.TestCase):
    def test_applications_per_day_for_the_chart_count_each_application_once_a_day(self):
        # The Applied on date or an Applied event that day; one application with both counts once.
        rows = [row('a', 'A', 'SRE', applied='2026-09-28'), row('b', 'B', 'SRE', applied='2026-09-26'),
                row('c', 'C', 'SRE', applied='2026-09-10'), row('d', 'D', 'SRE', stage='Kit ready', applied=None)]
        events = [event('a', 'Applied', '2026-09-28T09:00:00Z'), event('d', 'Applied', '2026-09-28T13:00:00Z')]
        today = focus.build(rows, events, target=5, now=NOW)['today']
        self.assertEqual(len(today['history']), 14)
        self.assertEqual(today['history'][-1], {'day': '2026-09-28', 'applied': 2})
        self.assertEqual(today['history'][-3], {'day': '2026-09-26', 'applied': 1})
        self.assertEqual(today['history'][0]['day'], '2026-09-15')  # 10 Sep is older than 14 days: not shown
        self.assertEqual(today['applied'], 2)  # the same count as the chart's today

    def test_answers_come_first_then_interviews_then_applying(self):
        rows = [row('a', 'Duvo.ai', 'SRE', stage='Screening'), row('b', 'Zephyr AI', 'Infra', stage='Screening'),
                row('c', 'Scale AI', 'Infra', interview='2026-09-29T09:00:00+02:00', stage='Interview scheduled'),
                row('d', 'Grafana Labs', 'SRE UK', stage='Kit ready', applied=None, Fit_score={'type': 'number', 'number': 76})]
        events = [event('a', 'Reply received', '2026-09-27T10:00:00Z', 'Asked for times', 'gm1'),
                  event('b', 'Reply received', '2026-09-28T08:00:00Z', 'Please book a slot on Calendly', 'gm2'),
                  event('b', 'Replied', '2026-09-28T09:00:00Z')]
        result = focus.build(rows, events, target=30, now=NOW)
        kinds = [(i['kind'], i['company']) for i in result['items']]
        self.assertEqual(kinds[:3], [('reply', 'Duvo.ai'), ('prepare', 'Scale AI'), ('apply', '')])
        reply = result['items'][0]
        self.assertEqual((reply['link'], reply['done']), ('https://mail.google.com/mail/u/0/#all/gm1', True))
        self.assertIn('yesterday', reply['detail'])
        self.assertIn('1 kit ready (Grafana Labs…)', result['items'][2]['detail'])
        self.assertNotIn('Zephyr AI', [c for _, c in kinds])  # answered: a Replied event came after
        self.assertEqual(result['summary'], 'Reply to recruiters first, then prepare for your interview.')
        self.assertEqual(result['items'][2]['meta'], ['1 application kit ready to review', '0 of 30 today'])

    def test_a_recruiter_pitch_links_to_its_email_and_shows_the_facts(self):
        lead = row('a', '', 'Senior DevOps Engineer', stage='Recruiter lead', applied=None, Via='AG Talent',
                   Salary='€70–90k + equity', Location='Remote (Europe)', Contact='Arjun Gillard · a@agtalent.co.uk',
                   Reached_via={'type': 'select', 'select': {'name': 'Email'}})
        lead['url'] = 'https://mail.google.com/mail/u/0/#all/1a0e86124ae7e2f5'
        item = focus.build([lead], [event('a', 'Recruiter lead', '2026-09-28T14:17:00Z', 'Recruiter message: …')], now=NOW)['items'][0]
        self.assertEqual(item['title'], 'Reply by email: AG Talent — Senior DevOps Engineer')
        self.assertEqual(item['link'], 'https://mail.google.com/mail/u/0/#all/1a0e86124ae7e2f5')
        self.assertEqual(item['detail'], 'Recruiter pitch today (Email). €70–90k + equity · Remote (Europe) · Arjun Gillard')
        self.assertEqual((item['icon'], item['badge'], item['headline']), ('mail', 'Reply today', 'Reply to AG Talent recruiter'))
        self.assertEqual(item['meta'], ['Senior DevOps Engineer', 'Email', '€70–90k + equity', 'Remote (Europe)'])

    def test_a_booking_invite_and_an_offer(self):
        rows = [row('a', 'Acme', 'SRE', stage='Screening'), row('b', 'Zeta', 'SRE', stage='Offer')]
        events = [event('a', 'Reply received', '2026-09-28T08:00:00Z', 'Pick a time that works for you'),
                  event('b', 'Offer', '2026-09-28T09:00:00Z', 'CHF 160k')]
        self.assertEqual([i['kind'] for i in focus.build(rows, events, now=NOW)['items']][:2], ['offer', 'book'])
        self.assertEqual({i['place'] for i in focus.build(rows, events, now=NOW)['items'][:2]}, {'up_next'}, 'they cannot wait')

    def test_the_daily_target_counts_todays_applications(self):
        rows = [row('a', 'A', 'x', applied='2026-09-28'), row('b', 'B', 'y', applied='2026-09-20'), row('c', 'C', 'z', applied='2026-09-20')]
        events = [event('b', 'Applied', '2026-09-28T09:00:00+02:00')]
        result = focus.build(rows, events, target=3, now=NOW)
        self.assertEqual({k: v for k, v in result['today'].items() if k != 'history'}, {'applied': 2, 'target': 3, 'kits_ready': 0})
        apply = next(i for i in result['items'] if i['kind'] == 'apply')
        self.assertEqual(apply['title'], 'Apply to 1 more job today')
        self.assertFalse(any(i['kind'] == 'apply' for i in focus.build(rows, events, target=2, now=NOW)['items']))
        waiting = next(i for i in result['items'] if i['kind'] == 'waiting')
        self.assertIn('2 applications waiting', waiting['title'])  # b and c: applied 8 days ago, no human reply
        self.assertIsNone(waiting['place'], 'no button: it leaves Focus (owner, 28 Oct 2026)')
        self.assertEqual((apply['place'], apply['topic']), ('suggestions', 'applying'), 'a target, not a deadline: a suggestion')

    def test_after_an_interview_review_it_and_a_quiet_screening_gets_a_nudge(self):
        rows = [row('a', 'Acme', 'SRE', stage='Interviewing', interview='2026-09-27T14:00:00+02:00'),
                row('b', 'Beta', 'SRE', stage='Screening')]
        events = [event('b', 'Screening', '2026-09-22T10:00:00Z')]
        kinds = [i['kind'] for i in focus.build(rows, events, now=NOW)['items']]
        self.assertEqual(kinds[:2], ['happened', 'nudge'])  # nothing recorded: did it happen?
        saved = [reviewed_interview('a', '2026-09-27', overall='')]
        kinds = [i['kind'] for i in focus.build(rows, events, saved, now=NOW)['items']]
        self.assertIn('review', kinds)  # recorded, not reviewed: one item, review it
        self.assertNotIn('happened', kinds)
        saved[0]['overall'] = 'positive'
        self.assertNotIn('review', [i['kind'] for i in focus.build(rows, events, saved, now=NOW)['items']])

    def test_rejected_jobs_leave_the_list_but_their_lesson_is_shown(self):
        rows = [row('a', 'Canonical', 'SRE', stage='Rejected', Rejection_lesson='Lead with Python.',
                    Rejection_reason={'type': 'select', 'select': {'name': 'Hard skills'}})]
        events = [event('a', 'Reply received', '2026-09-28T08:00:00Z')]
        result = focus.build(rows, events, target=0, now=NOW)
        self.assertEqual(result['items'], [])
        lesson, = [e for e in result['suggestions'] if e['kind'] == 'rejection']   # Focus's Insight card became Suggestions (insights PR 1a)
        self.assertEqual((lesson['source'], lesson['title']), ('Hard skills', 'Lead with Python'))
        self.assertEqual(result['summary'], "You're up to date. A good moment to apply to a few more jobs.")

    def test_a_long_lesson_sentence_is_not_cut_mid_sentence(self):
        lesson = "Fast rejection suggests CV didn't match the Data Infrastructure posting's keywords or requirements, despite strong cloud experience"
        rows = [row('a', 'Canonical', 'SRE', stage='Rejected', Rejection_lesson=lesson + '. Next time: tailor.')]
        events = [event('a', 'Reply received', '2026-09-28T08:00:00Z')]
        result = focus.build(rows, events, target=0, now=NOW)
        self.assertEqual([e['title'] for e in result['suggestions'] if e['kind'] == 'rejection'], [lesson])

    def test_the_funnel_counts_each_step_from_the_same_rows(self):
        rows = [row('a', 'A', 'x', stage='Rejected'), row('b', 'B', 'y', stage='Screening'), row('c', 'C', 'z', stage='Kit ready', applied=None)]
        events = [event('a', 'Reply received', '2026-09-27T10:00:00Z')]
        funnel = {s['step']: s for s in focus.build(rows, events, now=NOW)['funnel']['steps']}
        self.assertEqual([funnel[k]['reached'] for k in ('📝 Prepared', '📨 Applied', '💬 Human reply', '📞 Screening')], [3, 2, 2, 1])
        # Each step names every application that ever reached it (a rejected one stays), for the Jobs list a click shows.
        self.assertEqual(funnel['💬 Human reply']['urls'], ['https://x.test/a', 'https://x.test/b'])
        self.assertEqual(funnel['📞 Screening']['urls'], ['https://x.test/b'])

    def test_the_funnel_counts_outbound_only_and_inbound_apart(self):
        select = lambda name: {'type': 'select', 'select': {'name': name}}
        rows = [row('a', 'A', 'x', stage='Screening', Source=select('Job Pilotto app')),  # you applied: outbound
                row('b', 'B', 'y', stage='Applied', Source=select('Gmail')),  # a confirmation email: outbound
                row('l', 'Agency', 'SRE', stage='Recruiter lead', applied=None, Source=select('Gmail')),
                row('m', 'Acme', 'SRE', stage='Screening', applied=None, Source=select('Job Pilotto app'),
                    Notes='Recruiter message (Email). Client: fintech'),
                row('n', 'Beta', 'SRE', stage='Interviewing', applied=None, Source=select('LinkedIn')),
                row('o', 'Old', 'SRE', stage='Rejected', applied=None, Source=select('Phone'))]
        events = [event('o', 'Screening', '2026-09-20T10:00:00Z')]
        result = focus.build(rows, events, now=NOW)['funnel']
        steps = {s['step']: s['reached'] for s in result['steps']}
        self.assertEqual([steps[k] for k in ('📝 Prepared', '📨 Applied', '📞 Screening', '🧑‍💻 Interviews')], [2, 2, 1, 0])
        inbound = result['inbound']
        self.assertEqual({k: inbound[k] for k in ('contacted', 'screening', 'interviews', 'offers')},
                         {'contacted': 4, 'screening': 3, 'interviews': 1, 'offers': 0})
        # The Inbound funnel card: ever reached, share of those who contacted you, and the links a click lists.
        self.assertEqual([(s['step'], s['reached']) for s in inbound['steps']],
                         [('📥 Contacted you', 4), ('📞 Screening', 3), ('🧑‍💻 Interviews', 1), ('🏆 Offers', 0)])
        self.assertEqual(inbound['steps'][1]['of_contacted'], 0.75)
        self.assertEqual(inbound['steps'][0]['urls'], ['https://x.test/l', 'https://x.test/m', 'https://x.test/n', 'https://x.test/o'])
        self.assertEqual(inbound['steps'][1]['urls'], ['https://x.test/m', 'https://x.test/n', 'https://x.test/o'])
        self.assertEqual(inbound['steps'][2]['urls'], ['https://x.test/n'])
        # Inbound rows are in no outbound step's links.
        outbound_urls = {u for s in result['steps'] for u in s['urls']}
        self.assertEqual(outbound_urls, {'https://x.test/a', 'https://x.test/b'})
        # No Source at all: outbound, as before; no inbound steps reached.
        plain_rows = [row('a', 'A', 'x', stage='Applied')]
        empty = focus.build(plain_rows, [], now=NOW)['funnel']['inbound']
        self.assertEqual((empty['contacted'], [s['reached'] for s in empty['steps']]), (0, [0, 0, 0, 0]))

    def test_the_first_contact_decides_the_focus_funnel_side(self):
        # Applied, then the recruiter answered: outbound; the recruiter wrote first, then you applied: inbound.
        rows = [row('e', 'E', 'SRE', stage='Screening'), row('f', 'F', 'SRE', stage='Screening')]
        events = [event('e', 'Recruiter lead', '2026-09-10T09:00:00Z'), event('e', 'Applied', '2026-09-01T09:00:00Z'),
                  event('f', 'Applied', '2026-09-10T09:00:00Z'), event('f', 'Recruiter lead', '2026-09-01T09:00:00Z')]
        result = focus.build(rows, events, now=NOW)['funnel']
        self.assertEqual(result['inbound']['steps'][0]['urls'], ['https://x.test/f'])
        self.assertEqual(result['steps'][1]['urls'], ['https://x.test/e'])

    def test_reminder_only_when_worth_it(self):
        calm = {'today': {'applied': 30, 'target': 30, 'kits_ready': 0}, 'items': []}
        self.assertEqual(focus.reminder(calm, now=NOW), '')
        busy = {'today': {'applied': 4, 'target': 30, 'kits_ready': 6},
                'items': [{'kind': 'reply', 'company': 'Duvo.ai', 'priority': 1}]}
        text = focus.reminder(busy, now=NOW)
        self.assertIn('1 person waits for your answer: Duvo.ai', text)
        self.assertIn('4/30 applications today; 6 kits ready', text)


if __name__ == '__main__':
    unittest.main()


class NotionIdTests(unittest.TestCase):
    def test_an_event_finds_its_job_with_or_without_the_ids_dashes(self):
        rows = [row('aaaa-bbbb', 'Acme', 'SRE', stage='Screening')]
        events = [event('aaaabbbb', 'Reply received', '2026-09-28T08:00:00Z', 'Can we talk?', 'gm1')]
        items = focus.build(rows, events, target=0, now=NOW)['items']
        self.assertEqual([(i['kind'], i['company']) for i in items], [('reply', 'Acme')])


class AfterInterviewTests(unittest.TestCase):
    """The owner's Huxley case (30 Sep 2026): after the call, Focus said "Move Huxley forward · nothing booked"."""

    @staticmethod
    def reviewed(page_id, day, next_step='Call with the CTO next week'):
        return reviewed_interview(page_id, day, next_step=next_step)

    def test_nothing_recorded_after_the_time_asks_if_it_happened_one_item_per_interview(self):
        rows = [row('h', 'Huxley', 'Principal SRE', stage='Interview scheduled', interview='2026-09-20T08:30:00+02:00')]
        items = focus.build(rows, [], now=NOW)['items']
        asked = [i for i in items if i['job'] == 'Principal SRE']
        self.assertEqual([i['kind'] for i in asked], ['happened'])  # no 3-day limit, and no nudge next to it
        self.assertEqual(asked[0]['headline'], 'Interview with Huxley')
        self.assertEqual(asked[0]['badge'], 'Did it happen?')

    def test_after_a_reviewed_interview_it_waits_calmly_then_nudges_after_quiet_days(self):
        # The review moved it to Interviewing and cleared the past date; Stage left at Interview scheduled works too.
        for stage, interview in (('Interviewing', None), ('Interview scheduled', '2026-09-27T08:30:00+02:00')):
            rows = [row('h', 'Huxley', 'Principal SRE', stage=stage, interview=interview)]
            events = [event('h', 'Interview scheduled', '2026-09-20T10:00:00Z')]
            item, = [i for i in focus.build(rows, events, [self.reviewed('h', '2026-09-27')], now=NOW)['items'] if i['job']]
            self.assertEqual((item['kind'], item['headline'], item['badge']), ('waiting', "Waiting for Huxley's next step", 'Waiting'))
            self.assertIn('Call with the CTO next week', item['meta'])
            self.assertIn('Call with the CTO next week', item['detail'])
        rows = [row('h', 'Huxley', 'Principal SRE', stage='Interviewing')]
        focus_ = focus.build(rows, events, [self.reviewed('h', '2026-09-27')], now=NOW)
        self.assertNotIn('Follow up on applications waiting', focus_['summary'])
        # QUIET_DAYS without news since the interview: now it's a nudge.
        quiet = focus.build(rows, events, [self.reviewed('h', '2026-09-24')], now=NOW)['items']
        nudge, = [i for i in quiet if i['job']]
        self.assertEqual(nudge['kind'], 'nudge')
        self.assertIn('No news for 4 days since the interview', nudge['detail'])
        # News after the interview (the Gmail check logged a step) restarts the quiet time.
        news = events + [event('h', 'Interviewing', '2026-09-27T09:00:00Z')]
        self.assertEqual([i['kind'] for i in focus.build(rows, news, [self.reviewed('h', '2026-09-24')], now=NOW)['items'] if i['job']],
                         ['waiting'])
        # A month of silence after an interview isn't a to-do any more.
        self.assertEqual([i for i in focus.build(rows, [], [self.reviewed('h', '2026-08-20')], now=NOW)['items'] if i['job']
                          and i['stage'] == 'Interviewing'], [])


def interview(page_id, app_id, day, round_='Recruiter screen', overall='positive', created=None):
    return record(INTERVIEW_FIELDS, {'id': page_id, 'app_id': app_id, 'at': day, 'round': round_, 'overall': overall or '',
                                     'created_at': created or f'{day}T12:00:00.000Z'})


class PrepKitStaleTests(unittest.TestCase):
    """30 Sep 2026: Huxley's 29 Sep kit (for the recruiter screen, held and reviewed 30 Sep) showed as "prep kit ready"
    for the 1 Oct follow-up. A kit is current only if built after the application's latest reviewed interview."""
    AT = datetime(2026, 9, 30, 18, 0, tzinfo=timezone.utc)

    def prepare(self, interviews=(), events=(), prep='2026-09-29'):
        huxley = row('h1', 'Huxley', 'Principal SRE', stage='Interviewing', interview='2026-10-01T08:30:00+02:00',
                     Interview_prep={'type': 'date', 'date': {'start': prep}})
        items = focus.build([huxley], list(events), list(interviews), target=0, now=self.AT)['items']
        return next(i for i in items if i['kind'] == 'prepare')

    def test_no_review_yet_the_kit_is_current(self):
        item = self.prepare()
        self.assertFalse(item['prep_stale'])
        self.assertEqual(item['meta'][1], '✓ prep kit ready')

    def test_a_review_after_the_kit_makes_it_stale(self):
        item = self.prepare([interview('iv1', 'h1', '2026-09-30')])
        self.assertTrue(item['prep_stale'])
        self.assertEqual(item['prep_reason'], 'Kit from 29 Sep · your call on 30 Sep was reviewed since')
        self.assertEqual(item['meta'][1], item['prep_reason'])  # the card says why, not "ready"
        self.assertEqual(item['prep_since'], '2026-09-30')
        self.assertIn('build a new kit for this round (about $0.04)', item['detail'])

    def test_a_kit_built_after_the_review_is_current(self):
        reviewed = interview('iv1', 'h1', '2026-09-30', created='2026-09-30T09:40:00.000Z')
        self.assertFalse(self.prepare([reviewed], prep='2026-09-30T15:00:00+00:00')['prep_stale'])
        self.assertFalse(self.prepare([reviewed], prep='2026-10-01')['prep_stale'])  # an older kit dated without a time
        # Built the morning of the call, reviewed after it: that kit was for that call.
        self.assertTrue(self.prepare([reviewed], prep='2026-09-30T05:00:00+00:00')['prep_stale'])
        self.assertTrue(self.prepare([reviewed], prep='2026-09-30')['prep_stale'])

    def test_an_unreviewed_or_unrelated_interview_is_ignored(self):
        self.assertFalse(self.prepare([interview('iv1', 'h1', '2026-09-30', overall='')])['prep_stale'])  # saved, not reviewed
        self.assertFalse(self.prepare([interview('iv2', 'other', '2026-09-30')])['prep_stale'])  # another application's

    def test_the_interview_booked_or_moved_after_the_kit_makes_it_stale(self):
        moved = event('h1', 'Interview scheduled', '2026-09-30T11:00:00Z', 'Moved to Thu 08:30')
        item = self.prepare(events=[moved])
        self.assertTrue(item['prep_stale'])
        self.assertEqual(item['prep_reason'], 'Kit from 29 Sep · the interview was booked or moved on 30 Sep')
        booked_before = event('h1', 'Interview scheduled', '2026-09-29T08:00:00Z')
        self.assertFalse(self.prepare(events=[booked_before])['prep_stale'])

    def test_no_kit_yet_is_not_stale(self):
        item = self.prepare([interview('iv1', 'h1', '2026-09-30')], prep='')
        self.assertFalse(item['prep_stale'])
        self.assertEqual(item['meta'][1], 'posting, kit and weak topics')


class AddDetailsTests(unittest.TestCase):
    def test_an_interview_known_only_from_the_invitation_asks_for_the_details(self):
        invite = row('h1', '', 'Connect Igor / Jaya - SRE', stage='Interview scheduled', applied=None,
                     interview='2026-09-30T08:30:00+02:00', Via='Huxley')
        invite['url'] = 'https://mail.google.com/mail/u/0/#all/h1'
        known = row('k1', 'Acme', 'SRE', stage='Interview scheduled', interview='2026-10-02T10:00:00+02:00', Salary='CHF 150k')
        items = focus.build([invite, known], [], target=0, now=NOW)['items']
        asks = [i for i in items if i['kind'] == 'details']
        self.assertEqual(len(asks), 1)
        self.assertEqual(asks[0]['title'], 'Add details: Huxley — Connect Igor / Jaya - SRE')
        self.assertEqual(asks[0]['missing'], ['company', 'salary', 'job description'])
        self.assertIn('Wed 30 Sep, 08:30', asks[0]['detail'])
        self.assertIn('prepare', [i['kind'] for i in items])  # still reminded to prepare

    def test_a_named_employer_without_pay_or_posting_still_asks(self):
        lead = row('l1', 'Acme', 'SRE', stage='Interview scheduled')
        lead['url'] = 'https://www.linkedin.com/messaging/#jp-abc'
        asks = [i for i in focus.build([lead], [], target=0, now=NOW)['items'] if i['kind'] == 'details']
        self.assertEqual(asks[0]['missing'], ['salary', 'job description'])

    def test_once_you_logged_details_it_stops_asking(self):
        invite = row('h1', '', 'Principal SRE', stage='Interview scheduled', interview='2026-09-30T08:30:00+02:00', Via='Huxley')
        invite['url'] = 'https://mail.google.com/mail/u/0/#all/h1'
        logged = event('h1', 'Interview scheduled', '2026-09-29T13:23:00Z', source_id='paste:abc')
        kinds = [i['kind'] for i in focus.build([invite], [logged], target=0, now=NOW)['items']]
        self.assertNotIn('details', kinds)
        self.assertIn('prepare', kinds)

    def test_the_hidden_client_is_not_asked_once_the_call_was_reviewed_and_the_headline_names_the_gap(self):
        invite = row('h1', '', 'Principal SRE', stage='Interview scheduled', interview='2026-10-01T08:30:00+02:00', Via='Huxley')
        invite['url'] = 'https://mail.google.com/mail/u/0/#all/h1'
        ask = [i for i in focus.build([invite], [], target=0, now=NOW)['items'] if i['kind'] == 'details'][0]
        self.assertEqual(focus.present(ask)['headline'], 'Who is the employer behind Huxley?')
        reviewed = [interview('iv1', 'h1', '2026-09-30')]
        items = focus.build([invite], [], reviewed, target=0, now=NOW)['items']
        details = [i for i in items if i['kind'] == 'details']
        self.assertEqual([i['missing'] for i in details], [['salary', 'job description']])
        self.assertEqual(focus.present(details[0])['headline'], 'Tell Jobadabra about the Huxley interview')

    def test_skip_means_you_dont_know_the_employer_yet_for_this_interview(self):
        invite = row('a1', '', 'Senior DevOps Engineer', stage='Interview scheduled', Via='AG Talent',
                     interview='2026-10-02T08:30:00+02:00', Salary='€70k–90k')
        token = focus.details_token(focus._when('2026-10-02T08:30:00+02:00'), 'Interview scheduled')
        skipped = event('a1', 'Details skipped', '2026-10-01T12:00:00Z', "You don't know the employer yet",
                        f'skip-details:{token}', 'Job Pilotto app')
        self.assertFalse([i for i in focus.build([invite], [skipped], target=0, now=NOW)['items'] if i['kind'] == 'details'])
        # Notion may hand the same moment back as Z. The skip was stored with the offset it had that day.
        as_z = row('a1', '', 'Senior DevOps Engineer', stage='Interview scheduled', Via='AG Talent',
                   interview='2026-10-02T06:30:00.000Z', Salary='€70k–90k')
        older = event('a1', 'Details skipped', '2026-10-01T12:00:00Z', "You don't know the employer yet",
                      'skip-details:2026-10-02T08:30:00+02:00', 'Job Pilotto app')
        self.assertFalse([i for i in focus.build([as_z], [older], target=0, now=NOW)['items'] if i['kind'] == 'details'])
        # A later round is a new ask: the client may have been named by then.
        later = row('a1', '', 'Senior DevOps Engineer', stage='Interview scheduled', Via='AG Talent',
                    interview='2026-10-20T08:30:00+02:00', Salary='€70k–90k')
        self.assertTrue([i for i in focus.build([later], [skipped], target=0, now=NOW)['items'] if i['kind'] == 'details'])
        self.assertTrue([i for i in focus.build([later], [older], target=0, now=NOW)['items'] if i['kind'] == 'details'])

    def test_only_talking_to_an_agency_with_a_hidden_employer_is_not_a_to_do(self):
        pitch = row('a1', '', 'Senior DevOps Engineer', stage='Screening', Via='AG Talent', Salary='€70k–90k')
        self.assertFalse([i for i in focus.build([pitch], [], target=0, now=NOW)['items'] if i['kind'] == 'details'])


class WaitingForYouTests(unittest.TestCase):
    def test_a_bookkeeping_stage_event_does_not_hide_the_recruiters_booking_request(self):
        # AG Talent: pitch, you replied, the recruiter sent a booking calendar, then the app wrote a Backfill "Screening".
        row_ = row('a1', '', 'Senior DevOps Engineer', stage='Screening', Via='AG Talent')
        events = [event('a1', 'Recruiter lead', '2026-09-28T14:17:00Z', source_id='m1'),
                  event('a1', 'Replied', '2026-09-29T00:23:00Z'),
                  event('a1', 'Reply received', '2026-09-29T08:41:00Z', source_id='m2',
                        note='Recruiter sent role details link and booking calendar; requested CV'),
                  event('a1', 'Screening', '2026-09-29T12:56:00Z', note='First event for an application tracked before the ledger',
                        source='Backfill')]
        items = focus.build([row_], events, target=0, now=NOW)['items']
        book = [i for i in items if i['kind'] == 'book']
        self.assertEqual(len(book), 1)
        self.assertIn('AG Talent', book[0]['title'])

    def test_a_stage_noticed_in_notion_does_not_answer_the_recruiter_either(self):
        row_ = row('a1', '', 'Senior DevOps Engineer', stage='Screening', Via='AG Talent')
        events = [event('a1', 'Reply received', '2026-09-29T08:41:00Z', note='Recruiter sent a booking calendar'),
                  event('a1', 'Screening', '2026-09-29T12:56:00Z', note='Stage changed in Notion; time is when the row was last edited',
                        source='Notion edit')]
        items = focus.build([row_], events, target=0, now=NOW)['items']
        self.assertEqual(len([i for i in items if i['kind'] == 'book']), 1)

    def test_a_booked_interview_clears_book_the_call(self):
        # The recruiter asked them to pick a time. The Gmail check then put the call on the calendar
        # (Prepare appears). Book the call is that earlier step, done — not a second to-do.
        row_ = row('a1', '', 'Senior DevOps Engineer', stage='Interview scheduled', Via='AG Talent',
                   interview='2026-10-02T08:30:00+02:00', Salary='€70k–90k')
        events = [event('a1', 'Reply received', '2026-09-28T13:40:00Z', source_id='m',
                        note='Recruiter sent a booking calendar')]
        kinds = [i['kind'] for i in focus.build([row_], events, target=0, now=NOW)['items']]
        self.assertNotIn('book', kinds)
        self.assertNotIn('reply', kinds)
        self.assertIn('prepare', kinds)

    def test_a_waiting_confirmation_does_not_hide_the_preparation_for_the_interview(self):
        row_ = row('h1', '', 'Principal SRE', stage='Interview scheduled', Via='Huxley', interview='2026-10-01T08:30:00+02:00',
                   Salary='EUR 100-150k')
        events = [event('h1', 'Reply received', '2026-09-30T07:16:00Z', note='Recruiter asks you to confirm the meeting time', source_id='m')]
        kinds = [i['kind'] for i in focus.build([row_], events, target=0, now=NOW)['items']]
        self.assertIn('reply', kinds)
        self.assertIn('prepare', kinds)

    def test_a_real_later_event_still_clears_it(self):
        row_ = row('a1', '', 'Senior DevOps Engineer', stage='Screening', Via='AG Talent')
        events = [event('a1', 'Reply received', '2026-09-29T08:41:00Z', note='Recruiter sent a booking calendar'),
                  event('a1', 'Replied', '2026-09-29T09:00:00Z')]
        items = focus.build([row_], events, target=0, now=NOW)['items']
        self.assertFalse([i for i in items if i['kind'] in ('book', 'reply')])


class LinkedInBookingTests(unittest.TestCase):
    """30 Sep 2026: a LinkedIn chat whose last message is a Calendly link showed "Reply to the recruiter" with "Open email"."""

    def items(self, source_id, note, kind='Reply received'):
        row_ = row('b1', 'Blockdaemon', 'Senior Web3 Infrastructure / DevOps Engineer', stage='Screening', Reached_via='LinkedIn')
        events = [event('b1', kind, '2026-09-30T10:33:00Z', note=note, source_id=source_id, source='Job Pilotto app')]
        return focus.build([row_], events, target=0, now=NOW)['items']

    def test_a_logged_chat_never_gets_a_gmail_link(self):
        for source_id in ('paste:3f2a9c', 'chat:8c1d02', 'cal:abc'):
            for item in self.items(source_id, 'They wrote: Hi Igor'):
                self.assertNotIn('mail.google', item.get('link', ''), source_id)
                self.assertNotEqual(item.get('link_label'), 'Open email', source_id)
        self.assertIn('mail.google', focus._gmail('18c2f0a1b2c3d4e5'))  # a real Gmail message id still does

    def test_a_booking_link_in_a_chat_is_the_calls_button(self):
        note = 'Logged: asked for a call. Booking link: https://calendly.com/discussion_meeting/meeting'
        book = [i for i in self.items('paste:3f2a9c', note) if i['kind'] == 'book']
        self.assertEqual(len(book), 1)
        self.assertEqual((book[0]['link'], book[0]['link_label']), ('https://calendly.com/discussion_meeting/meeting', 'Open booking link'))
        self.assertIn('LinkedIn', focus.present(book[0])['meta'])

    def test_a_booking_request_without_a_link_still_says_book_but_has_no_email_button(self):
        book = [i for i in self.items('paste:3f2a9c', 'Recruiter asks you to schedule a call') if i['kind'] == 'book']
        self.assertEqual((len(book), book[0]['link']), (1, ''))


class ParallelReadsTests(unittest.TestCase):
    def test_reads_run_at_the_same_time_and_keep_their_order(self):
        import threading
        from src.notion.client import together
        # Two reads at a time (workers=2, Notion's limit): each read waits at the barrier for a second one, so one at a
        # time would time out (BrokenBarrierError). No wall-clock limit, so a slow CI runner can't fail it.
        barrier = threading.Barrier(2, timeout=5)
        results = together(*[lambda n=n: (barrier.wait(), n)[1] for n in range(4)])
        self.assertEqual(results, [0, 1, 2, 3])

    def test_the_profile_page_is_read_once_per_run(self):
        from src.notion.client import Tracker
        calls = []
        tracker = Tracker('token', 'db')
        tracker._children = lambda block_id: calls.append(block_id) or [
            {'type': 'paragraph', 'paragraph': {'rich_text': [{'plain_text': 'Salary: CHF 150k'}]}}]
        self.assertEqual(tracker.page_text('p1'), tracker.page_text('p1'))
        self.assertEqual(calls, ['p1'])


class AnsweredQuestionsTest(unittest.TestCase):
    def test_the_answer_sits_next_to_the_email_that_asked(self):
        job = row('job1', 'Blockdaemon', 'SRE')
        asked = lambda needs, app_id: {**event(app_id, 'Reply received', '2026-10-02T21:30:00+02:00'), 'needs_you': needs,  # noqa: E731
                                       'changes': {'subject': 'Meeting invitation: Igor and Blockdaemon DM'}}
        self.assertEqual(focus.answered_questions([job], [asked(True, '')]), [])   # still open: Focus asks it
        done = focus.answered_questions([job], [asked(False, 'job1')])
        self.assertEqual(done[0]['subject'], 'Meeting invitation: Igor and Blockdaemon DM')
        self.assertTrue(done[0]['job'].startswith('Blockdaemon'))
        self.assertEqual(focus.answered_questions([job], [asked(False, '')])[0]['job'], '')   # "not about a job"
