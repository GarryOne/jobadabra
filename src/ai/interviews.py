#!/usr/bin/env python3
"""Interview analysis: a recording, a transcript file or typed notes -> 🎤 Interviews.

The Worker passes the Telegram file id (or the notes text) to a `--mode interview` run; the desktop app
passes a file on the Mac, and optionally the job it belongs to (--job <job URL>). A recording (voice note,
audio or video) is first transcribed on the machine, with speakers, by transcribe.py (open-source models,
free). This module strips subtitle timing (.srt/.vtt), and asks Claude Sonnet 5 in one call to
(1) pick which application the interview belongs to (unless the job was given), from the caption and the transcript, and
(2) pull out the questions by topic, how each was answered, strengths, weak spots, signals from the
interviewers, the next step and what to practise.

The same call (3) pulls out the facts the call revealed about the job (salary, contract, relocation, place,
team, visa, start date), each only when said and with a short quote.

The result is a 🎤 Interviews row linked to the application (analysis plus the full transcript in its
page body) and the application moved on (advance(): the call happened, so a Recruiter lead, Screening or
Interview scheduled is Interviewing now; never back, never a closed stage), with its 📈 Application Events row,
Next step from the review, a past Next interview cleared and the call's facts filled into empty fields (a
different value already there is not overwritten: the review page and the summary show both). Then a Telegram
summary. The daily insight and weekly report read the Interviews rows.
A row reviewed before can be reviewed again from the app (review_again(): the review replaced, only empty fields
of the job filled, no Stage change or event). A recording saved without a review moves the application on the same way (save(), link()); an interview
that wasn't recorded is confirmed from Focus ("Did it happen?": held(), moved(), cancelled()).
Each user's Notion is their own private database; the transcript stays there and in Telegram.
"""
from datetime import datetime, timezone
from html import escape
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import urllib.request

from . import cost
from . import engine
from . import meanings
from . import transcribe
from .. import tgcard, tz
from ..notion.titles import named
from ..features import disabled
from ..stores import chosen, open_stores, rules
from ..stores.notion_blocks import to_markdown
from ..telegram import api_base as telegram_api_base
from .interviews_ai import (
    DEFAULT_MODEL, FACTS, FALLBACK_MODEL, MAX_CHARS,
    MAX_TOKENS, NOT_STATED, SCHEMA, SELECT_OPTIONS,
    SYSTEM, TEXT_TYPES, analyse, ask,
    candidates)
from .interviews_blocks import (
    NO_JOB, _block, analysis_blocks,
    changes_lines, changes_summary, interview_title,
    job_line, message, page_blocks, review_fields,
    transcript_toggle)
from .interviews_facts import _call_facts, _norm, fact_lines, facts_of, merge_facts  # noqa: F401
from .interviews_input import clean, download, read_input  # noqa: F401
from .interviews_review import (
    PLACEHOLDER, REVIEW_HEADINGS, _plain_block, review_block_ids)
from .interviews_stages import (
    APP_SOURCE, BEFORE_INTERVIEW, CANCELLED, CANDIDATE_STAGES,
    CLOSED, IN_TALKS, held_stage)
from .interviews_apps import app_by_id, application_for, by_url, role, who  # noqa: F401


INTERVIEWS_DATABASE_ID = os.getenv('NOTION_INTERVIEWS_DB', '')  # mail_calendar.py and prep.py still read Notion by it


def _moment(value):
    try:
        moment = datetime.fromisoformat((value or '').replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=tz.local_zone())  # a clock without an offset is the owner's, as everywhere


def advance(stores, app, *, now=None, round_='', next_step='', changes=None, note='', source='Telegram', clear_past=True):
    """An interview of this application (a record) was held: Stage forward (held_stage), a 📈 Application Events row of
    that kind unless one exists (a review is often sent days after the call, which was usually logged already), Next
    step from the review, a past Next interview cleared (clear_past), plus `changes` (the call's facts, record fields),
    in one update. An application at a closed stage (Offer, Rejected, …) is left alone. Returns the new Stage or None."""
    now = now or datetime.now(timezone.utc)
    stage = app.get('stage') or ''
    if stage in CLOSED:
        return None
    target = held_stage(stage, round_)
    kind = target or ('Screening' if meanings.round_kind(round_) == 'recruiter_screen' else 'Interviewing')  # what was held
    if not stores.events.list(app_id=app['id'], kind=kind):
        rules.add_event(stores, app, kind, source, note=note)
    update = dict(changes or {})
    if target:
        update['stage'] = target
    if next_step and not NOT_STATED.match(next_step):
        update['next_step'] = next_step[:2000]
    coming = _moment(app.get('next_interview'))
    if clear_past and coming and coming <= now:
        update['next_interview'] = ''
    if update:
        stores.applications.update(app['id'], update)
    return target


def _url(stores, record_id):
    return stores.link(record_id) or ''


def run(*, file_id=None, note='', token=None, send=None, model=DEFAULT_MODEL, client=None,
        now=None, opener=urllib.request.urlopen, stats=None, job_url=None, page_id=None, found=None, stores=None):
    """Analyse one interview (a recording, a transcript file, or notes text) and record it. Returns a log line ending
    with the interview's link (when the store has links). job_url links it to that application instead of guessing.
    page_id reviews an interview saved earlier (save()): its transcript is read from the store, the review added to it
    and its job kept unless job_url changes it. One already reviewed is reviewed again (review_again). found (a dict)
    gets the reviewed job's application id as 'application', once known. stores: the active store (else open_stores())."""
    stores = stores or open_stores()
    now = now or datetime.now(timezone.utc)
    caption, transcript, recorded = note, '', False
    saved = stores.interviews.get(page_id) if page_id else None
    if page_id and not saved:
        raise ValueError('This interview is no longer there')
    # One that already has a review (Overall set) is reviewed again: see review_again() below.
    again = bool(saved and saved.get('overall'))
    if saved:
        transcript = saved.get('transcript') or ''
        if not transcript:
            raise ValueError('This interview has no transcript saved')
        caption = note or saved.get('title') or ''
        recorded = saved.get('input') == 'Recording'
    elif file_id:
        _, transcript, recorded = read_input(file_id, token, opener)
    else:
        # "/interview <caption line>\n<notes>" — the first line names the interview, the rest is notes.
        body = re.sub(r'^/interview(@\w+)?\s*', '', note or '')
        caption, _, transcript = body.partition('\n')
        transcript = transcript.strip() or caption
    if len(transcript.strip()) < 40:
        raise ValueError('Too little text to analyse. Send the recording or transcript file, or /interview <company, round> '
                         'with your notes on the next lines.')
    truncated = len(transcript) > MAX_CHARS
    transcript = transcript[:MAX_CHARS]
    apps = candidates(stores)
    chosen_app = (by_url(stores, apps, job_url) or application_for(stores, job_url)) if job_url else None
    if saved and not chosen_app and saved.get('app_id'):
        chosen_app = app_by_id(stores, saved['app_id'], apps) or app_by_id(stores, saved['app_id'])
    if chosen_app and chosen_app not in apps:
        apps = [chosen_app] + apps
    if client is None:
        client = engine.client(action='interview')
    result, usage, model = analyse(client, model, stores.texts.plain('profile'), apps, caption, transcript)
    cost.add(stats, model, usage)
    usd = cost.usd(model, usage)
    app = chosen_app or (apps[result['application']] if 0 <= result['application'] < len(apps) else None)
    if again:  # a review again: the interview keeps its job; no guess links it elsewhere
        app = chosen_app
    if app and found is not None:
        found['application'] = app['id']
    if found is not None:  # the interview's title, for the run's ("Huxley · Recruiter screen"); a review again keeps its own
        found['title'] = (saved.get('title') if again else '') or interview_title(result['company'], result['round'], app)
    source = (saved.get('input') or 'Transcript') if saved else ('Recording' if recorded else 'Transcript' if file_id else 'Notes')
    fields = review_fields(result, app, now.date(), cost.answered(model, usage), usd, source)
    # An application at a closed stage is never touched: its facts are only listed on the review.
    merged = merge_facts(app, result) if app and app.get('stage') not in CLOSED else None
    fields['review'] = to_markdown(analysis_blocks(result, merged))
    if again:
        return review_again(stores, page_id, saved, result, app, merged, fields, usd, send, truncated)
    if saved:
        fields.pop('at')  # the day it was held, set when it was saved
        row = stores.interviews.save(page_id, fields)
    else:
        row = stores.interviews.save(None, {**fields, 'transcript': transcript})
    stage = None
    if app:
        stage = advance(stores, app, now=now, round_=result['round'], next_step=result['next_step'],
                        changes=(merged or {}).get('changes'), note=f"{result['round']}: {result['overall']}")
    link = _url(stores, row['id'])
    if send:
        send(message(result, app, link, usd, truncated, merged, stage))
    where = (who(app) or 'linked') if app else 'unlinked'
    extra = changes_summary(merged, stage)
    return (f"Interview analysed ({where}, {result['round']}, {len(result['questions'])} questions, ${usd:.3f})"
            f"{f'. {extra[0].upper()}{extra[1:]}' if extra else ''} {link}").strip()


def review_again(stores, page_id, saved, result, app, merged, fields, usd, send=None, truncated=False):
    """The Interviews page's "Review again" (one reviewed before, e.g. before facts were extracted): the review is
    replaced, the interview keeps its title, date, input and job, its cost adds this call's, and the job gets only what
    it lacks: the call's facts in EMPTY fields (merge_facts) and Next step when it's empty. No Stage change, no event,
    no Next interview cleared: the call was held and counted at the first review. Twice changes nothing more on the job."""
    for kept in ('at', 'title', 'input', 'app_id'):
        fields.pop(kept, None)
    fields['cost'] = round((saved.get('cost') or 0) + usd, 4)
    stores.interviews.save(page_id, fields)
    update = {}
    if app and merged is not None:
        update = dict(merged.get('changes') or {})
        step = result.get('next_step') or ''
        if step and not NOT_STATED.match(step) and not app.get('next_step'):
            update['next_step'] = step[:2000]
        if update:
            stores.applications.update(app['id'], update)
    link = _url(stores, page_id)
    if send:
        send(message(result, app, link, usd, truncated, merged))
    where = (who(app) or 'linked') if app else 'unlinked'
    extra = '; '.join(filter(None, ('' if (merged or {}).get('filled') or 'next_step' in update else 'nothing new for the job',
                                    changes_summary(merged), 'Next step set' if 'next_step' in update else '')))
    return (f"Interview analysed again ({where}, {result['round']}, {len(result['questions'])} questions, ${usd:.3f})"
            f". {extra[0].upper()}{extra[1:]} {link}").strip()


def save(stores, transcript, title, *, job_url=None, source='Recording', now=None, page_id=None):
    """A transcript as an interview, without AI: title, date, input, the chosen job and the transcript (the review comes
    later). Returns the interview record. With page_id (the one the app created as soon as the transcript was ready), that
    one is updated instead: title, job, and the transcript replaced by the edited one (speakers named).
    A recorded call was held: the chosen job moves on (advance), keeping a past Next interview until the review,
    so Focus asks to review it."""
    now = now or datetime.now(timezone.utc)
    transcript = transcript.strip()[:MAX_CHARS]
    if len(transcript) < 40:
        raise ValueError('Too little text to save')
    app = application_for(stores, job_url) if job_url else None
    fields = {'title': (title or 'Interview')[:200], 'input': source, 'transcript': transcript, 'app_id': app['id'] if app else ''}
    if page_id:  # the day it was first saved stays
        row = stores.interviews.save(page_id, fields)
    else:
        row = stores.interviews.save(None, {**fields, 'at': now.date().isoformat()})
    if app:
        advance(stores, app, now=now, round_=title, note=f'{source} saved', source=APP_SOURCE, clear_past=False)
    return row


def link(stores, page_id, job_url=None):
    """Set (or with no job_url, clear) the application an interview belongs to."""
    app = application_for(stores, job_url) if job_url else None
    stores.interviews.save(page_id, {'app_id': app['id'] if app else ''})
    if app:  # a recorded call belongs to this job: it was held
        advance(stores, app, note='Interview linked', source=APP_SOURCE, clear_past=False)
    return app['id'] if app else None


def listing(stores, limit=100, places=True):
    """Interviews for the app, newest first: reviewed when Overall is set. `place` is where the linked job is (its
    Location and Work mode; places=False skips them: the Calendar does not show a place)."""
    apps = {key: app for app in (stores.applications.list() if places else []) for key in (app['id'].replace('-', ''),)}
    rows = []
    for row in stores.interviews.list():
        app = apps.get((row.get('app_id') or '').replace('-', ''))
        rows.append({'id': row['id'], 'url': _url(stores, row['id']), 'title': row.get('title') or 'Interview',
                     'date': row.get('at') or (row.get('created_at') or '')[:10],
                     'input': row.get('input') or '', 'overall': row.get('overall') or '',
                     'round': row.get('round') or '', 'next_step': row.get('next_step') or '',
                     'application': [row['app_id']] if row.get('app_id') else [],
                     'place': {'location': app.get('location') or '', 'work_mode': app.get('work_mode') or ''} if app else {}})
    rows.sort(key=lambda r: r['date'], reverse=True)
    return rows[:limit]


NO_NOTES = 'No notes written. The interview was held (confirmed in Focus).'


def _app(stores, app_id):
    found = app_by_id(stores, app_id)
    if not found:
        raise ValueError('This job is no longer in your applications')
    return found


def held(stores, app_id, notes='', *, now=None):
    """Focus → "Yes, it happened": an interview (Input Notes, dated the day of the interview) with the notes where a
    transcript goes, and the application moved on. review: the notes are long enough for a review (the app then runs
    it, on this Mac or on GitHub)."""
    now = now or datetime.now(timezone.utc)
    app = _app(stores, app_id)
    coming = _moment(app.get('next_interview'))
    day = (coming if coming and coming <= now else now).date().isoformat()
    notes = (notes or '').strip()[:MAX_CHARS]
    row = stores.interviews.save(None, {'title': f"{who(app) or 'Interview'} · {role(app) or 'interview'}"[:200], 'at': day,
                                        'input': 'Notes', 'app_id': app['id'], 'transcript': notes or NO_NOTES})
    stage = advance(stores, app, now=now, note='Held (confirmed in Focus)', source=APP_SOURCE)
    return {'ok': True, 'id': row['id'], 'url': _url(stores, row['id']), 'stage': stage, 'review': len(notes) >= 40}


def moved(stores, app_id, at):
    """Focus → "No: moved": Next interview is the new time, and an Interview scheduled event says so."""
    if not _moment(at):
        raise ValueError('Pick the new date and time')
    at = tz.local_iso(at)  # the picker has no offset: the owner's clock with the offset of that date
    app = _app(stores, app_id)
    stores.applications.update(app['id'], {'next_interview': at})
    rules.add_event(stores, app, 'Interview scheduled', APP_SOURCE, note=f'Moved to {at} (from Focus)', interview_at=at)
    return {'ok': True}


def cancelled(stores, app_id):
    """Focus → "No: cancelled": an Interview cancelled event, Next interview cleared; the Stage stays."""
    app = _app(stores, app_id)
    rules.add_event(stores, app, CANCELLED, APP_SOURCE, note='The interview did not happen (from Focus)')
    stores.applications.update(app['id'], {'next_interview': ''})
    return {'ok': True}


def sweep(now=None, stores=None):
    """Applications still at Recruiter lead / Screening / Interview scheduled whose Next interview has passed and
    which have an interview from that day on (recorded): moved on (advance), as a review would.
    For interviews saved before save() did it. Returns a one-line summary."""
    stores = stores or open_stores()
    now = now or datetime.now(timezone.utc)
    days = {}
    for row in stores.interviews.list():
        app_key = (row.get('app_id') or '').replace('-', '')
        if app_key:
            days[app_key] = max(days.get(app_key, ''), (row.get('at') or '')[:10])
    moved_on = 0
    for app in stores.applications.list(stages=list(IN_TALKS)):
        coming = _moment(app.get('next_interview'))
        if coming and coming <= now and days.get(app['id'].replace('-', ''), '') >= coming.date().isoformat():
            advance(stores, app, now=now, note='Recorded interview', source='Auto rule', clear_past=False)
            moved_on += 1
    return f'Interview sweep: {moved_on} application(s) moved on after a recorded interview.'


NOT_CONNECTED = 'Connect Notion first: interviews are kept in 🎤 Interviews.'


def notion_unusable(env):
    """True when the store is Notion but it can't be reached: no token, or JOB_PILOTTO_DISABLE=notion (as no token)."""
    return chosen(env) == 'notion' and (disabled('notion') or not env.get('NOTION_TOKEN'))


def open_for_commands(env=None):
    """(stores, None) for the app's commands, or (None, message) when the store is Notion and it isn't connected."""
    env = os.environ if env is None else env
    if notion_unusable(env) or (chosen(env) == 'notion' and not INTERVIEWS_DATABASE_ID):
        return None, NOT_CONNECTED
    return open_stores(env), None


def main(argv=None):
    """JSON commands for the desktop app's Interviews page (on the active store; nothing here uses AI)."""
    import argparse
    parser = argparse.ArgumentParser(description=main.__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('list')
    sub.add_parser('calendar', help='the rows only: no places, no insight (the Calendar)')
    saving = sub.add_parser('save', help='a transcript file as a new interview')
    saving.add_argument('file', type=Path)
    saving.add_argument('--title', default='')
    saving.add_argument('--job', help='job URL of the application it belongs to')
    saving.add_argument('--input', default='Recording', choices=('Recording', 'Transcript', 'Notes'))
    saving.add_argument('--page', help='update this interview (created when the transcript was ready) instead of adding one')
    deleting = sub.add_parser('delete', help="archive an interview (Notion: its trash)")
    deleting.add_argument('page')
    linking = sub.add_parser('link', help="set an interview's application (no --job: clear it)")
    linking.add_argument('page')
    linking.add_argument('--job')
    holding = sub.add_parser('held', help='Focus: the interview happened (notes optional)')
    holding.add_argument('app')
    holding.add_argument('--notes', default='')
    moving = sub.add_parser('moved', help='Focus: the interview moved to a new time')
    moving.add_argument('app')
    moving.add_argument('--at', required=True)
    cancelling = sub.add_parser('cancelled', help='Focus: the interview did not happen')
    cancelling.add_argument('app')
    args = parser.parse_args(argv)
    stores, problem = open_for_commands()
    if stores is None:
        print(json.dumps({'ok': False, 'error': problem}))
        return 1
    try:
        if args.command == 'list':
            problems = []
            out = {'ok': True, 'interviews': listing(stores), 'insight': saved_insight(stores, problems)}
            if problems:
                out['insight_error'] = problems[0]  # the app logs it and says so on the card; the list still shows
        elif args.command == 'calendar':
            out = {'ok': True, 'interviews': listing(stores, places=False)}
        elif args.command == 'save':
            row = save(stores, args.file.read_text(encoding='utf-8'), args.title, job_url=args.job, source=args.input,
                       page_id=args.page)
            out = {'ok': True, 'id': row['id'], 'url': _url(stores, row['id'])}
        elif args.command == 'delete':
            stores.interviews.archive(args.page)
            out = {'ok': True}
        elif args.command == 'held':
            out = held(stores, args.app, args.notes)
        elif args.command == 'moved':
            out = moved(stores, args.app, args.at)
        elif args.command == 'cancelled':
            out = cancelled(stores, args.app)
        else:
            out = {'ok': True, 'application': link(stores, args.page, args.job)}
    except ValueError as error:
        out = {'ok': False, 'error': str(error)}
    print(json.dumps(out))
    return 0 if out['ok'] else 1


def saved_insight(stores, problems=None):
    """The Interviews page's insight (💡 Insights, Interview patterns), or None; a failed read never fails the list.
    problems: gets the reason (error type and message, no values), for the app's log and the card."""
    from . import interview_insights
    try:
        return interview_insights.saved(stores)
    except Exception as error:  # noqa: BLE001
        reason = f'{type(error).__name__}: {error}'
        print(f'Warning: interview insights unreadable: {reason}', file=sys.stderr)
        if problems is not None:
            problems.append(reason)
        return None


if __name__ == '__main__':
    raise SystemExit(main())
