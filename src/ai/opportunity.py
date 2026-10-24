#!/usr/bin/env python3
"""Recruiter leads: a role someone pitched to you (an email, a LinkedIn message), tracked like an application.

A recruiter's message has no job posting to crawl, so Claude Haiku 5.5 reads the message itself: role, employer
(or the hidden client, e.g. "logistics software, Series A"), salary, work mode, contract, the recruiter and their
agency. That becomes an Applications row at Stage "Recruiter lead" (or "Screening" when you're already talking)
with Channel Agency/Direct, Via = the agency, Contact = the recruiter, and the original message in the page body,
plus a "Recruiter lead" event. From then on the Gmail check matches the recruiter's follow-ups (by name, email and
agency) like any other application.

Three ways in:
- Gmail: the scheduled mail check (src/ai/mail.py) classifies a recruiter's pitch as "Recruiter outreach".
- Telegram: /add followed by the message text (no job link), or forward the message to the bot.
- The Desktop App: Jobs → "Recruiter message…", or this command.

Usage:
  python -m src.ai.opportunity add --text-file message.txt [--talking] [--source-label LinkedIn]
  pbpaste | python -m src.ai.opportunity add [--talking]
"""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

from ..notion import origin as origin_rule
from ..notion import titles
from ..notion.ledger import _block
from ..stores import open_stores, rules
from ..stores.notion_blocks import to_markdown
from . import cost, engine
from .models import SMALL_MODEL

DEFAULT_MODEL = os.getenv('JOB_PILOTTO_MAIL_MODEL') or SMALL_MODEL
LEAD_STAGE = 'Recruiter lead'
HEADING = '🤝 Recruiter message'
MIN_TEXT = 40  # shorter than this isn't a recruiter's message (e.g. a date after /add)
WORK_MODES = ('On-site', 'Hybrid', 'Remote')
REACHED_VIA = ('Email', 'LinkedIn', 'Phone', 'Other')
# Applications "Source" = where the contact started: the channel when it's one we know (a LinkedIn chat, an email),
# else how the row was added (Telegram, Manual, the app). A later channel never replaces it; something logged from
# another channel that is dated before the row's first contact does (src/ai/inbox.py _fill_gaps).
CHANNEL_SOURCE = {'LinkedIn': 'LinkedIn', 'Email': 'Gmail', 'Phone': 'Phone'}  # Phone: only when you confirm it (the app)
SOURCE_CHANNEL = {source: channel for channel, source in CHANNEL_SOURCE.items()}
NOTES_ORIGIN = re.compile(r'^(?:Recruiter message|Logged from a paste) \((Email|LinkedIn|Phone|Other)\)')

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['is_opportunity', 'title', 'company', 'client', 'location', 'work_mode', 'salary', 'contract',
                 'recruiter_name', 'recruiter_email', 'recruiter_company', 'in_house', 'platform', 'job_url', 'summary',
                 'owner_agreed'],
    'properties': {
        'is_opportunity': {'type': 'boolean', 'description': 'A person pitches the owner a specific role (not a job alert or newsletter)'},
        'title': {'type': 'string', 'description': 'Role title, e.g. "Senior DevOps Engineer"'},
        'company': {'type': 'string', 'description': 'Hiring company when named, else ""'},
        'client': {'type': 'string', 'description': 'When the employer is hidden: a short description ("logistics software, Series A"), else ""'},
        'location': {'type': 'string', 'description': 'Where, e.g. "Remote (Europe)", "Prague"; "" if not stated'},
        'work_mode': {'type': 'string', 'enum': ['On-site', 'Hybrid', 'Remote', '']},
        'salary': {'type': 'string', 'description': 'As stated, e.g. "€70k–90k (maybe €100k) + equity"; "" if not stated'},
        'contract': {'type': 'string', 'description': 'e.g. "B2B contract", "permanent"; "" if not stated'},
        'recruiter_name': {'type': 'string'},
        'recruiter_email': {'type': 'string', 'description': "The recruiter's email if written, else \"\""},
        'recruiter_company': {'type': 'string', 'description': 'Agency or platform the recruiter works for, else ""'},
        'in_house': {'type': 'boolean', 'description': "True when the recruiter works for the hiring company itself"},
        'platform': {'type': 'string', 'enum': ['Email', 'LinkedIn', 'Other']},
        'job_url': {'type': 'string', 'description': 'Link to the job posting itself if the message has one (not a booking or profile link), else ""'},
        'summary': {'type': 'string', 'description': 'Up to 3 short facts worth knowing (team, stack, travel), max 200 characters'},
        'owner_agreed': {'type': 'boolean', 'description': 'The text includes the owner replying that they are interested or agreeing to talk'},
    },
}

SYSTEM = """You read a message a recruiter or hiring person sent the owner of Jobadabra (an email, or a LinkedIn \
message pasted as text) and extract the role they pitch. Only state what the message says; never guess. The owner's \
own replies may be included: ignore them for the facts, but set owner_agreed when the owner said yes or \
agreed to a call. If the message isn't a pitch for a role (a job alert, \
a newsletter, a rejection), set is_opportunity false and leave the rest empty."""


def extract(client, model, text, sender='', stats=None):
    """Claude's reading of a recruiter's message: a dict with SCHEMA's fields."""
    content = (f'From: {sender}\n\n' if sender else '') + text[:8000]
    response = client.messages.create(
        model=model, max_tokens=1000, system=SYSTEM, messages=[{'role': 'user', 'content': content}],
        output_config=engine.structured(SCHEMA, model, 'low'),
    )
    cost.add(stats, model, response.usage)
    return json.loads(next(b.text for b in response.content if b.type == 'text'))


def lead_url(lead, text, gmail_id='', seed=None):
    """The row's Job URL (the Applications key): the posting if the message links one, else the Gmail message,
    else a stable link derived from the message text (the same message pasted twice stays one row)."""
    if lead.get('job_url', '').startswith(('http://', 'https://')):
        return lead['job_url']
    if gmail_id:
        return f'https://mail.google.com/mail/u/0/#all/{gmail_id}'
    digest = seed or hashlib.sha256(re.sub(r'\s+', ' ', text).strip().lower().encode()).hexdigest()[:16]
    if lead.get('platform') == 'LinkedIn':
        return f'https://www.linkedin.com/messaging/#jp-{digest}'
    return f'https://www.jobpilotto.top/lead#{digest}'


def contact(lead):
    return ' · '.join(p for p in (lead.get('recruiter_name'), lead.get('recruiter_email')) if p)


def title(lead):
    return (lead.get('title') or 'Role').strip()[:200]


def label(lead):
    """"Senior DevOps Engineer — logistics software (client) via Example Talent"."""
    who = lead.get('company') or (f"{lead['client']} (client)" if lead.get('client') else '')
    via = lead.get('recruiter_company') if not lead.get('in_house') else ''
    return ' — '.join(p for p in (title(lead), who) if p) + (f' via {via}' if via and via != who else '')


def source_for(lead, source):
    """The row's Source: LinkedIn for a LinkedIn message (however it reached Jobadabra), else the given one.
    Confirmed in the app (first_contact_here): yes = the channel you named (LinkedIn, Gmail for an email, Phone);
    no = the job started elsewhere, so how it was added (Manual, Telegram)."""
    here = lead.get('first_contact_here')
    if here is False:
        return source
    if here and lead.get('platform') in CHANNEL_SOURCE:
        return CHANNEL_SOURCE[lead['platform']]
    return 'LinkedIn' if lead.get('platform') == 'LinkedIn' else source


def first_contact_fields(record, platform, began, origin):
    """first_contact_changes for a job record: {field: value} for source, reached_via and notes; {} when nothing changes."""
    if platform not in CHANNEL_SOURCE or not began or not origin or began >= origin:
        return {}
    changes = {}
    if SOURCE_CHANNEL.get(record.get('source') or '') != platform:
        changes['source'] = CHANNEL_SOURCE[platform]
    if (record.get('reached_via') or '') != platform:
        changes['reached_via'] = platform
    notes = record.get('notes') or ''
    found = NOTES_ORIGIN.match(notes)
    if found and found.group(1) != platform:
        changes['notes'] = notes[:found.start(1)] + platform + notes[found.end(1):]
    return changes


def fields(lead, url, stage, source, origin='Recruiter message'):
    """A lead's job record fields (src/stores APPLICATION_FIELDS): the values properties() writes as Notion columns."""
    notes = [f"{origin} ({lead.get('platform') or 'Other'})"]
    notes += [value for value in (f"On {lead['channel_other']}" if lead.get('channel_other') else '',
                                  f"Client: {lead['client']}" if lead.get('client') else '', lead.get('contract'), lead.get('summary')) if value]
    values = {'title': title(lead), 'url': url, 'stage': stage,
              # Hidden employer: Company stays empty (the Gmail check matches on names, and "hidden" matches too much).
              'company': lead.get('company') or '', 'location': lead.get('location') or '', 'salary': lead.get('salary') or '',
              'channel': 'Direct' if lead.get('in_house') else 'Agency',
              'via': '' if lead.get('in_house') else lead.get('recruiter_company', ''), 'contact': contact(lead),
              'recruiter': not lead.get('in_house'), 'notes': '. '.join(notes), 'source': source_for(lead, source),
              # Where the recruiter reached you: where to answer (Focus says "Reply by email / on LinkedIn").
              'reached_via': lead.get('platform') if lead.get('platform') in REACHED_VIA else 'Other'}
    if lead.get('work_mode') in WORK_MODES:
        values['work_mode'] = lead['work_mode']
    return values


def same_pitch(stores, lead):
    """An open lead for the same role from the same recruiter (email) or agency: the pitch pasted after the Gmail check
    found it, or the other way round. None when there's none (or it can't be checked). Every job is read and the stages
    filtered here: Notion refuses a filter on a Stage choice the workspace lacks."""
    words = lambda value: ' '.join(re.findall(r'[a-z0-9]+', (value or '').lower()))
    role, email, agency = words(title(lead)), (lead.get('recruiter_email') or '').lower(), words(lead.get('recruiter_company'))
    try:
        rows = [row for row in stores.applications.list() if row['stage'] in (LEAD_STAGE, 'Screening')]
    except Exception:  # noqa: BLE001
        return None
    for row in rows:
        if words(titles.role_of(row['title'] or '', row['company'] or '', row['via'] or '')) != role:  # the role, not " · via Huxley"
            continue
        if (email and email in (row['contact'] or '').lower()) or (agency and words(row['via']) == agency):
            return row
    return None


# What an email carries besides the message: meeting dial-ins, legal footers, tracking links, social icons.
BOILERPLATE = re.compile(
    r'microsoft teams meeting|^join:|meeting id|passcode|dial in|phone conference|find a local number|need help\?|'
    r'system reference|for organi[sz]ers|reset dial-in|this e-?mail (is|was) (sent|intended)|strictly confidential|'
    r'confidential and intended|registered (no|office)|trading address|professional licen[cs]e|unsubscribe|'
    r'learn why we included|©\s*20\d\d|linkedin corporation|you are receiving|^help:|^_{5,}|^-{5,}|please notify|'
    r'permanently delete|if you (are not|have received)|,,\d+#|<tel:', re.I)
LINK_ONLY = re.compile(r'^\s*[\[<(]?\s*https?://\S+\s*[\]>)]?\s*$')


def clean_message(text):
    """The message itself: without dial-ins, legal footers, tracking links and image placeholders."""
    lines = []
    for line in (text or '').replace('<br>', '\n').splitlines():
        line = re.sub(r'\\?<https?://[^>]+\\?>', '', line)  # "Book a Call<https://…tracking…>" -> "Book a Call"
        line = re.sub(r'\\?\[https?://[^\]]+\\?\]', '', line).rstrip()  # [https://…/logo.png]
        if BOILERPLATE.search(line) or LINK_ONLY.match(line):
            continue
        lines.append(line)
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(lines)).strip()


def message_blocks(text):
    """The job page's message section: the clean message, and the full original folded away."""
    clean = clean_message(text)
    shown = [_block('paragraph', part) for part in re.split(r'\n\s*\n', clean)[:60] if part.strip()]
    original = [_block('paragraph', part) for part in re.split(r'\n\s*\n', (text or '').strip())[:90] if part.strip()]
    if original and clean != (text or '').strip():
        shown.append({'object': 'block', 'type': 'toggle', 'toggle': {
            'rich_text': [{'type': 'text', 'text': {'content': '📧 Full message'}}], 'children': original}})
    return shown


def message_markdown(text):
    """The message section as Markdown (message_blocks through the store's codec: a Notion page shows what it did)."""
    return to_markdown(message_blocks(text))


def track(stores, lead, text, *, source, event_source, talking=False, at=None, gmail_id='', note='', seed=None, url=None,
          extra_markdown=''):
    """The job's record, its message section and the events. Returns (record, one-line summary); record is None when the
    message is already tracked. extra_markdown: what goes under the message (what to check, the screenshots' link)."""
    if gmail_id and lead.get('platform') not in ('LinkedIn',):
        lead = {**lead, 'platform': 'Email'}  # found in Gmail: an email (LinkedIn's notification emails stay LinkedIn)
    url = url or lead_url(lead, text, gmail_id, seed)
    if stores.applications.get(url) or same_pitch(stores, lead):
        return None, f'Already tracked: {label(lead)}'
    talking = talking or bool(lead.get('owner_agreed'))
    stage = 'Screening' if talking else LEAD_STAGE
    # A recruiter's pitch: it found you (Inbound, src/notion/origin.py); an Inbound job's title names who it is for
    # ("Principal SRE · via Huxley", src/notion/titles.py), as the Notion store writes it.
    record = stores.applications.create({**fields(lead, url, stage, source), 'origin': origin_rule.LABELS[origin_rule.INBOUND]},
                                        stage)
    body = '\n\n'.join(part for part in (message_markdown(text), extra_markdown) if part)
    try:
        if body:
            stores.applications.set_section(record['id'], HEADING, body)
    except Exception as error:  # noqa: BLE001 — the job is what matters; the message is a convenience
        print(f'Warning: message not copied to the job: {type(error).__name__}: {error}', file=sys.stderr)
    at = at or datetime.now(timezone.utc).isoformat(timespec='seconds')
    event, existing = rules.add_event(stores, record, LEAD_STAGE, event_source, at=at,
                                      note=note or f'Recruiter message: {label(lead)}'[:300])
    if gmail_id and not existing:
        stores.events.update(event['id'], {'source_id': gmail_id})
    if talking:
        rules.add_event(stores, record, 'Screening', event_source, note='Already talking to the recruiter when tracked')
    facts = ' · '.join(p for p in (lead.get('salary'), lead.get('location') or lead.get('work_mode')) if p)
    return record, f"Tracked recruiter lead: {label(lead)}{f' · {facts}' if facts else ''} ({stage})"


def add_from_text(stores, text, *, client=None, model=DEFAULT_MODEL, source='Manual', event_source='CLI',
                  talking=False, stats=None):
    """A pasted or forwarded message -> a tracked lead. Returns one line for the reply."""
    text = (text or '').strip()
    if len(text) < MIN_TEXT:
        raise ValueError('Paste the whole recruiter message (the role, company, salary…), not just a line.')
    if client is None:
        from . import engine
        if not engine.ready():
            raise ValueError('Reading a recruiter message needs AI: choose an AI engine: Claude Code, Codex or an API key (Settings → Connections → AI).')
        client = engine.client(action='opportunity')
    lead = extract(client, model, text, stats=stats)
    if not lead.get('is_opportunity'):
        raise ValueError("That doesn't read like a recruiter pitching a role, so nothing was added.")
    return track(stores, lead, text, source=source, event_source=event_source, talking=talking)[1]


def backfill_reached(stores):
    """Leads tracked before "Reached via" existed: filled from their Notes ("Recruiter message (Email)"), or Email when the
    lead is a Gmail message. Returns how many jobs were filled."""
    filled = 0
    for row in stores.applications.list():
        if row['reached_via']:
            continue
        found = re.search(r'\((Email|LinkedIn|Phone|Other)\)', row['notes'] or '')
        url = row['url'] or ''
        value = found.group(1) if found else 'Email' if 'mail.google.com' in url else 'LinkedIn' if 'linkedin.com/messaging' in url else ''
        if value:
            stores.applications.update(row['id'], {'reached_via': value})
            filled += 1
    return filled


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    add = sub.add_parser('add', help="track a recruiter's message (from a file, or stdin)")
    add.add_argument('--text-file', help='the message; default: stdin')
    add.add_argument('--talking', action='store_true', help="you've already replied yes: Stage Screening")
    sub.add_parser('backfill', help='fill "Reached via" on leads tracked before the column existed')
    args = parser.parse_args(argv)
    stores = open_stores()  # the active store: this Mac's (sqlite) or Notion; JOB_PILOTTO_STORE picks it
    if args.command == 'backfill':
        print(f'Reached via filled on {backfill_reached(stores)} lead(s)')
        return 0
    text = open(args.text_file, encoding='utf-8').read() if args.text_file else sys.stdin.read()
    try:
        print('🤝 ' + add_from_text(stores, text, talking=args.talking))
    except ValueError as error:
        print(f'⚠️ {error}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
