#!/usr/bin/env python3
"""📥 Log anything: a pasted message or a screenshot (LinkedIn, Gmail, WhatsApp…) -> the right job, updated or created.

Claude Haiku 5.5 reads the text or the image once, together with the list of jobs the store already knows (tracked
applications first, then open Job Matches), and says what it is and which job it's about:

- **a job already tracked** in Applications -> its event (reply, interview time, rejection, offer…) and Stage moved
  forward (never back, like the Gmail check); a recruiter writing about a saved job makes it a Recruiter lead.
- **an open job** in Job Matches, not tracked yet -> an Applications row for that job (its own URL), then the event.
- **nothing known** -> a new row: a recruiter's pitch becomes a Recruiter lead (src/ai/opportunity.py); an
  application, reply, interview or outcome for another role is tracked as applied elsewhere, then the event.

The message and the screenshot are kept on the job (base.LOGGED: on Notion the page's folded entry). The same paste twice
changes nothing (Source ID). Everything goes through the active store (src/stores): Notion, or this Mac's.

Usage:
  python -m src.ai.inbox --text-file message.txt [--image shot.png] [--talking]
"""
import argparse
import hashlib
import re
import sys
from . import providers
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .. import ledger_store
from ..notion import client as notion, cron_runs, ledger  # noqa: F401 (cron_runs: re-exported for tests)
from ..notion import origin as origin_rule, titles  # noqa: F401
from ..notion.ledger import REPLY
from ..stores import open_stores, rules
from . import added, cost, mail, opportunity
from .inbox_dates import (MONTHS, MONTH_DAY_DAYS, WEEKDAYS, _day, _in_year, _resolve_dates, _this_year, _years,  # noqa: F401
                          resolve_at, resolve_day)
from .inbox_events import THEIRS, _check_line, _last_message, _noted, _rich, last_message_id  # noqa: F401
from .inbox_fields import (CHANNELS, NO_CALL, UPDATE, _as_written, _asks_origin, agree_applies, agreed, agreement,  # noqa: F401
                           fields, unchecked)
from .inbox_notion import (DESCRIPTION_HEADING, FIRST_CONTACT, GAPS, MIN_ABOUT, _attach_screenshots, _channel_named,  # noqa: F401
                           _fill_gaps, _image_blocks, _keep, _new_row, _origin, _origin_of, _place_screenshots, _platform_named,
                           _row_for, _thumbnails)
from .inbox_reading import (AGREE_QUESTION, AGREEMENT, APPLIED, DEFAULT_MODEL, EARLY, EMOJI, GONE, KINDS, LAST_MESSAGE,  # noqa: F401
                            LOG_HEADING, MAX_IMAGES, MAX_JOBS, MEDIA, NOT_JOB, OUTREACH, SCHEMA, SEEN, SYSTEM, _job_choice,
                            _who, _words, candidates, images_of, listing, read, related, same_job, step)


def _client(client):
    if client is not None:
        return client
    from . import engine
    if not engine.ready():
        raise ValueError('Reading a message needs AI: choose an AI engine: Claude Code, Codex or an API key (Settings → Connections → AI).')
    return engine.client(action='inbox')


def _tracked_state(stores, job):
    """A tracked job as it is now (Origin, Source, Reached via, Stage: what a log may change, for the "This will
    change" box) and when its first contact was known to be ({} and None when it is not tracked)."""
    app = _row_for(stores, job['url']) if job and job.get('stage') else None
    if app is None:
        return {}, None
    return ({'Origin': origin_rule.LABELS[_origin_of(app)], 'Source': app.get('source') or '',
             'Reached via': app.get('reached_via') or '', 'Stage': app.get('stage') or ''}, _origin(stores, app))


def propose(stores, *, text='', image=None, client=None, model=DEFAULT_MODEL, stats=None, now=None, target='', item=None):
    """Step 1 of a log, nothing written to the store: Claude reads the message once and it's matched to a job. Returns
    the proposal the app shows for confirming and hands back to log(): {item, job, kind, new, label, stage, fields}
    (fields: see fields()). Raises ValueError for what can't be logged at all.
    item: an earlier proposal's reading, for the job you picked in the confirmation step (target): no second reading.
    When Claude found no job and several tracked ones are from the same recruiter or company (or one is, but not
    plainly the same role), fields['job'] asks "Which job is this?" with them as candidates."""
    now = now or datetime.now(timezone.utc)
    if item is None:
        text = (text or '').strip()
        if not image and len(text) < opportunity.MIN_TEXT:
            raise ValueError('Paste the whole message or a screenshot of it, not just a line.')
        client = _client(client)
        step('Reading your jobs')
        jobs = candidates(stores)
        shots = len(images_of(image))
        who = providers.who()
        step(f"{who} is reading {shots} screenshots" if shots > 1 else f'{who} is reading the screenshot' if shots
             else f'{who} is reading the message')
        item = read(client, model, text, image, jobs, stats)
    else:
        step('Reading your jobs')
        jobs = candidates(stores)
    kind = item['kind']
    if kind == NOT_JOB and target:  # you said which job it's about: log it as a reply there
        kind = REPLY
    if kind == NOT_JOB and not target:
        raise ValueError("That doesn't look like a message about a job, so nothing was logged.")
    match = item.get('match', -1)
    if target == 'new':
        match = -1
    elif target:
        match = next((i for i, j in enumerate(jobs) if j['url'] == target), -1)
        if match < 0:
            raise ValueError('That job is no longer in your jobs; pick it again, or choose "A new job".')
    unsure = []
    if not target and not 0 <= match < len(jobs):
        match = same_job(jobs, item)
        near = related(jobs, item)
        if len(near) >= 2 or (near and match < 0):
            unsure = near
    job = jobs[match] if 0 <= match < len(jobs) else None
    new = not (job and job.get('stage'))
    stage = (job or {}).get('stage') or ''
    if not new and stage not in EARLY and (kind == OUTREACH or (kind == APPLIED and stage != opportunity.LEAD_STAGE)):
        kind = UPDATE  # a first contact (or an application) for a job you're already past: nothing of that kind is new
    _resolve_dates(item, now)
    shown = job or dict(item, title=item.get('role') or item.get('title'))
    current, first_known = _tracked_state(stores, job) if not new else ({}, None)
    found = fields(item, kind, new=new, now=now, stage=stage, first_known=first_known, current=current)
    if unsure:  # asked first; the other details follow the job you pick (proposed again for it)
        found = {'job': {'value': '', 'state': 'ask', 'question': 'Which job is this?',
                         'candidates': [_job_choice(jobs[i]) for i in unsure]}, **found}
    return {'item': item, 'job': job, 'kind': kind, 'new': new, 'stage': stage, 'target': target, 'current': current,
            'first_known': first_known.isoformat() if first_known else '',
            'label': ' — '.join(p for p in (shown.get('company') or shown.get('recruiter_company'), opportunity.title(shown)) if p),
            'fields': found}


def confirm(proposal, *, kind='', channel='', other='', started='', interview_at='', company=None, agency=None,
            first_contact=None, last_at='', agreed=None, origin=None):
    """The proposal with what you confirmed in the app in place of Claude's readings: kind, channel (LinkedIn, Email,
    Phone, Other; other = what "Other" was, e.g. WhatsApp), started (YYYY-MM-DD, when the conversation began),
    interview_at (YYYY-MM-DDTHH:MM), company / agency (a new job's), for a new job whether this was the first
    contact about it (then its Source follows the channel), and last_at (YYYY-MM-DD[THH:MM]): the day of the last
    message when it couldn't be read (its time, when read, is kept for the same day), and agreed: your answer to
    "Did you agree to talk to the recruiter?" (True moves a new job or a Recruiter lead to Screening)."""
    if ((proposal.get('fields') or {}).get('job') or {}).get('state') == 'ask':
        raise ValueError('Say which job this is first.')  # the app proposes again for the job you pick
    item = dict(proposal['item'])
    if last_at:
        day = _day(last_at)
        if not day:
            raise ValueError(f'Not a date: "{last_at}" (YYYY-MM-DD).')
        last = dict(item.get('last_message') or {})
        if (last.get('resolved') or '')[:10] != day.isoformat():
            moment = mail._when(last_at) if len(last_at) > 10 else None
            last['resolved'] = moment.isoformat() if moment else day.isoformat()
        item['last_message'] = last
    if kind:
        if kind not in KINDS + [UPDATE] or kind == NOT_JOB:
            raise ValueError(f'Unknown kind "{kind}".')
    if channel:
        if channel not in CHANNELS:
            raise ValueError(f'Unknown channel "{channel}" (LinkedIn, Email, Phone or Other).')
        item['platform'] = channel
        item['channel_other'] = (other or '').strip()[:40] if channel == 'Other' else ''
    if started:
        day = _day(started)
        if not day:
            raise ValueError(f'Not a date: "{started}" (YYYY-MM-DD).')
        item['first_contact'] = f'{day.isoformat()}T12:00:00+00:00'
        if (item.get('seen') or {}).get('year') == 'missing' and mail._when(item.get('when') or ''):
            item['when'] = _in_year(item['when'], day)  # the message's own date: the year you gave
    if interview_at:
        if not mail._when(interview_at):
            raise ValueError(f'Not a date and time: "{interview_at}".')
        item['interview_at'] = interview_at
    elif (item.get('seen') or {}).get('interview') in ('partial',) or (item.get('seen') or {}).get('year') == 'missing':
        item['interview_at'] = ''  # never a guessed time
    if company is not None:
        item['company'] = company.strip()[:200]
    if agency is not None:
        item['recruiter_company'] = agency.strip()[:200]
        item['in_house'] = item.get('in_house') and not agency.strip()
    if first_contact is not None:
        item['first_contact_here'] = bool(first_contact)
    if agreed is not None:
        item['agreed'] = bool(agreed)
    if origin:
        if not origin_rule.stored(origin):
            raise ValueError(f'Unknown origin "{origin}" (inbound or outbound).')
        item['origin_answer'] = origin_rule.stored(origin)  # who reached out first: they did = inbound
    return {**proposal, 'item': item, 'kind': kind or proposal['kind'], 'confirmed': True}


def log(stores, *, text='', image=None, client=None, model=DEFAULT_MODEL, talking=False, source='Manual',
        event_source='CLI', stats=None, now=None, target='', on_new=None, proposal=None, found=None):
    """Read one pasted message or screenshot, update or create the job it's about. Returns one line for the reply.
    target: '' = Claude decides which job; 'new' = a new job; a job URL = that job (the app's "Which job?").
    proposal: propose()'s result (confirmed with confirm()): no second reading; without it Claude's guesses stand
    (Telegram, the terminal).
    on_new(url, job, record): called for a job tracked here for the first time (src/ai/added.hook: facts, fit score,
    Job Matches row, like a found job); returns a short line for the reply, or None.
    found: a dict that gets the job's record ('row') and whether it was created here, for the run's link to it."""
    text = (text or '').strip()
    now = now or datetime.now(timezone.utc)
    if proposal is None:
        proposal = propose(stores, text=text, image=image, client=client, model=model, stats=stats, now=now, target=target)
    item, job, kind = dict(proposal['item']), proposal['job'], proposal['kind']
    if kind in NO_CALL:
        item['interview_at'] = ''
    check = [] if proposal.get('confirmed') else unchecked(item, kind)
    if not proposal.get('confirmed') and ((proposal.get('fields') or {}).get('job') or {}).get('state') == 'ask':
        check.append(f"which job it is ({len(proposal['fields']['job']['candidates'])} possible)")
    if not proposal.get('confirmed'):  # nobody confirmed the dates: a year-less one is this year's (and flagged)
        for key in ('when', 'first_contact'):
            if mail._when(item.get(key) or ''):
                item[key] = _this_year(item[key], now)
    step(f"{providers.who()} found: {kind}{' · ' + (item.get('role') or item.get('title')) if (item.get('role') or item.get('title')) else ''}"
         " — updating the job")
    # Screening when you said yes: the explicit --talking (Telegram, the terminal), your answer in the app, or the
    # conversation showing it; an unanswered 'unclear' moves nothing (Telegram says to check it).
    talking = talking or agreed(item)
    item['owner_agreed'] = talking  # opportunity.track reads it too: never a yes you didn't give
    if not (talking or proposal.get('confirmed')) and agreement(item) == 'unclear' \
            and agree_applies(proposal.get('new', True), proposal.get('stage') or ''):
        check.append('whether you agreed to talk to the recruiter (not moved to Screening)')
    seed = hashlib.sha256(re.sub(r'\s+', ' ', text).lower().encode() + b''.join(s[1] for s in images_of(image))).hexdigest()[:16]
    source_id = f'paste:{seed}'
    when = item['when'] if mail._when(item.get('when') or '') else now.isoformat(timespec='seconds')
    if item.get('interview_at') and not ledger.plausible_interview(item['interview_at'], when):
        check.append(f"call date {item['interview_at'][:10]} impossible for this message: not saved")
        item['interview_at'] = ''
    first_here = item.get('first_contact_here')
    # A new job's first contact: its first event is dated when the conversation began, so a later contact logged
    # from another channel can't take its Source (the earliest-contact rule reads the events' dates).
    began = item['first_contact'] if first_here and mail._when(item.get('first_contact') or '') else None
    summary = item.get('summary') or kind
    app = _row_for(stores, job['url']) if job and job.get('stage') else None
    if kind == UPDATE and app is None:  # "Update on this job" is for a tracked one; anything else is their reply
        kind = REPLY

    if app is None and kind == OUTREACH:  # a recruiter's pitch: an open job it names, or a new lead
        lead = dict(item, job_url=job['url'], company=job.get('company') or item.get('company'),
                    title=job.get('title') or item.get('title')) if job else item
        linked = _place_screenshots(stores, image, summary)
        extra = '\n\n'.join(([f"⚠️ Check these details: {'; '.join(check)}."] if check else []) + ([linked] if linked else []))
        app, line = opportunity.track(stores, lead, text, source=source, event_source=event_source, talking=talking,
                                      at=began or when, seed=seed, extra_markdown=extra, note=_noted(f'Logged: {summary}', item))
        if not app:
            return 'ℹ️ ' + line
        if images_of(image) and not linked:  # this Mac's store, or Notion with no run open: the job's own files
            _attach_screenshots(stores, app['id'], image)
        if found is not None:
            found.update(row=app, created=True)
        fit = _rich(on_new, app, lead, text)
        noted = _last_message(stores, app, item, event_source, kind)
        return '🤝 ' + line + (f' · {fit}' if fit else '') + (f' {noted}' if noted else '') + _check_line(check)

    created = False
    if app is None and job:  # an open job, not tracked yet
        day = _day(when) if kind == APPLIED else None
        # You said this was the first contact (a LinkedIn message, a call): its channel decides (src/notion/origin.py).
        first = origin_rule.origin(source=opportunity.source_for(item, source)) if first_here else None
        ledger_store.add_application(stores, job['url'], applied=day or now.date(), approx=kind != APPLIED, source=source,
                                     meta={'title': job.get('title'), 'company': job.get('company'), 'location': job.get('location')},
                                     origin=first)
        app, created = _row_for(stores, job['url']), True
        if app is not None and first_here:  # you said this was the first contact: it's where the job came from
            where = {'source': opportunity.source_for(item, source)}
            if item.get('platform') in opportunity.REACHED_VIA:
                where['reached_via'] = item['platform']
            app = stores.applications.update(app['id'], where)
    if app is None:  # a role nothing knows yet
        if not (item.get('company') or item.get('recruiter_company')) or not (item.get('role') or item.get('title')):
            raise ValueError(f"It reads as \"{kind}\", but I can't tell which company and role, so nothing was logged. "
                             'Add a line saying which job it is.')
        item = dict(item, title=item.get('role') or item.get('title'))
        url = opportunity.lead_url(item, text, seed=seed)
        app = _row_for(stores, url) or _new_row(stores, item, url, source, event_source, when, f'logged: {summary}')
        created = True

    if found is not None:
        found.update(row=app, created=created)
    stage, url = app.get('stage') or '', app.get('url') or ''
    changes = []  # what this log replaced on a tracked job: said in the reply and on the job's entry
    filled = _fill_gaps(stores, app, item, changes) if not created else []
    about = (item.get('job_description') or '').strip()
    if len(about) >= MIN_ABOUT:
        # What the message says about the role, kept as the job's description (the prep kit and fit score read it).
        step('Saving the job description on the job')
        try:
            stores.applications.set_section(app['id'], DESCRIPTION_HEADING, about)
            filled.append('the job description')
        except Exception as error:  # noqa: BLE001 — the update itself matters more
            print(f'Warning: job description not saved: {type(error).__name__}: {error}', file=sys.stderr)
        if not created and not app.get('fit'):
            step('Scoring how well the job fits you')
            fit = _rich(on_new, app, {**item, 'summary': about}, about)
            if fit:
                filled.append(f'fit {fit}')
    label = mail._label(app)
    changed = None
    if kind == OUTREACH and stage not in EARLY:  # the same pitch again (a follow-up would read as a reply)
        if not (talking and stage == opportunity.LEAD_STAGE):
            noted = _last_message(stores, app, item, event_source, kind)
            return f'ℹ️ Already tracked: {label} ({stage}). ' + (f'Nothing new about the job. {noted}' if noted else 'Nothing new to log.')
    elif kind == UPDATE:  # a job already tracked: only its gaps, its description and who wrote last
        pass
    elif kind == OUTREACH:
        app = stores.applications.update(app['id'], {'stage': opportunity.LEAD_STAGE})
        rules.add_event(stores, app, opportunity.LEAD_STAGE, event_source, at=when, note=_noted(f'Logged: {summary}', item))
        changed = opportunity.LEAD_STAGE
    elif kind == APPLIED:
        if stage in EARLY or stage == opportunity.LEAD_STAGE:
            ledger_store.set_stage(stores, url, APPLIED, event_source)
            changed = APPLIED
        elif created:
            changed = APPLIED
    else:
        changed = mail.record(stores, app, kind, when, event_source, source_id, _noted(f'Logged: {summary}', item),
                              mail._events_index(stores), item.get('interview_at') or None, now,
                              feedback_text=(item.get('feedback') or '') if image else mail.verified_feedback(item.get('feedback'), text))
    if talking and (stage == opportunity.LEAD_STAGE or changed == opportunity.LEAD_STAGE):
        ledger_store.set_stage(stores, url, 'Screening', event_source, note='You said yes to the recruiter')
        changed = 'Screening'
    noted = _last_message(stores, app, item, event_source, kind)
    if changed and not created and stage:  # the stage the job really has now (a kind that moved nothing changes nothing)
        after = (_row_for(stores, url) or app).get('stage')
        if after and after != stage:
            changes.append(f'Stage {stage} → {after}')
    said = f" Changed: {'; '.join(changes)}." if changes else ''
    if not changed and filled:
        _keep(stores, app, text, image, summary, when, _channel_named(item), check, changes)
        return f"🧩 Updated: {label}: added {', '.join(filled)}.{said}{' ' + noted if noted else ''}{_check_line(check)}"
    if not changed and noted:
        _keep(stores, app, text, image, summary, when, _channel_named(item), check, changes)
        return f'ℹ️ Already tracked: {label} ({stage}). Nothing new about the job. {noted}{said}{_check_line(check)}'
    if not changed:
        return f'ℹ️ Already tracked: {label} ({stage}). Nothing new to log.' if kind == UPDATE else f'ℹ️ Already logged: {label} ({stage})'
    _keep(stores, app, text, image, summary, when, _channel_named(item), check, changes)
    fit = _rich(on_new, app, item, text) if created and not job else None  # an open job was scored by its search
    verb = 'Tracked' if created else 'Updated'
    return (f"{EMOJI.get(kind, '•')} {verb}: {label} → {changed}. {summary}" + (f' · {fit}' if fit else '')
            + (f" Added {', '.join(filled)}." if filled else '') + said + (f' {noted}' if noted else '') + _check_line(check))


def load_image(path):
    """(name, bytes, media type) of a screenshot file, or None for anything that isn't an image. With the small copy the
    app writes beside it (desktop/lib/shots.js: "<file>.small.jpg"): a fourth item, that copy in the same shape, which
    is what goes to Notion; Claude reads the original."""
    media = MEDIA.get(Path(path).suffix.lower())
    if not media:
        return None
    shot = (Path(path).name, Path(path).read_bytes(), media)
    small = Path(f'{path}.small.jpg')
    return shot + ((small.name, small.read_bytes(), 'image/jpeg'),) if small.is_file() else shot


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--text-file', help='the message (default: stdin, unless --image is given)')
    parser.add_argument('--image', help='a screenshot (.png, .jpg, .webp, .gif)')
    parser.add_argument('--talking', action='store_true', help="you've already said yes to the recruiter")
    args = parser.parse_args(argv)
    try:
        stores = open_stores()   # the active store (JOBADABRA_STORE): this Mac's, or Notion, which makes its own client
    except LookupError:          # Notion chosen and not connected (no NOTION_TOKEN)
        raise SystemExit('Connect Notion first: logged messages are kept on your jobs there.') from None
    text = open(args.text_file, encoding='utf-8').read() if args.text_file else ('' if args.image else sys.stdin.read())
    image = load_image(args.image) if args.image else None
    if args.image and not image:
        raise SystemExit(f'Not a screenshot: {args.image} (use .png, .jpg, .webp or .gif)')
    try:
        print(log(stores, text=text, image=image, talking=args.talking))
    except ValueError as error:
        print(f'⚠️ {error}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
