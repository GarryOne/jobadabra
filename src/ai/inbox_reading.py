"""📥 Log anything, part 1: what Claude is told and how its reading is asked for (the kinds, the schema, the prompt,
the list of jobs, the call to Claude). Imported and re-exported by src/ai/inbox.py. Tests: tests/test_inbox.py.
"""
import base64
import json
import re
import sys

from ..notion.ledger import REPLY
from . import cost, mail, opportunity


DEFAULT_MODEL = opportunity.DEFAULT_MODEL
OUTREACH, APPLIED, NOT_JOB = 'Recruiter outreach', 'Applied', 'Not job-related'
KINDS = [OUTREACH, APPLIED, 'Confirmation received', REPLY, 'Interview scheduled', 'Rejected', 'Offer', NOT_JOB, mail.employer_feedback.RECEIVED]
MEDIA = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'}
MAX_JOBS = 300
LOG_HEADING = '📥 Logged'
GONE = {'Not seen', 'Closed', 'Dismissed'}
EARLY = {None, '', 'Saved', 'Kit ready', 'Applying'}  # no application sent yet
EMOJI = {**mail.EMOJI, OUTREACH: '🤝', APPLIED: '📨'}

# Whether the owner agreed to talk to the recruiter, read from the conversation itself (owner's rule, 30 Sep 2026: no
# checkbox before the reading; the confirmation step asks only when the reply is 'unclear').
AGREEMENT = ('shown', 'declined', 'none', 'unclear')
AGREE_QUESTION = 'Did you agree to talk to the recruiter?'

# What the item shows outright vs what was inferred: the app asks about everything not shown (owner's rule, 30 Sep
# 2026: never guess what can't be seen; ask in the confirmation step).
SEEN = {
    'type': 'object', 'additionalProperties': False,
    'required': ['channel', 'year', 'first_contact', 'interview', 'company', 'agreement'],
    'properties': {
        'channel': {'type': 'string', 'enum': ['shown', 'guessed', 'unknown'], 'description':
                    'shown = the platform is plainly visible (LinkedIn\'s chat UI or name, an email\'s From/Subject header); '
                    'guessed = only from the look or the wording; unknown'},
        'year': {'type': 'string', 'enum': ['shown', 'missing'], 'description':
                 'shown = the dates in the item include the year; missing = only day/month, a weekday or a time'},
        'first_contact': {'type': 'string', 'enum': ['shown', 'guessed', 'unknown'], 'description':
                          'shown = the date of the earliest message is visible; guessed; unknown'},
        'interview': {'type': 'string', 'enum': ['shown', 'partial', 'none'], 'description':
                      'shown = a call/interview with its full date and time; partial = a call mentioned without a full '
                      'date and time ("Friday at 3", "next week"); none = no call mentioned'},
        'company': {'type': 'string', 'enum': ['shown', 'guessed', 'unknown'], 'description':
                    'shown = the hiring company is named; guessed = inferred (e.g. from an agency or a logo); unknown'},
        'agreement': {'type': 'string', 'enum': list(AGREEMENT), 'description':
                      'Did the owner agree to talk? shown = the owner said yes, agreed to a call or booked one '
                      '(owner_agreed true); declined = the owner said no / not interested; none = the owner has not '
                      'replied (nothing to tell); unclear = the owner replied, but not clearly yes or no to talking'},
    },
}

# Who wrote last in the conversation shown, and when (the same single reading): Focus recommends a follow-up when your
# message got no answer (src/focus.py follow_up). The date comes from what is written ("MONDAY", "Today", "Sep 28"),
# resolved against the day it's logged by resolve_day(), never from the model's own date guess.
LAST_MESSAGE = {
    'type': 'object', 'additionalProperties': False,
    'required': ['from', 'at', 'at_text', 'text_snippet'],
    'properties': {
        'from': {'type': 'string', 'enum': ['you', 'them', 'unknown'], 'description':
                 'Who wrote the last visible message: you = the owner, them = the recruiter or employer, unknown = unclear'},
        'at': {'type': 'string', 'description': 'ISO 8601 date/time of that message only when a full date with its year is shown, else ""'},
        'at_text': {'type': 'string', 'description': 'Its day and time exactly as shown: the day divider above it and its time '
                                                     '("MONDAY 12:33 AM", "Today 09:10", "Sep 28", "28/09/2026 14:02"), else ""'},
        'text_snippet': {'type': 'string', 'description': 'Its first words, as written, at most 120 characters'},
    },
}

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['kind', 'match', 'role', 'when', 'first_contact', 'interview_at', 'feedback', 'job_description',
                 'seen', 'first_contact_text', 'interview_text', 'last_message', 'booking_link']
                + opportunity.SCHEMA['required'],
    'properties': {
        'kind': {'type': 'string', 'enum': KINDS},
        'match': {'type': 'integer', 'description': 'Index of the job in the list this is about, or -1 if none fits'},
        'role': {'type': 'string', 'description': 'Role title the item names, else ""'},
        'when': {'type': 'string', 'description': 'ISO 8601 date/time the message was sent if shown, else ""'},
        'job_description': {'type': 'string', 'description': 'Everything the item says about the role itself, as written (for screenshots: transcribed): responsibilities, stack, team, requirements, the company or client, location, work mode, contract, pay, interview process. Not greetings or small talk. "" if it says nothing about the role'},
        'first_contact': {'type': 'string', 'description': 'ISO 8601 date of the earliest message shown in the conversation (the first time they talked), else ""'},
        'interview_at': {'type': 'string', 'description': 'ISO 8601 start of a call/interview with a fixed time, with offset, else ""'},
        'feedback': {'type': 'string', 'description': 'Specific employer feedback quoted verbatim, else empty; no generic rejections or inferred reasons.'},
        'seen': SEEN,
        'first_contact_text': {'type': 'string', 'description': 'The earliest date exactly as written in the item, with the day divider above the first message and its time ("Sep 21", "MONDAY 12:33 AM", "Mon 14:02", "21/09/2026"), else ""'},
        'last_message': LAST_MESSAGE,
        'booking_link': {'type': 'string', 'description': 'The scheduling link (Calendly, Cal.com, Google Calendar, Chili Piper…) they sent for the owner to pick a time, exactly as written; "" when they sent none. Never a link the owner sent, a job posting or a profile'},
        'interview_text': {'type': 'string', 'description': 'A call/interview time exactly as written ("Friday at 3pm", "26 Sep 15:00"), else ""'},
        **opportunity.SCHEMA['properties'],
    },
}

SYSTEM = """The owner of Jobadabra pastes a message or a screenshot (LinkedIn, Gmail, WhatsApp, a job site) about their \
job search. Read it (for a screenshot, read the text in the image) and say:
- "Feedback received" = the employer's specific assessment during or after a hiring process. A rejection
  containing specific feedback stays "Rejected" with feedback filled. feedback is a verbatim quote of the
  employer's reasons or assessment; empty for generic rejections. Never turn the candidate's own request,
  quoted old messages, or a model guess into employer feedback.
- kind: "Recruiter outreach" = a recruiter or hiring person pitches a role; "Applied" = proof the owner applied (an \
application page or a copy of it); "Confirmation received" = automatic acknowledgement; "Reply received" = a person \
answered without a fixed time (booking link, test, questions, "let's chat"); "Interview scheduled" = a call booked at a \
stated time; "Rejected"; "Offer"; "Not job-related" = anything else, including people selling services to the \
owner (web design, marketing, outsourcing), networking or event invitations, and automated job alerts.
- match: the index of the job in the list below that the item is about (same company, or same agency/recruiter, and \
same role), or -1. The list includes pitches already logged: the same recruiter pitching the same role again (or the \
same message pasted twice) is that job. When the company has several roles and the item doesn't say which, answer -1.
- The other fields: only what the item states, never guesses. owner_agreed: the owner said yes / agreed to talk.
- seen: for each of channel, year, first contact, interview and company, whether the item shows it or you inferred it.
  seen.agreement: "shown" when the owner's own reply says yes / agrees to a call / books one (then owner_agreed is true); "declined" when the owner said no or not interested; "none" when the owner hasn't replied; "unclear" when the owner replied but it isn't clear whether they agreed to talk (e.g. only asked a question). Otherwise owner_agreed is false.
  Dates without a visible year: fill the ISO fields with your best reading but set seen.year "missing".
- booking_link: a link the other person sent for the owner to book a call or pick a time, exactly as written; "" if none.
- last_message: the last visible message of the conversation (for an email: that email): who wrote it (the owner = \
"you"), its day and time exactly as written (a chat's day divider such as "MONDAY" or "TODAY" above it, plus its time), \
and its first words.
The owner's own messages may be in the screenshot; the other person is the recruiter or employer."""


def candidates(stores):
    """Jobs the store knows: tracked applications first, then open Job Matches. Notion: Tracker.notion_jobs(), as before;
    another store: the same list from its applications and matches (src/desktop_store_jobs.py store_jobs)."""
    tracker = getattr(stores.applications, 'tracker', None)
    if tracker is not None:
        known = tracker.notion_jobs()
    else:
        from ..desktop_store_jobs import store_jobs
        known = store_jobs(stores)
    jobs = [j for j in known if j.get('stage') not in ('Dismissed', 'Closed')
            and (j.get('stage') or j.get('match_status') not in GONE)]
    jobs.sort(key=lambda j: (not j.get('stage'), -(j.get('fit') or 0)))
    return jobs[:MAX_JOBS]


def listing(jobs):
    return '\n'.join(f"{i}. {j.get('company') or '(employer not named)'} — {j.get('title') or '?'}"
                     f"{' · ' + j['location'] if j.get('location') else ''}"
                     f"{' · via ' + j['via'] if j.get('via') else ''}{' · recruiter ' + j['contact'] if j.get('contact') else ''}"
                     f" [{j.get('stage') or 'open job, not applied'}]" for i, j in enumerate(jobs))


def _words(text):
    return set(re.findall(r'[a-z0-9]+', (text or '').lower())) - {'senior', 'sr', 'the', 'and', 'of', 'a', 'engineer', 'remote'}


def _who(jobs, item):
    """For each tracked job: (index, same recruiter (name or email), same company/agency) as the item."""
    people = {p.lower() for p in (item.get('recruiter_name'), item.get('recruiter_email')) if p}
    orgs = {o.lower() for o in (item.get('company'), item.get('recruiter_company')) if o}
    for i, job in enumerate(jobs):
        if job.get('stage'):
            who = (job.get('contact') or '').lower()
            yield i, any(p in who for p in people), bool(orgs & ({(job.get('company') or '').lower(), (job.get('via') or '').lower()} - {''}))


def same_job(jobs, item):
    """A tracked job this item is plainly about when Claude found none: the same recruiter (name or email) or the
    same company/agency, and the same role words. Pasting one pitch twice (even a new screenshot of it) lands here."""
    role = _words(item.get('role') or item.get('title'))
    for i, same_person, same_org in _who(jobs, item):
        title = _words(jobs[i].get('title'))
        same_role = bool(role and title) and (role <= title or title <= role or len(role & title) >= 2)
        if (same_person or same_org) and (same_role or (same_person and not role)):
            return i
    return -1


def related(jobs, item):
    """Tracked jobs from the same recruiter or company/agency as the item (same_job's first test, whatever the role):
    the candidates for "Which job is this?" when Claude found none."""
    return [i for i, same_person, same_org in _who(jobs, item) if same_person or same_org]


def _job_choice(job):
    return {'url': job['url'], 'stage': job.get('stage') or '',
            'label': ' · '.join(p for p in (job.get('company') or job.get('via') or '—', job.get('title') or '?') if p)}


MAX_IMAGES = 5  # screenshots per log: a long LinkedIn chat takes a few


def images_of(image):
    """One screenshot, several, or none, as a list of (name, bytes, media type)."""
    return list(image[:MAX_IMAGES]) if isinstance(image, list) else ([image] if image else [])


def read(client, model, text, image, jobs, stats=None):
    """Claude's reading: a dict with SCHEMA's fields. image = (name, bytes, media type), a list of them, or None
    (several screenshots of one conversation are read together, in order)."""
    content = []
    for shot in images_of(image):
        content.append({'type': 'image', 'source': {'type': 'base64', 'media_type': shot[2],
                                                     'data': base64.b64encode(shot[1]).decode()}})
    content.append({'type': 'text', 'text': (text[:8000] if text else '(see the screenshots)' if len(content) > 1 else '(see the screenshot)')})
    response = client.messages.create(
        model=model, max_tokens=1200,
        system=[{'type': 'text', 'text': SYSTEM + '\n\nJobs:\n' + (listing(jobs) or '(none)'),
                 'cache_control': {'type': 'ephemeral'}}],  # several pastes in a row read the job list once
        messages=[{'role': 'user', 'content': content}],
        output_config={'format': {'type': 'json_schema', 'schema': SCHEMA}},
    )
    cost.add(stats, model, response.usage)
    return json.loads(next(b.text for b in response.content if b.type == 'text'))


def step(text):
    """A progress line for the app's Log box ("⏳ …", on stderr; the app shows the latest with a timer)."""
    print(f'⏳ {text}', file=sys.stderr, flush=True)
