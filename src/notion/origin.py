#!/usr/bin/env python3
"""Outbound or inbound: did you go after this opportunity, or did it find you? The Applications row's own Origin column
(select Inbound / Outbound) says it: a fact set once when the row is created (stamp(), by every path that creates a
row), which you can change by hand in Notion, or answer in the app's Log job activity ("Who reached out first?", when the
conversation began before the job's first contact: src/ai/inbox.py) (e.g. a job you had saved before a recruiter wrote about it). The same
reading here and in the desktop app (desktop/renderer/origin.js); both are checked against one table,
tests/fixtures/opportunity_origin.json, so they cannot drift.

Origin set: it wins. Origin empty (rows from before the column): derived from the row, the rule below, which is also
what the one-time backfill writes (python -m src.notion.origin --backfill [--apply]; the app runs it at start-up).

- Inbound: a recruiter's pitch (Stage "Recruiter lead", a "Recruiter lead" event, Notes "Recruiter message (…)":
  src/ai/opportunity.py, however it was logged: Gmail, Telegram, the app), or a job whose first contact was a
  LinkedIn message or a phone call (Source LinkedIn / Phone: src/ai/opportunity.py source_for).
- Outbound: everything else: found by a search, saved, applied from the app, "Applied elsewhere" (Notes
  "Logged from a paste (…)", even from a LinkedIn paste), a confirmation email (Source Gmail). Unknown or empty
  Source counts as outbound.
- The first contact decides: a recruiter writing about a job you had only saved is inbound; one reacting to your
  application (an "Applied" or "Confirmation received" event before the "Recruiter lead" one) keeps it outbound.

Usage:
  python -m src.notion.origin --backfill           # list the rows whose Origin is empty, and what they would get
  python -m src.notion.origin --backfill --apply   # write it (rows with an Origin are never touched)
"""
import argparse
import sys

from . import titles

INBOUND, OUTBOUND = 'inbound', 'outbound'
COLUMN = 'Origin'
LABELS = {INBOUND: 'Inbound', OUTBOUND: 'Outbound'}
LEAD = 'Recruiter lead'
INBOUND_SOURCES = ('LinkedIn', 'Phone')
APPLIED_KINDS = ('Applied', 'Confirmation received')
LEAD_NOTES = 'Recruiter message ('
ELSEWHERE_NOTES = 'Logged from a paste ('


def stored(value):
    """The Origin column's value as 'inbound' / 'outbound', '' when empty or not one of the two."""
    value = (value or '').strip().lower()
    return value if value in LABELS else ''


def origin(source='', stage='', notes='', kinds=(), origin=''):
    """'inbound' or 'outbound' for one Applications row: its Origin column (origin) when set, else derived from
    Source, Stage, Notes and the event kinds logged on it (oldest first, when known)."""
    if stored(origin):
        return stored(origin)
    notes, kinds = (notes or '').lstrip(), list(kinds or ())
    if _applied_first(kinds):
        return OUTBOUND
    if stage == LEAD or LEAD in kinds or notes.startswith(LEAD_NOTES):
        return INBOUND
    if notes.startswith(ELSEWHERE_NOTES):
        return OUTBOUND
    return INBOUND if (source or '').strip() in INBOUND_SOURCES else OUTBOUND


def _applied_first(kinds):
    """You applied before the recruiter's message: they are answering your application."""
    applied = [i for i, kind in enumerate(kinds) if kind in APPLIED_KINDS]
    return bool(applied) and LEAD in kinds and applied[0] < kinds.index(LEAD)


def is_inbound(**fields):
    return origin(**fields) == INBOUND


def _plain(prop):
    prop = prop or {}
    if 'select' in prop:
        return (prop.get('select') or {}).get('name') or ''
    return ''.join(t.get('plain_text') or (t.get('text') or {}).get('content', '')
                   for t in prop.get('rich_text') or prop.get('title') or [])


def row_fields(row):
    """The fields origin() reads, from an Applications row (a Notion page, or the properties of one being created)."""
    props = row.get('properties', row) or {}
    return {'source': _plain(props.get('Source')), 'stage': _plain(props.get('Stage')),
            'notes': _plain(props.get('Notes')), 'origin': _plain(props.get(COLUMN))}


def row_origin(row, kinds=()):
    """'inbound' or 'outbound' for an Applications row: its Origin column first, else derived."""
    return origin(**row_fields(row), kinds=kinds)


def stamp(properties, value=None):
    """A new Applications row's properties with its Origin: `value` ('inbound' / 'outbound') when the creating path
    knows it, else derived from the row as created. The one place every creating path decides it; an Origin already
    in the properties is kept. An Inbound row's Job title also names who it is for ("Principal SRE · via Huxley",
    src/notion/titles.py); an Outbound row keeps the bare role."""
    decided = stored(_plain(properties.get(COLUMN)))
    if not decided:
        decided = stored(value) or origin(**{**row_fields(properties), 'origin': ''})
        properties = {**properties, COLUMN: {'select': {'name': LABELS[decided]}}}
    if decided == INBOUND and 'Job' in properties:
        title = titles.job_title(_plain(properties['Job']), _plain(properties.get('Company')), _plain(properties.get('Via')))
        if title:
            properties = {**properties, 'Job': titles.title_property(title)}
    return properties


def backfill(tracker, apply=False):
    """Rows whose Origin is empty get the derived one (first contact decides: the events, oldest first). Rows with an
    Origin (set when created, or by you) are never touched, so a second run changes nothing.
    Returns {'lines', 'set': {'inbound': n, 'outbound': n}, 'kept': n}."""
    from .ledger import EVENTS_DATABASE_ID, plain
    rows = tracker.query_database(tracker.database_id)
    if rows and COLUMN not in (rows[0].get('properties') or {}):
        raise SystemExit(f'The Job Tracker has no {COLUMN} column yet: the app adds it (schema repair) first.')
    kinds = {}
    if EVENTS_DATABASE_ID:
        at = lambda event: ((event['properties'].get('At') or {}).get('date') or {}).get('start') or ''
        for event in sorted(tracker.query_database(EVENTS_DATABASE_ID), key=at):
            for link in (event['properties'].get('Application') or {}).get('relation', []):
                kinds.setdefault(link['id'].replace('-', ''), []).append(plain(event['properties'].get('Kind')))
    counts, kept, lines = {INBOUND: 0, OUTBOUND: 0}, 0, []
    for row in rows:
        if stored(row_fields(row)['origin']):
            kept += 1
            continue
        value = row_origin(row, kinds.get(row['id'].replace('-', ''), []))
        counts[value] += 1
        title = plain((row.get('properties') or {}).get('Job')) or row['id']
        lines.append(f'{LABELS[value]:8} {title}')
        if apply:
            tracker.update_page(row['id'], {COLUMN: {'select': {'name': LABELS[value]}}})
    verb = 'Set' if apply else 'Would set'
    lines.append(f"{verb} Origin on {sum(counts.values())} row(s): {counts[INBOUND]} Inbound, {counts[OUTBOUND]} Outbound;"
                 f" {kept} already had one.")
    return {'lines': lines, 'set': counts, 'kept': kept}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--backfill', action='store_true', help='fill Origin on rows where it is empty')
    parser.add_argument('--apply', action='store_true', help='write it (default: only list)')
    args = parser.parse_args(argv)
    if not args.backfill:
        parser.print_help()
        return 2
    from . import client as notion
    tracker = notion.Tracker.from_env()
    if not tracker:
        raise SystemExit('NOTION_TOKEN is required (Keychain entry jobadabra.notion.token, or export it)')
    print('\n'.join(backfill(tracker, apply=args.apply)['lines']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
