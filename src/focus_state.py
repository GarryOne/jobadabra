#!/usr/bin/env python3
"""Focus, part 2: reading the application's history into a state: the app's own bookkeeping events, the interview
review and prep state, today's applications, the questions asked, the skipped-details token, the follow-up rule and
the funnel card. Pure functions of the store records passed in (applications, events, interviews: an event's and an
interview's job is its app_id). src/focus.py re-exports every name here.

Guarded by tests/test_focus.py, tests/test_follow_up.py and tests/test_focus_history.py.
"""
import re
from datetime import date, datetime, timedelta, timezone

from . import crash_reporting
from .notion import funnel as funnel_steps
from .notion import origin as origin_rule
from .notion.ledger import OUTCOME_STAGES
from .stores import chosen
from .focus_items import (TZ, FOLLOW_UP_HOURS, STALE_DAYS, THEIRS, YOURS, _field, _gmail, _item, _asked_subject,
                          _role, _when, _days_ago)  # noqa: F401


# Events the app wrote to keep its own books (a stage it noticed changed in Notion, a stage set for an application
# tracked before the ledger, "already talking when tracked"), not a message or an answer: they must never hide a message still waiting for your answer.
BOOKKEEPING = re.compile(r'First event for an application tracked before the ledger|Already talking to the recruiter when tracked', re.I)


def _key(record_id):
    """An id as Focus compares it: Notion gives a page's id with and without dashes."""
    return (record_id or '').replace('-', '')


def _bookkeeping(event):
    return event.get('source') in ('Backfill', 'Notion edit') or bool(BOOKKEEPING.search(event.get('note') or ''))


def _events_by_app(events):
    """app id → its events, oldest first, as {'kind', 'at' (a datetime), 'note', 'source_id', 'source'}."""
    by_app = {}
    for event in events:
        if event.get('app_id'):
            by_app.setdefault(_key(event['app_id']), []).append(
                {'kind': event.get('kind') or '', 'at': _when(event.get('at') or ''), 'note': event.get('note') or '',
                 'source_id': event.get('source_id') or '', 'source': event.get('source') or ''})
    for items in by_app.values():
        items.sort(key=lambda e: e['at'] or datetime.min.replace(tzinfo=timezone.utc))
    return by_app


def _interviewed(interviews):
    """Application id -> {'day': the latest day an interview of it was saved in 🎤 Interviews, 'reviewed': the
    latest reviewed one's day (overall set), 'next_step': that review's next step}."""
    seen = {}
    for row in interviews:
        if not row.get('app_id'):
            continue
        day = (row.get('at') or '')[:10]
        info = seen.setdefault(_key(row['app_id']), {'day': '', 'reviewed': '', 'next_step': ''})
        info['day'] = max(info['day'], day)
        if row.get('overall') and day >= info['reviewed']:
            info.update(reviewed=day, next_step=row.get('next_step') or '')
    return seen


def reviewed_interviews(interviews, app_id):
    """The reviewed interviews of one application (overall set), newest first, as {'id', 'url', 'day', 'moment',
    'round', 'next_step', 'overall', 'weak_topics'}. moment: when the call was over for Jobadabra, the later of the
    day it was held (at) and when its record was saved (created_at, after the call). url: its page (link), if any."""
    found = []
    for row in interviews:
        if not row.get('overall') or _key(row.get('app_id')) != _key(app_id):
            continue
        day = (row.get('at') or row.get('created_at') or '')[:10]
        held = datetime.combine(date.fromisoformat(day), datetime.min.time(), TZ) if day else None
        moment = max([m for m in (held, _when(row.get('created_at') or '')) if m], default=None)
        weak = row.get('weak_topics') or ''
        found.append({'id': row['id'], 'url': row.get('link') or '', 'day': day, 'moment': moment,
                      'round': row.get('round') or '', 'next_step': row.get('next_step') or '',
                      'overall': row.get('overall') or '', 'weak_topics': ', '.join(weak) if isinstance(weak, list) else weak})
    found.sort(key=lambda r: (r['day'], r['moment'] or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
    return found


def _day(day):
    return f'{date.fromisoformat(day[:10]).day} {date.fromisoformat(day[:10]):%b}'


def prep_state(prep_at, reviewed, history=()):
    """Is the prep kit (Interview prep: when it was built) still the one for the coming interview? One rule, used by
    Focus: a kit is current only if it was built after the application's latest reviewed interview (a kit built
    before a call was for that call) and after the coming interview was booked or moved (an Interview scheduled
    event). A kit dated without a time (older kits) counts as built at the start of its day.
    {'stale': bool, 'reason': short text, 'since': the day that made it stale, 'why': 'reviewed' or 'booked'}."""
    current = {'stale': False, 'reason': '', 'since': '', 'why': ''}
    if not prep_at:
        return current
    built_day, built = prep_at[:10], _when(prep_at) if len(prep_at) > 10 else None
    latest = reviewed[0] if reviewed else None
    if latest and latest['day'] and (latest['moment'] >= built if built and latest['moment'] else latest['day'] >= built_day):
        return {'stale': True, 'since': latest['day'], 'why': 'reviewed',
                'reason': f"Kit from {_day(built_day)} · your call on {_day(latest['day'])} was reviewed since"}
    booked = [e['at'] for e in history if e['kind'] == 'Interview scheduled' and e['at']]
    booked = max(booked, default=None)
    if booked and (booked > built if built else booked.astimezone(TZ).date().isoformat() > built_day):
        day = booked.astimezone(TZ).date().isoformat()
        return {'stale': True, 'since': day, 'why': 'booked',
                'reason': f"Kit from {_day(built_day)} · the interview was booked or moved on {_day(day)}"}
    return current


def _applied_today(rows, by_app, today):
    return _applied_by_day(rows, by_app, today, days=1)[0]['applied']


def _applied_by_day(rows, by_app, today, days=14):
    """Applications per day, oldest first, the last `days` days up to today: the Focus progress chart. The same rule as
    today's count (the Applied on date, or an Applied event that day), read from Notion: no separate history to keep."""
    first = today - timedelta(days=days - 1)
    seen = {}
    for row in rows:
        day = _field(row, 'applied_on')[:10]
        if day:
            seen.setdefault(_key(row['id']), set()).add(day)
    for key, events in by_app.items():
        for event in events:
            if event['kind'] == 'Applied' and event['at']:
                seen.setdefault(key, set()).add(event['at'].astimezone(TZ).date().isoformat())
    counts = {}
    for days_seen in seen.values():
        for day in days_seen:
            counts[day] = counts.get(day, 0) + 1
    return [{'day': (first + timedelta(days=i)).isoformat(), 'applied': counts.get((first + timedelta(days=i)).isoformat(), 0)}
            for i in range(days)]


# A job known only from an invitation or a message: its Job URL is the email, the chat or a derived link.
PLACEHOLDER_URL = re.compile(r'mail\.google\.com|linkedin\.com/messaging|jobpilotto\.(?:workers\.dev|top)/lead')


def thin(row):
    """What an interviewing job still lacks that you'd want before the call ([] when it's known well enough):
    the employer, or both the pay and the posting (only the meeting or the message is known)."""
    missing = [] if _field(row, 'company') else ['company']
    if not _field(row, 'salary') and PLACEHOLDER_URL.search(_field(row, 'url')):
        missing += ['salary', 'job description']
    return missing


def questions(rows, events):
    """Emails the Gmail check wasn't sure about (events on no job with needs_you, src/ai/mail.py ask): "Is this
    about …?" with the likeliest job, or "Which job is this email about?". src/ai/reassign.py applies the answer."""
    by_url = {_field(r, 'url'): r for r in rows if _field(r, 'url')}
    asked = []
    for event in events:
        if not event.get('needs_you') or event.get('app_id'):
            continue
        link = event.get('suggested_job')
        if link and not isinstance(link, str):  # not text (Sentry APP-23: a dict): ask "which job?" instead of failing Focus, and report its shape once a day
            crash_reporting.warn('suggested_job is not text', {'type': type(link).__name__, 'keys': ','.join(sorted(map(str, link)))[:80] if isinstance(link, dict) else '',
                                                               'store': chosen()})
            link = ''
        suggested = by_url.get(link or '')
        note, kind = event.get('note') or '', event.get('kind') or ''
        at = _when(event.get('at') or '')
        label = f"{_field(suggested, 'company') or _field(suggested, 'via') or '?'} — {_role(suggested)[:60]}" if suggested else ''
        title = f'Is this email about {label}?' if suggested else 'Which job is this email about?'
        detail = f"{kind}{f', {at.astimezone(TZ):%a %d %b %H:%M}' if at else ''}: {note[:220]}"
        asked.append(_item(1, 'which_job', '🔎', title, detail, suggested, event_id=event['id'], event_kind=kind, note=note,
                           subject=_asked_subject(event),
                           suggested_url=_field(suggested, 'url') if suggested else '', suggested_label=label))
    return asked


def details_token(coming_at, stage):
    """Which interview the "I don't know the employer yet" skip belongs to, as UTC.
    Notion returns the same moment as Z or with an offset; both are this interview. A new date is a new ask."""
    if coming_at:
        return coming_at.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    return stage or 'unknown'


def _same_interview(stored, coming_at):
    """A skip token and the job's Next interview are the same moment, whatever offset each was stored with."""
    if not coming_at or not stored:
        return False
    try:
        moment = datetime.fromisoformat(stored.replace('Z', '+00:00'))
    except ValueError:
        return False
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=TZ)
    return moment.astimezone(timezone.utc).replace(microsecond=0) == coming_at.astimezone(timezone.utc).replace(microsecond=0)


def _skipped_details(history, coming_at, stage):
    """True when Skip was saved for this interview. The event (Kind "Details skipped", source id skip-details:…)
    is what a refresh reads, so the card stays gone. An older skip stored the interview's own offset; that still counts."""
    want = details_token(coming_at, stage)
    for event in history:
        source_id = event.get('source_id') or ''
        if event.get('kind') != 'Details skipped' and not source_id.startswith('skip-details:'):
            continue
        stored = source_id[len('skip-details:'):] if source_id.startswith('skip-details:') else ''
        if not stored or stored == want or _same_interview(stored, coming_at):
            return True
    return False




def follow_up(row, history, now, interviewed=None):
    """The follow-up item for one application, or None: its latest message (bookkeeping aside) is yours ("Replied":
    sent by email, logged from a chat, or Done in Focus), at least FOLLOW_UP_HOURS old and at most STALE_DAYS, and
    nothing of theirs came after it. A call reviewed on or after that message settles it: the meeting was the next
    step, so "no reply yet" is stale. Done logs another "Replied" (now): it comes back after another interval."""
    messages = [e for e in history if e['kind'] in YOURS | THEIRS and e['at'] and not _bookkeeping(e)]
    last = messages[-1] if messages else None
    if not last or last['kind'] not in YOURS:
        return None
    reviewed = (interviewed or {}).get('reviewed') or ''
    if reviewed and reviewed >= last['at'].astimezone(TZ).date().isoformat():
        return None
    hours = (now - last['at']).total_seconds() / 3600
    if not FOLLOW_UP_HOURS <= hours <= STALE_DAYS * 24:
        return None
    days = int(hours // 24)  # whole days since; 1 for the first 24-48 hours
    job_url = _field(row, 'url')
    link = _gmail(last['source_id']) if last['source'] == 'Gmail' else ''
    link = link or (job_url if re.search(r'mail\.google\.com|linkedin\.com/messaging', job_url) else '')
    who = _field(row, 'company') or _field(row, 'via') or _field(row, 'contact').split(' · ')[0] or 'the recruiter'
    said = f"{last['at'].astimezone(TZ):%a} {last['at'].astimezone(TZ).day} {last['at'].astimezone(TZ):%b}"
    return _item(2, 'follow_up', '📨', f'Follow up with {who}', f'You wrote {said} ({_days_ago(days)}), no reply yet.', row,
                 link, 'Open email' if 'mail.google' in link else 'Open chat' if 'linkedin' in link else '', done=True,
                 at=last['at'].isoformat(), quiet=days)


def origin_of(app, kinds=()):
    """'inbound' or 'outbound' for an application record (src/notion/origin.py: its Origin, else derived)."""
    return origin_rule.origin(source=app.get('source') or '', stage=app.get('stage') or '', notes=app.get('notes') or '',
                              kinds=kinds, origin=app.get('origin') or '')


def funnel(rows, events):
    """The application funnel (src/notion/funnel.py) from the rows already read: each step, how many reached it,
    their share of applications, and the step to improve (with its advice) when there's enough data.
    The steps count outbound applications only (src/notion/origin.py: you went after the job); opportunities that
    found you are counted apart, in 'inbound': how many contacted you, reached a screening, interviews, an offer, and
    those steps with their links (the Inbound funnel card)."""
    kinds = {}  # oldest first: the first contact decides inbound or outbound (src/notion/origin.py)
    for event in sorted(events, key=lambda event: event.get('at') or ''):
        if event.get('app_id'):
            kinds.setdefault(_key(event['app_id']), []).append(event.get('kind') or '')
    apps, inbound = [], []
    for r in rows:
        stage, ordered = _field(r, 'stage'), kinds.get(_key(r['id']), [])
        app = {'stage': stage, 'seen': set(ordered) | {stage}, 'url': _field(r, 'url')}
        if origin_of(r, ordered) == 'inbound':
            inbound.append(app)
        elif stage in OUTCOME_STAGES + funnel_steps.PREPARED_STAGES:
            apps.append(app)
    steps = funnel_steps.funnel(apps)
    weak = funnel_steps.focus(steps)
    page = funnel_steps.PIPELINE_PAGE_ID
    # now: still at this step (reached it, not the next one, not closed): the number the Jobs boxes show.
    # urls: every application that ever reached each step (the count only grows), for the Jobs list a click shows.
    here = [[a['url'] for a in apps if a['url'] and (marks is None or a['seen'] & marks)] for _, marks, _, _ in funnel_steps.STEPS]
    # from/conversion: the share of the previous step that got this far; summary: the Pipeline page's "Where to improve" lines
    # (src/notion/funnel.py, one copy), both shown by the app's Reports → Funnel for every store.
    return {'steps': [{'step': s['step'], 'reached': s['reached'], 'now': s['waiting'], 'of_applied': s.get('of_applied'), 'urls': urls,
                       'from': s.get('from'), 'conversion': s.get('conversion')}
                      for s, urls in zip(steps, here)],
            'improve': {'step': weak['step'], 'advice': weak['advice']} if weak else None,
            'summary': funnel_steps.summary(steps),
            # The inbound funnel card: the counts, and the steps (with their links) it draws.
            'inbound': {**funnel_steps.inbound_counts(inbound), 'steps': funnel_steps.inbound_funnel(inbound)},
            'notion_url': f'https://www.notion.so/{page.replace("-", "")}' if page else ''}
