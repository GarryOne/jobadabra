"""Constants of the Gmail check: model, state file, sender lists, kinds, stage ranks, the classifier's schema and prompt.
Guarded by tests/test_mail_classify.py and tests/test_mail_shapes.py."""
import os

from .. import tz
from ..notion.ledger import REPLY
from ..paths import DATA
from . import opportunity
from .. import feedback as employer_feedback
from .models import SMALL_MODEL


DEFAULT_MODEL = os.getenv('JOB_PILOTTO_MAIL_MODEL') or SMALL_MODEL
TZ = tz.local_zone()
STATE_FILE = DATA / 'mail-state.json'
# Senders that only write about applications: ATSs, recruiter platforms, schedulers.
SENDER_DOMAINS = ('greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'smartrecruiters.com',
                  'myworkday.com', 'myworkdayjobs.com', 'personio.de', 'personio.com', 'recruitee.com', 'teamtailor.com',
                  'join.com', 'bamboohr.com', 'jobvite.com', 'icims.com', 'techtree.dev', 'cal.com', 'calendly.com',
                  'goodtime.io', 'devskiller.com', 'thomas.co', 'hackerrank.com', 'codility.com', 'coderpad.io')
# Recruitment agencies: their emails name the candidate and a short role ("Connect Igor / Jaya - SRE"), rarely a
# subject word below, and the employer is often hidden, so no tracked company matches either.
RECRUITER_DOMAINS = ('huxley.com', 'hays.com', 'hays.ch', 'hays.de', 'michaelpage.com', 'michaelpage.ch', 'pagegroup.com',
                     'robertwalters.com', 'robertwalters.ch', 'randstad.com', 'randstad.ch', 'adecco.com', 'adecco.ch',
                     'experis.com', 'experis.ch', 'harveynash.com', 'akkodis.com', 'modis.com', 'computerfutures.com',
                     'frankgroup.com', 'jeffersonfrank.com', 'nigelfrank.com', 'masonfrank.com', 'sthree.com',
                     'progressive.com', 'oliverjames.com', 'harnham.com', 'wearehirehive.com', 'kforce.com', 'kellyservices.ch')
# Emailed calendar invitations carry an invite.ics: an interview booked by someone the check doesn't know yet.
INVITES = 'filename:invite.ics'
# Google's own wrappers around an invitation (an unknown sender's booking, the notification once it is accepted): the
# attachment's file name is not a safe thing to rely on alone (2 Oct 2026: a Calendly booking was never found).
INVITE_MAILS = ('from:calendar-notification@google.com', 'subject:"Invitation from an unknown sender"', 'filename:ics')
# LinkedIn's own notification emails for a new message or InMail (the owner's mail, not LinkedIn scraping).
LINKEDIN_SENDERS = ('messages-noreply@linkedin.com', 'inmail-hit-reply@linkedin.com')
OUTREACH = 'Recruiter outreach'
YOU_REPLIED = 'Replied'  # the event Focus's Done writes when you answered (src/focus.py REPLIED)
KINDS = ['Confirmation received', REPLY, 'Interview scheduled', 'Rejected', 'Offer', OUTREACH, 'Other', employer_feedback.RECEIVED]
# Stage order for "forward only": an email never moves an application back.
RANK = {stage: i for i, stage in enumerate((opportunity.LEAD_STAGE, 'Applied', 'No response', 'Confirmation received', 'Screening',
                                            'Interview scheduled', 'Interviewing', 'Offer'))}
TERMINAL = {'Rejected', 'Withdrawn', 'Offer'}
BATCH = 8

SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['results'],
    'properties': {'results': {'type': 'array', 'items': {
        'type': 'object', 'additionalProperties': False,
        'required': ['index', 'relevant', 'application', 'company', 'role', 'kind', 'interview_at', 'interview_zone', 'summary', 'feedback'],
        'properties': {
            'index': {'type': 'integer'},
            'relevant': {'type': 'boolean', 'description': "About one of the owner's own job applications"},
            'application': {'type': 'integer', 'description': 'Index in the applications list, or -1'},
            'company': {'type': 'string', 'description': 'Hiring company (or platform) named in the item'},
            'role': {'type': 'string', 'description': 'Exact role title the item names (with its location suffix, e.g. "| Spain | Remote"), else ""'},
            'kind': {'type': 'string', 'enum': KINDS},
            'interview_at': {'type': 'string', 'description': 'Start of a scheduled call/interview as the clock time written, YYYY-MM-DDTHH:MM:SS with no offset, else ""'},
            'interview_zone': {'type': 'string', 'description': 'IANA time zone of that clock time (e.g. Europe/Zurich), "" when the item names none'},
            'summary': {'type': 'string', 'description': 'What happened, max 120 characters, no personal data'},
            'feedback': {'type': 'string', 'description': 'Verbatim specific employer assessment, else empty. Exclude quoted old mail, generic rejections and candidate requests.'},
        }}}},
}

SYSTEM = """You sort the job-search emails (and calendar events) of the owner of Jobadabra. For each item:
- "Feedback received" = an employer's assessment following a rejection, or feedback during an ongoing process.
  A rejection containing specific feedback stays "Rejected" with feedback filled. The email that turns the
  application down is always "Rejected", even when it adds that no individual feedback is given (feedback empty).
  Only a later reply refusing feedback, on a job whose stage is already Rejected, counts as Feedback received:
  quote the refusal, so no further request is suggested.
- feedback: quote the employer's specific reasons or assessment verbatim, never infer them. Empty for generic
  "other candidates were a better fit" wording. Exclude candidate requests and old messages quoted below a reply.
- relevant: true only when it is about one of the owner's own applications or hiring processes, or a recruiter or \
hiring person writes to the owner personally about a specific role. Automated job alerts, newsletters, marketing, \
"jobs you may like", other people's mail, and one-time sign-in or security codes (even when an applicant system sends \
them about an application: a code is no news about it) are not relevant.
- application: the index of the matching application from the list, or -1 if none fits. When the owner applied \
to several roles at one company, pick the one whose title the item names; if it names none, pick -1 unless only \
one role at that company is open. Recruiter platforms (e.g. TechTree) may hide the employer: match on the \
platform ("Via") and role title.
- kind: "Confirmation received" = automatic acknowledgement that the application arrived. "Reply received" = a \
person or process answered without a time being fixed yet: an invitation to book or pick a slot, an assessment \
or test link, a recruiter's message. "Interview scheduled" = a specific call or interview was booked for a stated \
time (the booking confirmation or calendar invite itself), or the employer invites the owner to one at a date and time \
it states, even when it asks them to confirm; an invitation to choose or book a slot themselves stays "Reply received". "Rejected" = not moving forward. "Offer" = an offer. \
\
"Recruiter outreach" = a recruiter or hiring person pitches the owner a role that isn't in the list (a first \
message, or LinkedIn's notification of one); a follow-up about a role already in the list is "Reply received". \
"Other" = relevant but none of these: reminders or "starting soon" notices for a call already booked, "still open" \
nudges, transcripts or recordings of a call, logistics.
- role: the role title exactly as the item writes it, including any location part; "" when it names none. An item \
naming a role that differs from every listed role at that company (e.g. another country) gets application -1.
- interview_at: only when a specific time is stated; the clock time as written (YYYY-MM-DDTHH:MM:SS, no UTC offset: the app works out the offset of that date) and interview_zone, its IANA time zone; "" for the zone when the item names none (the owner's own is assumed).
- summary: factual, short, no email addresses or phone numbers.
Answer for every item index."""
