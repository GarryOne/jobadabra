"""The Gmail pass: search, classify, and decide for each new email (record, ask, lead or skip).
Guarded by tests/test_mail_run.py and tests/test_mail_shapes.py."""
from html import escape
import re
import sys

from .. import tgcard, tz
from ..notion import ledger
from ..notion.ledger import REPLY
from . import cost, mail_triage
from .mail_config import OUTREACH, TZ
from .mail_leads import TRACKABLE, _from_email, interview_lead, new_lead
from .mail_lines import _head, _label, _short, _who, ask
from .mail_match import ENDED, _about_tracked, _ambiguous, _by_mention, _names_it, _names_person, _sender_org
from .mail_read import _field, _unread_invitation, _when, classify, extra_query, query, verified_feedback
from .mail_record import changes_readable, gmail_link, record


def mail_pass(stores, google, client, model, apps, index, state, days, stats, dry_run=False, now=None, rejected=None,
              on_new=None):
    """Process new emails; returns (lines for Telegram, count classified)."""
    seen = set(state['seen'])
    found = list(dict.fromkeys(google.search(query(apps, days), limit=60) + google.search(extra_query(days), limit=30) + google.search(mail_triage.subject_query(days), limit=60)))
    # Any other new inbox email: Claude says whether it is about your job search, in any language (src/ai/mail_triage.py).
    job, other = mail_triage.new_from_inbox(google, client, days, set(found), seen | set(index[0]), stats)
    if not dry_run:
        state['seen'] += other   # judged once: not about your job search
    ids = [i for i in dict.fromkeys(found + job) if i not in seen and i not in index[0]]
    emails = sorted((google.message(i) for i in ids), key=lambda m: m['date'])
    if not emails:
        return [], 0
    limited = False
    try:
        results = classify(client, model, apps, emails, stats)
    except Exception as error:  # noqa: BLE001 — only the spend limit is handled here
        if not cost.limit_reached(error):
            raise
        limited, results = True, without_ai(apps, emails)
        print('Mail check: the Anthropic API spend limit is reached. Only calendar invitations from a tracked job\'s '
              'contact were read; the other emails stay unread for the next check.', file=sys.stderr)
    lines = []
    trail = []  # one record per email read: what it was, what the check concluded, and what it did — for the run's page
    def note(email, action, label='', changes='', link=''):
        record = {'subject': email.get('subject', ''), 'from': email.get('from', ''), 'at': email.get('date', ''),
                  'action': action, 'label': label, 'changes': changes, 'link': link or gmail_link(email.get('id', ''))}
        # 'reviewed' is the placeholder a matched email starts with; the real outcome replaces it, so each email is
        # one record (an email read twice would otherwise appear twice, once with nothing done).
        if action == 'reviewed' and trail and trail[-1].get('action') == 'reviewed' and trail[-1].get('subject') == record['subject']:
            return
        if trail and trail[-1].get('subject') == record['subject'] and trail[-1].get('action') == 'reviewed':
            trail[-1] = record
            return
        trail.append(record)
    for i, email in enumerate(emails):
        if limited and i not in results:
            continue  # not read: not marked seen, so the next check (with AI) reads it
        result = results.get(i) or {'relevant': False}
        if email.get('invite_at') and result.get('relevant'):
            # The invitation's own start (its calendar part), never a time the AI read from the text. A calendar
            # invitation books a time, even when it asks "does this work?": an interview, not a reply.
            result['interview_at'] = email['invite_at']
            if result.get('kind') == REPLY:
                result['kind'] = 'Interview scheduled'
        elif result.get('relevant'):  # an AI reading: never an impossible time (a wrong year), for any job or question
            result['interview_at'] = ledger.plausible_interview(tz.local_iso(result.get('interview_at'), result.get('interview_zone')), email['date'])
        row = apps[result['application']] if result.get('relevant') and 0 <= result.get('application', -1) < len(apps) else None
        guess = None  # the job the AI picked but can't be trusted with: suggested when the owner is asked
        if row is not None and not _names_it(row, email):
            # The AI matched on the role alone (an SRE invitation from one agency, a DevOps pitch from another): an
            # email is attached to a job only if it names that job's company, agency or a contact.
            print(f"Not attached to {_label(row)}: the email ({email['from'][:60]}) names none of it", file=sys.stderr)
            guess, row = row, None
        elif row is not None and _ambiguous(apps, row, email):
            # The same agency or employer has another of your roles, and the email doesn't say which: ask.
            print(f"Not sure it's {_label(row)}: {_field(row, 'via') or _field(row, 'company')} has another open role", file=sys.stderr)
            guess, row = row, None
        named = result.get('relevant') and not row and result.get('role') and result.get('company') \
            and result.get('kind') in TRACKABLE
        if result.get('relevant') and not row and not named:  # e.g. a scheduler email naming only the recruiter
            row = _by_mention(apps, f"{email['from']} {email['subject']} {email['body'][:1500]}")
        if dry_run:
            print(f"{email['date'][:16]} {email['subject'][:60]!r}: {result}")
            continue
        state['seen'].append(email['id'])
        if not result.get('relevant') and _unread_invitation(email):
            # The AI read a meeting invitation as "not about your applications" (2 Oct 2026: a Calendly booking from
            # "Blockdaemon DM" was dropped that way). A person invited the owner to a call: never a silent skip. Focus
            # asks which job it is (or that it is none); nothing is attached or created until the owner answers.
            invited = {**result, 'kind': 'Interview scheduled', 'interview_at': email.get('invite_at', ''),
                       'summary': f"Meeting invitation: {email['subject'][:90]}"}
            ask(stores, email, invited, None, index, lines, stats)
            note(email, 'asked', result.get('company') or '', "a meeting invitation; needs you in Focus (nothing moved)")
            continue
        if not result.get('relevant'):
            continue  # not about your applications: marked seen, never listed (a receipt or newsletter is not a finding)
        if row:
            note(email, 'reviewed', _label(row), link='')  # an outcome below replaces this: it says what was done
        if row and result.get('relevant') and re.search(r'transcript|recording', email['subject'], re.I):
            lines.append(tgcard.block(_head(row, 'Transcript'), escape(email['subject'][:90]),
                                      tgcard.fact('Next step', 'download it and send it to me for an interview review')))
        if result.get('kind') == 'Other':
            note(email, 'reviewed', _label(row) if row else (result.get('company') or ''), 'nothing to record')
            continue
        if result.get('kind') == OUTREACH:
            if not row:
                made = new_lead(stores, client, model, email, apps, stats, on_new)
                lines += made
                note(email, 'tracked', result.get('company') or 'recruiter lead', 'new lead; nothing else changed')
                continue
            result['kind'] = REPLY  # the same recruiter again, about a role already tracked
        if not row and result.get('kind') == 'Interview scheduled':
            # The same recruiter about the same call, by email and on LinkedIn: the job that has this person.
            same = [r for r in apps if _names_person(r, f"{email['from']} {email['subject']} {email['body'][:4000]}")]
            if len(same) == 1:
                row = same[0]
        if not row and result.get('kind') == 'Interview scheduled' and not _about_tracked(
                apps, f"{result['company']} {email['from']} {email['subject']} {email['body'][:1500]}"):
            # An interview for a job not tracked yet (often via an agency, the employer unnamed): track it from the
            # email and let Focus ask for the missing details, rather than drop it or name the job after the agency.
            row = interview_lead(stores, client, model, email, apps, result, stats)
            if row is not None:
                lines.append(tgcard.block('Which job is this for?', f"{_label(row)}: the interview was detected, but the role could not be identified.",
                                          tgcard.fact('Next step', 'In Jobadabra: Focus → Add details. Paste the job link or LinkedIn conversation.')))
        if not row and named:
            # The email names a role: the job it is on (tracked, or on your list and applied to without marking it). None found: asked below.
            row = _from_email(stores, apps, result, email, stats, lines, on_new)
        if not row:
            # Not sure which job (or whether it's one you track): never guess, ask. Focus shows "Is this about …?"
            # with the likeliest job; the answer is applied by src/ai/reassign.py.
            text = f"{result.get('company') or ''} {email['from']} {email['subject']} {email['body'][:1500]}"
            candidates = [r for r in apps if _about_tracked([r], text)]
            suggested = guess or (candidates[0] if candidates else None)
            ask(stores, email, result, suggested, index, lines, stats)
            note(email, 'asked', _label(suggested) if suggested is not None else (result.get('company') or ''),
                 f"needs you in Focus (nothing moved; {result.get('kind')})")
            continue
        fields = {}
        known = index[0]
        already = email['id'] in known
        changed = record(stores, row, result['kind'], email['date'], 'Gmail', email['id'],
                         f"{result['summary']} (email: \"{email['subject'][:120]}\")", index, result['interview_at'], now,
                         feedback_text=verified_feedback(result.get('feedback'), email['body']), email=email,
                         fields=fields)
        if not changed:
            note(email, 'duplicate', _label(row),
                 f"nothing new: this job already has a {result.get('kind')} event" if already
                 else f"nothing to record ({result.get('kind')})")
            continue
        when = _when(result['interview_at'] or '')
        extra = f" · {when.astimezone(TZ):%a %d %b %H:%M}" if when else ''
        lines.append(tgcard.block(_head(row, result['kind']), escape(result['summary']) + escape(extra)))
        _short(stats, result['kind'], row, extra, changes=changes_readable(fields))
        note(email, 'recorded', _label(row), changes_readable(fields))
        if changed == 'Rejected' and rejected is not None:
            rejected.append((row, email))
    if stats is not None:
        stats['emails'] = trail
    return lines, len(results) if limited else len(emails)


def without_ai(apps, emails):
    """Results for the emails that need no AI, when it is unavailable (spend limit): a calendar invitation (its .ics
    gives the time) sent by a contact of an open job, by their exact email address. Never a guess: the usual checks
    in mail_pass still apply (a second open role at that agency, or the contact on several jobs: Focus asks)."""
    results = {}
    for i, email in enumerate(emails):
        sender = (re.search(r'[\w.+-]+@[\w-]+\.[\w.-]+', email.get('from', '')) or [''])[0].lower()
        if not email.get('invite_at') or not sender or re.search(r'cancel|declin', email.get('subject', ''), re.I):
            continue
        jobs = [n for n, row in enumerate(apps) if _field(row, 'stage') not in ENDED
                and sender in re.findall(r'[\w.+-]+@[\w-]+\.[\w.-]+', _field(row, 'contact').lower())]
        if jobs:
            one = len(jobs) == 1
            results[i] = {'relevant': True, 'application': jobs[0] if one else -1,
                          'company': _who(apps[jobs[0]]) if one else _sender_org(email['from']), 'role': '',
                          'kind': 'Interview scheduled', 'interview_at': email['invite_at'],
                          'summary': 'Calendar invitation (read without AI: spend limit reached)', 'feedback': ''}
    return results
