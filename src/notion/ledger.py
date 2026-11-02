#!/usr/bin/env python3
"""The application ledger: what was sent for each application, and what happened afterwards.

Two parts, both in Notion (each user's own private workspace is their database):

- **Application record**, frozen on the job's Applications row when it's marked Applied: analysis
  columns (fit score, tier, seniority, work mode, ATS, agent, days from posting to applying, CV
  version, ...) plus a "🗂 Application record" toggle section in the page body with the job
  description, every question with the answer actually submitted (read from the form just before
  Submit when available, else the kit draft), the cover letter and a JSON block for analysis.
- **📈 Application Events**: one row per outcome change (Applied, Screening, Rejected, ...) with a
  time and how it was recorded. Stage on Applications only holds the latest; this is the history.

`sync` runs with the scheduled crawl: a Stage edited by hand in Notion becomes an event, and an
application with no reply after NO_RESPONSE_DAYS is moved to "No response".

Usage:
  python -m src.notion.ledger record <job URL> [--agent claude] [--force]
  python -m src.notion.ledger event <job URL> <stage> [--note TEXT]
  python -m src.notion.ledger sync [--dry-run]
  python -m src.notion.ledger add <job URL> [--applied "on or before 23 Sep"] [--channel ...] [--via ...]

The commands run on the active store (src/ledger_store.py, the same rules on records); the functions here that take a
Notion `tracker` stay for the callers that still hold one.
"""
import argparse
import hashlib
import json
import re
import os
import html
import json as _json
import re
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

from . import client as notion
from . import origin as origin_rule
from ..ai import kit as kit_module
from .. import tz
from ..sources import ats
# The pieces (see each file's docstring); every name stays importable from this module.
from .ledger_blocks import (plain, _text, _chunks, _block, _rich, _typed, md_blocks, _key, _day)  # noqa: F401
from .ledger_record import (RECORD_HEADING, RECORD_VERSION, RECRUITER_PLATFORMS, ATS_NAMES, AGENTS, SELECTS,  # noqa: F401
                            run_from_notion, cv_version, match_for, answers_for, channel_for, build,
                            _fitted_json, record_blocks)
from .ledger_events_util import (WATCHER_SOURCES, PAST_INTERVIEW_DAYS, FUTURE_INTERVIEW_DAYS,  # noqa: F401
                                 SAME_OCCURRENCE_HOURS, plausible_interview, _link_ids, event_interview_at,
                                 _same_occurrence, moment, repeat_of)
from .ledger_intake import (MONTHS, NUMBER_WORDS, WALLED, _relative, parse_applied, walled, _visible_text,  # noqa: F401
                            page_meta)

EVENTS_DATABASE_ID = os.getenv('NOTION_EVENTS_DB', '')
NO_RESPONSE_DAYS = 30
APP_SUPPORT = Path.home() / 'Library' / 'Application Support' / 'JobPilotto'
SNAPSHOT_DIR = Path(os.getenv('JOBADABRA_FORM_SNAPSHOT_DIR', str(APP_SUPPORT / 'form-snapshots')))
RUN_DIR = Path(os.getenv('JOBADABRA_APPLY_RUN_DIR', str(APP_SUPPORT / 'apply-runs')))
DEFAULT_CV = os.getenv('JOBADABRA_CV_PATH',
                       str(Path.home() / 'Documents' / 'CV.pdf'))
# Stages that are real application outcomes, in funnel order; each one is also an event Kind.
OUTCOME_STAGES = ('Applied', 'Confirmation received', 'Screening', 'Interview scheduled',
                  'Interviewing', 'Offer', 'Rejected', 'Withdrawn', 'No response')
# An event without a Stage of its own: a human replied (invitation to book a call, a recruiter's email).
REPLY = 'Reply received'
EVENT_KINDS = OUTCOME_STAGES + (REPLY,)
# Still waiting for a human reply: the no-response rule applies only to these.
WAITING_STAGES = ('Applied', 'Confirmation received')
CHANNELS = ('Direct', 'Recruiter platform', 'Agency', 'Referral')




def form_snapshot(url, directory=None):
    """Field values read from the application page just before Submit by
    tools/wait-and-mark-applied.sh, or None when that capture wasn't available."""
    path = Path(directory or SNAPSHOT_DIR) / f'{notion.job_code(url)}.json'
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return data if data.get('fields') else None


def run_state(url, directory=None):
    """The local form-filling run record (agent, minutes), if a launcher recorded one."""
    try:
        return json.loads((Path(directory or RUN_DIR) / f'{notion.job_code(url)}.json').read_text())
    except (OSError, json.JSONDecodeError):
        return None




def record(tracker, url, *, now=None, force=False, posting=ats.posting, cv_path=DEFAULT_CV,
           snapshot_dir=None, run_dir=None):
    """Freeze the application record on the job's Applications row. Returns (page, outcome) with
    outcome 'recorded' or 'exists' (already frozen; force=True rewrites it)."""
    now = now or datetime.now(timezone.utc)
    row = tracker.find(url)
    if not row:
        raise LookupError(f'No Applications row for {url}')
    form = form_snapshot(url, snapshot_dir)
    # An existing record is kept, unless it only had kit drafts and the submitted form is now known
    # (e.g. ✅ tapped in Telegram before the watcher saw the confirmation page).
    upgrade = form and plain(row['properties'].get('Answers captured')) != 'Form'
    if plain(row['properties'].get('Recorded')) and not (force or upgrade):
        return row, 'exists'
    kit = tracker.read_kit(row['id'], kit_module.KIT_HEADING)
    run = run_state(url, run_dir)
    if run is None and hasattr(tracker, '_request'):
        run = run_from_notion(tracker, row)
    properties, data = build(url, row, kit, match_for(tracker, url, row), posting(url),
                             form, run, cv_version(cv_path), now)
    tracker.update_page(row['id'], properties)
    tracker.replace_section(row['id'], RECORD_HEADING, record_blocks(data))
    return row, 'recorded'





def events_of(tracker, page):
    """This application's 📈 Application Events rows."""
    key = page['id'].replace('-', '')
    try:
        events = tracker.query_database(EVENTS_DATABASE_ID, {'property': 'Application', 'relation': {'contains': page['id']}})
    except AttributeError:  # a tracker without the events database (partial test fakes)
        return []
    return [e for e in events if key in _link_ids(e)]




def _as_record(event):
    """A 📈 Application Events row as the plain values repeat_of reads; the row itself under 'row'."""
    props = event['properties']
    return {'kind': plain(props.get('Kind')), 'at': plain(props.get('At')), 'source_id': plain(props.get('Source ID')),
            'interview_at': event_interview_at(event), 'row': event}


def existing_event(tracker, page, kind, *, source_id='', interview_at='', at=None):
    """The event this one would repeat, or None when it is genuinely new (the rule: repeat_of)."""
    events = [_as_record(e) for e in events_of(tracker, page)]
    by_source = []
    if source_id and not any(e['source_id'] == source_id for e in events):
        try:  # the same message may sit on another job's page (a mis-filed one): still the same message
            by_source = [_as_record(e) for e in tracker.query_database(
                EVENTS_DATABASE_ID, {'property': 'Source ID', 'rich_text': {'equals': source_id}})]
        except AttributeError:
            pass
    found = repeat_of(events, kind, OUTCOME_STAGES, source_id=source_id, interview_at=interview_at, at=at,
                      by_source=by_source)
    return found['row'] if found else None


def add_event(tracker, page, kind, source, *, at=None, note='', source_id='', interview_at=''):
    """One 📈 Application Events row linked to the Applications page. Idempotent: an event this one would repeat
    (see existing_event — the same thing, recorded twice, within SAME_OCCURRENCE_HOURS) is not written again; that
    existing row is returned, marked `_existing`. A genuinely later event of the same kind is a new row. An
    impossible interview time (plausible_interview) is never stored."""
    interview_at = plausible_interview(interview_at, at)
    props = page['properties']
    if not at and kind == 'Applied':
        at = plain(props.get('Applied on'))  # the application's own date, never "now" for an old one
    at = at or datetime.now(timezone.utc).isoformat(timespec='seconds')
    found = existing_event(tracker, page, kind, source_id=source_id, interview_at=interview_at, at=at)
    if found:
        return {**found, '_existing': True}
    company = plain(props.get('Company')) or plain(props.get('Job')) or 'application'
    properties = {
        'Event': {'title': [{'text': {'content': f'{kind} · {company}'[:200]}}]},
        'Application': {'relation': [{'id': page['id']}]},
        'Kind': {'select': {'name': kind}},
        'At': {'date': {'start': at}},
        'Source': {'select': {'name': source}},
        'Note': _text(note),
    }
    if source_id:
        properties['Source ID'] = _text(source_id)
    url = plain(props.get('Job URL'))
    if url:
        properties['Job URL'] = {'url': url}
    if interview_at:  # what makes a second "Interview scheduled" a new one; Changes is optional (older workspaces)
        try:
            return tracker.create_page(EVENTS_DATABASE_ID, {**properties, 'Changes': _text(json.dumps({'fields': {}, 'interview_at': interview_at}))})
        except Exception:  # noqa: BLE001
            pass
    return tracker.create_page(EVENTS_DATABASE_ID, properties)


def mark_applied(tracker, url, source='CLI', **record_options):
    """Stage -> Applied, an Applied event, and the frozen record. The record never blocks the
    marking: a failure there is reported, and `record --force` can redo it later."""
    page, outcome = tracker.mark({'url': url}, 'Applied')
    lines = [f'{url}: {outcome}']
    if outcome != 'unchanged':
        add_event(tracker, page, 'Applied', source)
    try:
        _, recorded = record(tracker, url, **record_options)
        lines.append(f'application record: {recorded}')
    except Exception as error:  # noqa: BLE001 — marking must succeed even if the snapshot can't
        lines.append(f'application record skipped: {type(error).__name__}: {error}')
    return '\n'.join(lines)


def set_stage(tracker, url, stage, source='CLI', note=''):
    """Move an application to an outcome stage and log the event."""
    if stage not in EVENT_KINDS:
        raise ValueError(f'Stage must be one of: {", ".join(EVENT_KINDS)}')
    if stage == 'Applied':
        return mark_applied(tracker, url, source)
    row = tracker.find(url)
    if not row:
        raise LookupError(f'No Applications row for {url}')
    if stage != REPLY:  # a reply is an event only; Stage stays where it is
        changes = {'Stage': {'select': {'name': stage}}}
        if stage == 'Rejected' and not plain(row['properties'].get('Feedback status')):
            from .. import feedback
            history = [{'kind': plain(e['properties'].get('Kind')), 'at': plain(e['properties'].get('At'))}   # the row's own events
                       for e in tracker.query_database(EVENTS_DATABASE_ID, {'property': 'Application', 'relation': {'contains': row['id']}})]
            if plain(row['properties'].get('Stage')) in feedback.REACHED or \
                    feedback.eligible_status(plain(row['properties'].get('Feedback status')), history):
                changes['Feedback status'] = {'select': {'name': 'Not asked'}}
        tracker.update_page(row['id'], changes)
    add_event(tracker, row, stage, source, note=note)
    return f'{url}: {stage}'




def archive_events(tracker, page, kind):
    """Trash this application's 📈 Application Events rows of one kind, and say how many. For a record the owner says
    did not happen — an "Applied" the extension inferred on its own (1 Oct 2026) — so the application's timeline does
    not keep a submission that never was. Notion's trash holds them for 30 days."""
    dropped = 0
    for event in events_of(tracker, page):
        if ((event['properties'].get('Kind') or {}).get('select') or {}).get('name') != kind:
            continue
        tracker._request('PATCH', f"pages/{event['id']}", {'archived': True})
        dropped += 1
    return dropped


def latest_events(tracker):
    """Applications page id -> {'kind', 'at'} of its latest Stage-type event, plus 'last' (time of its
    latest event of any kind) and 'replied' (whether a Reply received event exists)."""
    latest = {}
    for event in tracker.query_database(EVENTS_DATABASE_ID):
        props = event['properties']
        at, kind = plain(props.get('At')) or '', plain(props.get('Kind'))
        for link in (props.get('Application') or {}).get('relation', []):
            item = latest.setdefault(link['id'].replace('-', ''), {'kind': None, 'at': '', 'last': '', 'replied': False})
            item['last'] = max(item['last'], at, key=moment) if item['last'] else at
            item['replied'] |= kind == REPLY
            item.setdefault('kinds', set()).add(kind)
            if kind in OUTCOME_STAGES and (not item['at'] or moment(at) >= moment(item['at'])):
                item.update(kind=kind, at=at)
    return latest


def sync(tracker, now=None, no_response_days=NO_RESPONSE_DAYS, dry_run=False):
    """Log Stage changes made by hand in Notion as events, and move applications with no reply
    after no_response_days to No response. Returns a one-line summary."""
    now = now or datetime.now(timezone.utc)
    rows = tracker.query_database(tracker.database_id, {'or': [
        {'property': 'Stage', 'select': {'equals': stage}} for stage in OUTCOME_STAGES]})
    latest = latest_events(tracker)
    logged, silent = 0, 0
    for row in rows:
        props = row['properties']
        stage = plain(props.get('Stage'))
        info = latest.get(row['id'].replace('-', ''), {'kind': None, 'at': '', 'last': '', 'replied': False})
        last_at = info['last']
        # Never a second event of a kind the application already has: Jobadabra's own events (Gmail, Telegram,
        # the app) move Stage too, and a later event of another kind must not make that look like a hand edit.
        if info['kind'] != stage and stage not in info.get('kinds', ()):
            when = plain(props.get('Applied on')) if stage == 'Applied' else row.get('last_edited_time')
            if not dry_run:
                source, note = (('Backfill', 'First event for an application tracked before the ledger')
                                if info['kind'] is None else
                                ('Notion edit', 'Stage changed in Notion; time is when the row was last edited'))
                add_event(tracker, row, stage, source, at=when or now.isoformat(timespec='seconds'), note=note)
            logged, last_at = logged + 1, max(last_at, when or '', key=moment)
        applied = _day(plain(props.get('Applied on')))
        last = _day(last_at) or applied
        if (stage in WAITING_STAGES and not info['replied'] and applied and last
                and (now.date() - last).days >= no_response_days):
            if not dry_run:
                tracker.update_page(row['id'], {'Stage': {'select': {'name': 'No response'}}})
                add_event(tracker, row, 'No response', 'Auto rule',
                          note=f'No reply {(now.date() - applied).days} days after applying')
            silent += 1
    return f'Ledger sync: {len(rows)} applications, {logged} stage change(s) logged, {silent} moved to No response.'


# A job you saved or drafted a kit for, but haven't applied to: the only stages a taken-down posting is closed from.
NOT_STARTED = ('Saved', 'Kit ready')


def close_gone(tracker, open_urls=None, dry_run=False):
    """Saved / Kit ready jobs whose posting was taken down → Stage Closed (never deleted: the kit stays). The crawl
    not seeing a job only picks what to check (a filter change does that too); the job's own board decides, and a
    board that can't tell (unsupported, down) closes nothing. Returns (summary line, ["Title (Company)", …])."""
    rows = tracker.query_database(tracker.database_id, {'or': [
        {'property': 'Stage', 'select': {'equals': stage}} for stage in NOT_STARTED]})
    closed = []
    for row in rows:
        props = row['properties']
        url = ((props.get('Job URL') or {}).get('url') or '').strip()
        if not url or (open_urls is not None and url in open_urls):
            continue
        company = plain(props.get('Company'))
        if ats.is_live(url, company) is not False:
            continue
        # Read again just before writing: the owner may have started applying since the query.
        current = tracker.find(url)
        if plain((current or {}).get('properties', {}).get('Stage')) not in NOT_STARTED:
            continue
        name = f"{plain(props.get('Job')) or url} ({company or '?'})"
        print(f'Posting taken down, marked Closed: {url} · {name}')
        if not dry_run:
            tracker.update_page(current['id'], {'Stage': {'select': {'name': 'Closed'}}})
        closed.append(name)
    return f'Taken-down postings: {len(rows)} saved/kit-ready job(s), {len(closed)} closed.', closed




def company_for(tracker, url, meta):
    """The employer of a job page: its metadata, else the scored job's (job board APIs often omit it), else the
    board's slug in the URL."""
    if meta.get('company'):
        return meta['company']
    found = ats.detect(url)
    return match_for(tracker, url).get('Company') or (found[1].replace('-', ' ').title() if found else '')


def add_application(tracker, url, *, applied=None, approx=False, channel=None, via=None, source='CLI',
                    meta=None, today=None, origin=None, found=None):
    """Track an application made outside Jobadabra (or before it): the Applications row, an Applied
    event on the application's date, and the frozen record. Returns a one-line summary.
    found: a dict that gets the job's row and whether it was created (not updated), for the run's link to it."""
    today = today or date.today()
    applied = applied or today
    meta = dict(meta if meta is not None else page_meta(url))
    meta['company'] = company_for(tracker, url, meta)
    guess_channel, guess_via = channel_for(url)
    channel, via = channel or guess_channel, via if via is not None else guess_via
    text = lambda value: _text(value or '')
    props = {'Stage': {'select': {'name': 'Applied'}}, 'Applied on': {'date': {'start': applied.isoformat()}},
             'Date approximate': {'checkbox': bool(approx)}, 'Channel': {'select': {'name': channel}}}
    if via:
        props['Via'] = text(via)
    # The fit columns src/ai/added.py worked out before this row existed (a job you add has no Job Matches row).
    columns = meta.get('application_columns') or {}
    row = tracker.find(url)
    existed = bool(row)
    if row:
        stage = plain(row['properties'].get('Stage'))
        if stage in OUTCOME_STAGES and stage != 'Applied':
            return f'Already tracked at {stage}: {plain(row["properties"].get("Job"))}'
        props.update({name: value for name, value in columns.items()
                      if name == 'Fit score' or not plain(row['properties'].get(name))})  # what you set stays
        tracker.update_page(row['id'], props)
    else:
        posted = (meta.get('date_posted') or '')[:10]
        props.update({
            'Job': {'title': [{'text': {'content': (meta.get('title') or url)[:200]}}]},
            'Company': text(meta.get('company')), 'Location': text(meta.get('location')),
            'Job URL': {'url': url}, 'Source': {'select': {'name': 'Manual' if source == 'CLI' else source}},
        })
        if _day(posted):
            props['Posted'] = {'date': {'start': posted}}
        props.update(columns)
        # Applied elsewhere: a job you went after (Outbound), unless the caller knows it found you (origin).
        row = tracker.create_page(tracker.database_id, origin_rule.stamp(props, origin or origin_rule.OUTBOUND))
    row = tracker.find(url) or row
    if found is not None:
        found.update(row=row, created=not existed)
    add_event(tracker, row, 'Applied', source, at=applied.isoformat(),
              note='Applied outside Jobadabra' + ('; date is an upper bound (on or before)' if approx else ''))
    try:
        _, recorded = record(tracker, url, posting=lambda _url: meta)
    except Exception as error:  # noqa: BLE001
        recorded = f'record skipped: {type(error).__name__}'
    title = plain(row['properties'].get('Job')) or meta.get('title') or url
    company = plain(row['properties'].get('Company')) or meta.get('company') or '?'
    when = ('on or before ' if approx else '') + applied.isoformat()
    return f'Tracked: {title} — {company}, applied {when} ({channel}{f" via {via}" if via else ""}); {recorded}'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    rec = sub.add_parser('record', help="freeze the application record on a job's Applications row")
    rec.add_argument('url')
    rec.add_argument('--force', action='store_true', help='rewrite an existing record')
    ev = sub.add_parser('event', help='move an application to an outcome stage and log the event')
    ev.add_argument('url')
    ev.add_argument('stage', choices=EVENT_KINDS)
    ev.add_argument('--note', default='')
    ev.add_argument('--source', default='CLI', choices=('CLI', 'Watcher', 'Telegram', 'Backfill'))
    sy = sub.add_parser('sync', help='log hand-edited stages and apply the no-response rule')
    sy.add_argument('--dry-run', action='store_true')
    ad = sub.add_parser('add', help='track an application made outside Jobadabra')
    ad.add_argument('url')
    ad.add_argument('--applied', default='', help='"2026-09-23", "23 Sep", "on or before 23 Sep" (default today)')
    ad.add_argument('--channel', choices=CHANNELS)
    ad.add_argument('--via', help='recruiter platform or agency, e.g. TechTree')
    args = parser.parse_args(argv)
    # Every command works on the active store (sqlite, or Notion when that's where the data is): src/ledger_store.py.
    from .. import ledger_store
    from ..stores import open_stores
    stores = open_stores()
    if args.command == 'record':
        _, outcome = ledger_store.record(stores, args.url, force=args.force)
        print(f'{args.url}: {outcome}')
    elif args.command == 'event':
        print(ledger_store.set_stage(stores, args.url, args.stage, args.source, args.note))
    elif args.command == 'add':
        applied, approx = parse_applied(args.applied)
        print(ledger_store.add_application(stores, args.url, applied=applied, approx=approx, channel=args.channel,
                                           via=args.via))
    else:
        print(ledger_store.sync(stores, dry_run=args.dry_run))
    return 0


if __name__ == '__main__':
    sys.exit(main())
