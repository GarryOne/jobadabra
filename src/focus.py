#!/usr/bin/env python3
"""Focus: what to do next in the job search, most important first. No AI, so it costs nothing.

Read from the active store (src/stores: applications, events, interviews, insights; Notion or this Mac), in this order:
1. 💬 Reply: a person wrote (a reply, a recruiter's pitch, an offer) and nothing was done since.
   📅 Book the call: the reply invites you to pick a slot.
2. 🎤 Prepare: an interview is coming (within 48 h first); "did it happen?" once its time passed and nothing was
   recorded (yes: notes and a review; no: moved or cancelled), or 📝 review one that was recorded.
   📨 Follow up: you wrote last (a "Replied" event: your logged chat, your sent Gmail, Done here) and nothing came
   back for FOLLOW_UP_HOURS; no interview ahead. It replaces "Move it forward" for that job.
   🤝 Move it forward: a Screening with nothing booked and no news for 3 days. ⏳ Waiting for their next step
   after an interview you reviewed, until 3 days without news.
3. 📨 Apply: today's applications against the daily target, with the jobs whose kit is ready.
4. 🔎 Learn: the latest rejection lesson; ⏳ applications waiting 7+ days without a human reply.

"Done" on a reply item logs a "Replied" event (the store keeps it; the item then goes away). The Desktop App shows
the list (Focus) and, at 11:00, 15:00 and 19:00, reminds you (notification, and Telegram with --send) when
you're behind the daily target or someone waits for an answer.

Usage:
  python -m src.focus [--target 30]            # the list as JSON (for the app); the target defaults to
                                               # "Daily applications target" on ⚙️ Search settings
  python -m src.focus done <page id> replied   # you answered: log it
  python -m src.focus done <page id> details_skipped  # you don't know the employer yet: it stays skipped
  python -m src.focus history                   # what you resolved from Focus, newest first
  python -m src.focus remind [--target 30] [--send]
"""
import argparse
from datetime import date, datetime, timedelta, timezone
from html import escape
import json
import os
import re
import sys
from zoneinfo import ZoneInfo

from . import telegram, tgcard, tz
from .app_source import APP_SOURCE, is_app_source
from .ai import meanings
from . import feedback
from .features import disabled
from .notion import client as notion
from .notion import funnel as funnel_steps
from .notion.ledger import OUTCOME_STAGES, REPLY
from .stores import base
from . import suggestions, suggestions_search
# The helpers live in focus_items.py and focus_state.py; every name stays importable from here.
from .focus_items import (  # noqa: F401
    TZ, DEFAULT_TARGET, REPLIED, ENDED, NEEDS_ANSWER, WAITING_DAYS, QUIET_DAYS, SOON_HOURS, STALE_DAYS,
    FOLLOW_UP_HOURS, YOURS, THEIRS, _when, _ago, _field, _role, _asked_subject,
    answered_questions, _gmail, _booking_link, _item, _short, present, summary, _days_ago)
from .focus_state import (  # noqa: F401
    BOOKKEEPING, _bookkeeping, _events_by_app, _interviewed, reviewed_interviews, _day, prep_state,
    _applied_today, _applied_by_day, PLACEHOLDER_URL, thin, questions, details_token, _same_interview,
    _skipped_details, follow_up, funnel, origin_of, _key)

STRATEGY_ROWS = (*suggestions_search.ROWS, 'ideas')   # the rows Strategy hides by an answer kept in the store


def build(rows, events, interviews=(), *, target=DEFAULT_TARGET, now=None, insights=(), gmail=True, tune=None, search=()):
    """{'items': [...], 'suggestions': [...], 'today': {...}}: the focus list, most important first, each item with its place
    (Up next or Suggestions, src/suggestions.py), and the engine's suggestions. Pure: no I/O. rows, events, interviews,
    insights: store records (an application's or insight's 'link' is its page, when the store has one); tune: src/tune.py's answer;
    search: Strategy's search entries (src/suggestions_search.py)."""
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(TZ).date()
    by_app, interviewed, items = _events_by_app(events), _interviewed(interviews), []
    for row in rows:
        stage, key = _field(row, 'stage'), _key(row['id'])
        history = by_app.get(key, [])
        status = _field(row, 'feedback_status')
        kinds = {e['kind'] for e in history}
        received = _field(row, 'employer_feedback')
        last_received = max((e['at'] for e in history if e['kind'] == feedback.RECEIVED and e['at']), default=None)
        last_reviewed = max((e['at'] for e in history if e['kind'] == feedback.REVIEWED and e['at']), default=None)
        if not disabled('feedback') and received and (not last_reviewed or (last_received and last_received > last_reviewed)):
            detail = 'Read their feedback, then choose what to practise before your next interview. It also feeds your insights and weekly report.'
            items.append(_item(2, 'feedback_review', '💬', 'Learn from employer feedback', detail, row, employer_feedback=received))
        if stage == 'Rejected':
            if received or feedback.SKIPPED in kinds or status == 'Skipped':
                continue
            if feedback.REQUESTED in kinds or status == 'Asked for feedback':
                kind, detail = 'feedback_wait', ('Your request is sent. Gmail checks will collect their reply; you can also paste feedback here.' if gmail else
                                                 'Your request is sent. Connect Gmail to collect their reply, or paste feedback here.')
            elif feedback.eligible_status(_field(row, 'feedback_status'), history):
                kind, detail = 'feedback', 'You reached Screening or later. Ask for one or two concrete points: real feedback helps improve your next interview.'
            else:
                continue
            rejection = next((e for e in reversed(history) if e['kind'] == 'Rejected'), {})
            items.append(_item(4 if kind == 'feedback_wait' else 2, kind, '💬', 'Ask for feedback', detail, row,
                               _gmail(rejection.get('source_id')), 'Open email', draft=feedback.draft(row), employer_feedback=''))
            continue
        if stage in ENDED:
            continue
        # Talking or interviewing, but the employer isn't known (an agency's invitation, a hidden client): ask the
        # owner for the details (the app opens its Log box on this job: paste the LinkedIn chat or the job link).
        # Asked until you log something on the job (the Log box): then you've said what you know; what the chat
        # didn't say (a hidden employer, no salary) stays visible on the job, not as a to-do.
        told = any(e['source_id'].startswith('paste:') for e in history)
        missing = [] if told else thin(row)
        # An agency keeping its client hidden after you already had the call (a reviewed interview): the employer isn't
        # something pasting more messages will fill in, so it is not a to-do (it shows on the job once they name it).
        if 'company' in missing and _field(row, 'via') and interviewed.get(key, {}).get('reviewed'):
            missing = [m for m in missing if m != 'company']
        # Only once an interview is booked: an agency keeping the employer hidden while you're only talking is normal.
        if stage in ('Interview scheduled', 'Interviewing') and missing:
            coming_at = _when(_field(row, 'next_interview'))
            # Skip means "I don't know yet" for this interview. A later date asks again; the same one stays quiet.
            if _skipped_details(history, coming_at, stage):
                missing = []
            else:
                when = f"Interview {coming_at.astimezone(TZ):%a %d %b, %H:%M}" if coming_at and coming_at > now else stage
                who = _field(row, 'company') or _field(row, 'via') or 'a recruiter'
                items.append(_item(1, 'details', '🧩', f"Add details: {who} — {_role(row)[:70]}",
                                   f"{when}, but Jobadabra doesn't know the {' or '.join(missing)}. Paste the LinkedIn chat, "
                                   "the recruiter's message or the job link: it fills in the job, so your prep and kit fit it.",
                                   row, missing=missing))
        last = next((e for e in reversed(history) if not _bookkeeping(e)), None)
        company = _field(row, 'company') or _field(row, 'via') or 'A recruiter'
        label = f"{company} — {_role(row)[:70]}"
        if last and last['kind'] in NEEDS_ANSWER:
            job_url = _field(row, 'url')
            link = _gmail(last['source_id']) or (job_url if re.search(r'mail\.google\.com|linkedin\.com/messaging', job_url) else '')
            reached = _field(row, 'reached_via') or ('LinkedIn' if 'linkedin' in link else 'Email' if 'mail.google' in link else '')
            where = {'Email': 'by email', 'LinkedIn': 'on LinkedIn', 'Phone': 'by phone'}.get(reached, '')
            when = _ago(last['at'], now) if last['at'] else ''
            upcoming = _when(_field(row, 'next_interview'))
            if last['kind'] == 'Offer':
                items.append(_item(1, 'offer', '🎉', f'Answer the offer: {label}', f'Offer {when}. {last["note"][:140]}', row,
                                   link, 'Open email' if link else '', done=True))
            elif meanings.asks_to_book(last['note']):
                # The call is already on the calendar (Next interview): "Book the call" is done. Prepare stays.
                # A later "please confirm this time" is not a booking note, so that reply still shows beside Prepare.
                if not (upcoming and upcoming > now):
                    booking = _booking_link(last['note'])  # a chat's Calendly link: the button opens it, wherever they wrote
                    items.append(_item(1, 'book', '📅', f'Book the call: {label}', f'They asked you to pick a time ({when}). {last["note"][:140]}',
                                       row, booking or link, 'Open booking link' if booking else 'Open email' if 'mail.google' in link else 'Open',
                                       done=True))
            else:
                if last['kind'] == 'Recruiter lead':  # the facts that decide the answer, not the event's note
                    facts = ' · '.join(p for p in (_field(row, 'salary'), _field(row, 'location'), _field(row, 'contact').split(' · ')[0]) if p)
                    detail = f'Recruiter pitch {when}{f" ({reached})" if reached else ""}. {facts}'
                else:
                    detail = f'They wrote {when}. {last["note"][:140]}'
                items.append(_item(1, 'reply', '💬', f'Reply {where}: {label}'.replace('Reply : ', 'Reply: '),
                                   detail, row, link,
                                   'Open email' if 'mail.google' in link else 'Open LinkedIn' if 'linkedin' in link else '', done=True,
                                   lead=last['kind'] == 'Recruiter lead'))
            # An interview still ahead keeps its own "Prepare" item next to the answer that is waiting (the recruiter
            # asking you to confirm the time must not hide the preparation for it).
            if not (upcoming and upcoming > now and last['kind'] != 'Offer'):
                continue
        coming = _when(_field(row, 'next_interview'))
        if coming and coming > now:
            hours = (coming - now).total_seconds() / 3600
            if hours <= 14 * 24:
                prep_at = _field(row, 'interview_prep')
                kit = prep_state(prep_at, reviewed_interviews(interviews, row['id']), history)
                detail = (f"Interview {coming.astimezone(TZ):%a %d %b, %H:%M}. Read the posting and your kit, "
                          'and practise the topics you answered weakly before.')
                if kit['stale']:
                    detail += f" {kit['reason']}: build a new kit for this round (about $0.04); the earlier one stays on the job's page."
                items.append(_item(1 if hours <= SOON_HOURS else 2, 'prepare', '🎤', f'Prepare: {label}', detail, row,
                                   at=coming.isoformat(), prep_at=prep_at, prep_stale=kit['stale'],
                                   prep_reason=kit['reason'], prep_since=kit['since'], prep_why=kit['why']))
                continue
        seen = interviewed.get(key, {})
        if coming and coming <= now:
            held_day = coming.astimezone(TZ).date().isoformat()
            if seen.get('day', '') < held_day:  # nothing recorded since: ask (one item per interview)
                items.append(_item(1, 'happened', '🔎', f'Did the interview happen? {label}',
                                   f"It was {coming.astimezone(TZ):%a %d %b, %H:%M}. Yes: note how it went (salary, next "
                                   "steps, people, questions) and it moves on. No: say if it moved or was cancelled.",
                                   row, at=coming.isoformat()))
                continue
            if seen.get('reviewed', '') < held_day and now - timedelta(days=3) < coming:
                items.append(_item(2, 'review', '📝', f'Review the interview: {label}',
                                   f"It was {coming.astimezone(TZ):%a %d %b}. It's recorded: review it (Interviews) "
                                   'while you remember it: you get a review of every answer.', row))
                continue
        follow = follow_up(row, history, now, seen) if not (coming and coming > now) else None
        if follow:  # you wrote last and they haven't answered: before "move it forward", which it replaces
            items.append(follow)
            continue
        talking = ('Recruiter lead', 'Screening', 'Interview scheduled', 'Interviewing')
        if seen.get('reviewed') and stage in talking and not (coming and coming > now):
            # An interview was held and reviewed: their move. Calm until QUIET_DAYS pass without news.
            news = max([seen['reviewed']] + [e['at'].astimezone(TZ).date().isoformat() for e in history if e['at']])
            quiet = (today - date.fromisoformat(news)).days
            if quiet >= STALE_DAYS:
                continue  # long quiet after an interview: not a to-do any more (as before reviews were read)
            if quiet < QUIET_DAYS:
                items.append(_item(4, 'waiting', '⏳', f"Waiting for {company}'s next step",
                                   f"Interview reviewed. Next: {seen['next_step'] or 'not stated'}. Nothing to do yet; "
                                   f'follow up if there is no news in {QUIET_DAYS - quiet} day{"s" if QUIET_DAYS - quiet != 1 else ""}.',
                                   row, next_step=seen['next_step'], after_interview=True, quiet=quiet))
            else:
                items.append(_item(2, 'nudge', '🤝', f'Move it forward: {label}',
                                   f"No news for {quiet} days since the interview. Next step was: {seen['next_step'] or 'not stated'}. "
                                   'Ask where things stand.', row, quiet=quiet))
            continue
        if stage in ('Screening', 'Interview scheduled') and not (coming and coming > now):
            quiet = (now - last['at']).days if last and last['at'] else QUIET_DAYS
            if quiet >= QUIET_DAYS or stage == 'Interview scheduled':
                items.append(_item(2, 'nudge', '🤝', f'Move it forward: {label}',
                                   f"{stage}, nothing booked{f' and no news for {quiet} days' if quiet >= QUIET_DAYS else ''}. "
                                   'Propose times for the next call, or ask where things stand.', row, quiet=quiet))
    items += questions(rows, events)
    done_today = _applied_today(rows, by_app, today)
    kits = sorted((r for r in rows if _field(r, 'stage') == 'Kit ready'),
                  key=lambda r: -(r.get('fit') or 0))
    left = max(target - done_today, 0)
    if left:
        names = ', '.join(f"{_field(r, 'company')}" for r in kits[:3])
        items.append(_item(3, 'apply', '📨', f'Apply to {left} more job{"s" if left != 1 else ""} today',
                           f'{done_today} of {target} today.' + (f' {len(kits)} kit{"s" if len(kits) != 1 else ""} ready'
                                                                  f'{f" ({names}…)" if names else ""}.' if kits else
                                                                  ' Prepare kits from your best matches (Jobs).'),
                           applied=done_today, left=left, kits=len(kits), target=target))
    waiting = [r for r in rows if _field(r, 'stage') in ('Applied', 'Confirmation received')
               and (applied := _when(_field(r, 'applied_on'))) and (now - applied).days >= WAITING_DAYS]
    if waiting:
        items.append(_item(4, 'waiting', '⏳', f'{len(waiting)} application{"s" if len(waiting) != 1 else ""} waiting {WAITING_DAYS}+ days',
                           'No human reply yet. For the ones you care most about, message the recruiter or a team member '
                           'on LinkedIn; let the rest go (they close as No response after 21 days).'))
    order = {'offer': 0, 'book': 1, 'which_job': 1.2, 'happened': 1.3, 'details': 1.5, 'reply': 2, 'prepare': 3, 'review': 4,
             'follow_up': 4.5, 'feedback_review': 5,
             'feedback': 6, 'nudge': 7, 'apply': 8, 'learn': 9, 'feedback_wait': 10, 'waiting': 11}
    items.sort(key=lambda i: (i['priority'], order[i['kind']]))
    items = [{**present(item, gmail), 'place': suggestions.place(item['kind']), 'topic': suggestions.item_topic(item['kind'])} for item in items]
    # The weekly report's door counts only when the app can carry it out now (src/suggestions.py DOORS).
    doors = {'find_jobs', 'tailor'} | ({'tune'} if suggestions.tune_entry(tune) else set()) | ({'prep'} if any(i['kind'] == 'prepare' for i in items) else set())
    return {'items': items, 'today': {'applied': done_today, 'target': target, 'kits_ready': len(kits),
                                      'history': _applied_by_day(rows, by_app, today)},
            'suggestions': suggestions.pool(insights=insights, tune=tune, events=events, now=now, doors=doors, rows=rows, search=search),
            # Strategy draws its rows from its own fresh check: these are the ones answered (Not now, Not true) wherever they were shown.
            'suggestions_hidden': sorted(key for key in suggestions.hidden(insights, now) if key.split(':')[0] in STRATEGY_ROWS),
            'summary': summary(items), 'funnel': funnel(rows, events),
            'answered_questions': answered_questions(rows, events),
            'generated_at': now.isoformat(timespec='seconds')}


def settings_target():
    """The daily target from ⚙️ Search settings ("Daily applications target"), read from Notion first."""
    from .notion import search_settings
    search_settings.sync_quietly()
    try:
        return max(int(search_settings.load_cached()['preferences'].get('daily_applications_target') or DEFAULT_TARGET), 1)
    except (TypeError, ValueError):
        return DEFAULT_TARGET


def gmail_connected():
    """Whether a Gmail check can run here (a Google sign-in saved, mail not switched off). A revoked sign-in still counts: the Gmail check says that one itself."""
    from .sources.google import Google
    try:
        found = Google.from_env()
        return found is not None and (found.scopes is None or 'gmail' in found.scopes)   # replies are collected from Gmail only
    except Exception:  # noqa: BLE001 - the wording only; Focus never fails on it
        return True


def _linked(stores, records):
    """Records with their page's link ('' when the store has no pages)."""
    return [{**r, 'link': stores.link(r['id']) or ''} for r in records]


def _tune(rows):
    """Tune my strategy's answer (src/tune.py, counts only, no AI) from the applications already read; None when there is no jobs cache
    yet or it can't be read: Focus never fails on Tune. Why (insights PR 1a, 28 Oct 2026): Tune comes to you after every search."""
    from . import store, tune
    from .paths import jobs_db, load_search_config
    path = jobs_db()
    if not os.path.exists(path):
        return None
    try:
        with store.connect(path) as db:
            return tune.run(db, None, load_search_config(), stages={r['url'].strip(): r.get('stage') or None for r in rows if r.get('url')})
    except Exception:  # noqa: BLE001 - a missing table or settings file: no Tune entry
        return None


def load(stores, *, target=None, now=None, gmail=None):
    """Applications, events, interviews, every insight (answers to suggestions can be old) and (without a target given) the
    Search settings target, read at once from the store; Tune from the jobs cache on this Mac."""
    # Side by side only for a store reached over the network (Notion: a page load waits for the slowest read, not the sum); a store on
    # this Mac is read in turn: its sqlite connection refuses another thread (the SQLite store's Focus and Reports failed, 9 Oct 2026).
    read = notion.together if base.CLOUD in (stores.caps or ()) else (lambda *calls: [call() for call in calls])
    rows, events, interviews, target, insights = read(
        stores.applications.list, stores.events.list, stores.interviews.list,
        lambda: target or settings_target(), stores.insights.list)
    return build(_linked(stores, rows), events, _linked(stores, interviews), target=target, now=now,
                 insights=_linked(stores, insights), gmail=gmail_connected() if gmail is None else gmail, tune=_tune(rows), search=suggestions_search.now())


def reminder(focus, now=None):
    """One reminder text, or '' when there's nothing worth interrupting for."""
    now = now or datetime.now(timezone.utc)
    today, items = focus['today'], focus['items']
    waiting = [i for i in items if i['kind'] in ('offer', 'book', 'reply')]
    soon = [i for i in items if i['kind'] == 'prepare' and i['priority'] == 1]
    # Behind the target: fewer than the share of the day that has passed (from 8:00 to 20:00).
    hour = now.astimezone(TZ).hour + now.astimezone(TZ).minute / 60
    expected = today['target'] * min(max((hour - 8) / 12, 0), 1)
    behind = today['applied'] < expected
    parts = []
    if waiting:
        parts.append(f"💬 {len(waiting)} {'person waits' if len(waiting) == 1 else 'people wait'} for your answer: "
                     + ', '.join(i['company'] or 'a recruiter' for i in waiting[:3]))
    if soon:
        parts.append('🎤 Interview soon: ' + ', '.join(i['company'] for i in soon[:2]))
    learning = [i for i in items if i['kind'] in ('feedback', 'feedback_review')]
    if learning:
        parts.append(f"💬 {len(learning)} feedback action(s): " + ', '.join(i['company'] for i in learning[:3])
                     + ' — one useful point can improve your next interview')
    if behind:
        parts.append(f"📨 {today['applied']}/{today['target']} applications today"
                     + (f"; {today['kits_ready']} kits ready" if today['kits_ready'] else ''))
    return '\n'.join(parts)


def reminder_card(focus, now=None):
    """The reminder as a Telegram card: "Your focus", one block per thing that needs you, then "Today"."""
    now = now or datetime.now(timezone.utc)
    today, items = focus['today'], focus['items']
    waiting = [i for i in items if i['kind'] in ('offer', 'book', 'reply')]
    soon = [i for i in items if i['kind'] == 'prepare' and i['priority'] == 1]
    learning = [i for i in items if i['kind'] in ('feedback', 'feedback_review')]
    hour = now.astimezone(TZ).hour + now.astimezone(TZ).minute / 60
    behind = today['applied'] < today['target'] * min(max((hour - 8) / 12, 0), 1)
    blocks = []
    for item in waiting[:3]:
        blocks.append(tgcard.block(escape(item['company'] or 'A recruiter'), 'Waiting for your answer.'))
    for item in soon[:2]:
        blocks.append(tgcard.block(escape(item['company']), 'Interview soon.'))
    for item in learning[:3]:
        blocks.append(tgcard.block(escape(item['company']), 'Review one learning point before your next interview.'))
    if behind or not blocks:
        kits = f"{today['kits_ready']} kits ready" if today['kits_ready'] else ''
        blocks.append(tgcard.block('Today', escape(tgcard.dot(f"{today['applied']} of {today['target']} applications", kits))))
    counts = [f"{len(waiting)} waiting for you" if waiting else '', f"{len(soon)} interview soon" if soon else '',
              f"{len(learning)} feedback item{'s' if len(learning) != 1 else ''} to review" if learning else '']
    return tgcard.card('Your focus', tgcard.dot(*counts), blocks, emoji='🧭')


# ---- history: what you resolved from Focus (Notion keeps it: 📈 Application Events from the app, and 💡 Insights you rated)
HISTORY_TITLES = {
    'Replied': ('💬', 'Replied to {company}'),
    'Feedback requested': ('🙋', 'Asked {company} for feedback'),
    'Feedback received': ('📥', 'Got feedback from {company}'),
    'Feedback reviewed': ('📝', "Reviewed {company}'s feedback"),
    'Feedback skipped': ('⏭️', 'Skipped asking {company} for feedback'),
    'Details skipped': ('⏭️', "Don't know the employer yet: {company}"),
    'Interview cancelled': ('🚫', 'Interview with {company} cancelled'),
    'Interview scheduled': ('📅', 'Interview with {company} moved'),
    'Interviewing': ('🎤', 'Interview with {company} held'),
    'Screening': ('🎤', 'Screening call with {company} held'),
}


def history(stores, days=90):
    """Newest first: [{at, kind, emoji, title, note, url}] for the last `days` days."""
    since = (date.today() - timedelta(days=days)).isoformat()
    apps = {app['id']: app for app in stores.applications.list()}
    items = []
    for event in stores.events.list():
        if not is_app_source(event['source']) or (event['at'] or '')[:10] < since:
            continue
        kind, app = event['kind'] or '', apps.get(event['app_id']) or {}
        company = app.get('company') or app.get('title') or 'an employer'
        emoji, title = HISTORY_TITLES.get(kind, ('✓', f'{kind} · {{company}}'))
        items.append({'at': event['at'] or '', 'kind': kind, 'emoji': emoji, 'title': title.format(company=company),
                      'note': (event['note'] or '')[:240], 'url': stores.link(event['id']) or ''})
    for insight in stores.insights.list(since=since):
        rated = (insight['fields'] or {}).get('feedback')
        if not rated:
            continue
        items.append({'at': insight['day'] or '', 'kind': 'insight', 'emoji': '💡', 'title': f'Insight: {rated}',
                      'note': (insight['title'] or '')[:240], 'url': stores.link(insight['id']) or ''})
    # Interviews reviewed (their "Review the interview" step leaves Up next once the review is saved). When: the
    # record's creation (the store keeps no last-edit time for an interview).
    for interview in stores.interviews.list():
        at = interview['created_at'] or ''
        if not interview['overall'] or at[:10] < since:
            continue
        overall = (interview['overall'] or '').capitalize()
        items.append({'at': at, 'kind': 'interview_review', 'emoji': '🎤',
                      'title': f"Reviewed the interview: {interview['title'] or 'an interview'}",
                      'note': f'Outcome: {overall}' if overall else '', 'url': stores.link(interview['id']) or ''})
    return sorted(items, key=lambda item: item['at'], reverse=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('command', nargs='?', default='list', choices=('list', 'done', 'remind', 'history'))
    parser.add_argument('page_id', nargs='?')
    parser.add_argument('what', nargs='?', default='replied')
    parser.add_argument('--target', type=int, help='default: "Daily applications target" on ⚙️ Search settings')
    parser.add_argument('--send', action='store_true', help='remind: also send it to Telegram')
    args = parser.parse_args(argv)
    from . import ledger_store
    from .stores import open_stores
    stores = open_stores()
    if args.command == 'history':
        print(json.dumps({'items': history(stores)}, ensure_ascii=False))
        return 0
    if args.command == 'done':
        if not args.page_id:
            raise SystemExit('done needs the application page id')
        row = stores.applications.by_id(args.page_id)
        if not row:
            raise SystemExit(f'No application {args.page_id}')
        if args.what == 'details_skipped':
            token = details_token(_when(_field(row, 'next_interview')), _field(row, 'stage'))
            ledger_store.add_event(stores, row, 'Details skipped', APP_SOURCE, note="You don't know the employer yet",
                                   source_id=f'skip-details:{token}')
        else:
            ledger_store.add_event(stores, row, REPLIED, APP_SOURCE, note='You followed up (marked done in Focus)'
                                   if args.what == 'followed_up' else 'You answered (marked done in Focus)')
        print(json.dumps({'ok': True}))
        return 0
    focus = load(stores, target=args.target)
    if args.command == 'remind':
        text = reminder(focus)
        if text and args.send:
            from .features import disabled
            if not disabled('telegram'):
                token, chat_id = telegram.credentials()   # (None, None) = e-mail only
                telegram.send(reminder_card(focus), token, chat_id)
        print(json.dumps({'text': text}))
        return 0
    print(json.dumps(focus, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
