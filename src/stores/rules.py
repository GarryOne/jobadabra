"""The application stage rules, above the store interface: one copy for every store (sqlite, notion, later ones).

What `Tracker.mark`, `revert_applying` and `revert_unsubmitted` (src/notion/client.py) decided for Notion alone:
a button's soft stage (Saved, Dismissed, Kit ready) never overwrites a real one; Applying goes back to Kit ready
when a session ends unsent; a bare Applied the owner says was wrong goes back to Applying, while a stage the
employer's side produced is never undone. Callers pass `stores` (src/stores open_stores()). Guarded by
tests/test_store_rules.py on the memory store.
"""
import os

from . import base

SOFT_STAGES = {'Saved', 'Dismissed', 'Kit ready'}
# Stages with the employer's own evidence behind them (a confirmation email, an interview, an answer).
EMPLOYER_STAGES = ('Confirmation received', 'Screening', 'Interview scheduling', 'Interview scheduled',
                   'Interviewing', 'Offer', 'Rejected', 'Withdrawn', 'No response')
UPDATED = 'updated'
PAST = 'past'


# The applicant tracking system, from the posting's URL (as Tracker._create_row has always stamped it).
ATS_HOSTS = (('greenhouse', 'Greenhouse'), ('ashbyhq', 'Ashby'), ('lever.co', 'Lever'), ('workable', 'Workable'))


def new_job(job):
    """A job's fields for a new row: where it came from (the app sets JOBADABRA_SOURCE; the bot and CI keep
    Telegram), Outbound, as every row a person goes after by themselves (src/notion/origin.py), the ATS from the
    URL, and a note when the posting date is only the day it was first seen. A scored search job carries the
    whole fit report; the application's fit field holds only its numeric score, on every store."""
    if isinstance(job.get('fit'), dict):
        job = {**job, 'fit': job['fit'].get('score')}
    url = job.get('url') or ''
    ats = next((name for key, name in ATS_HOSTS if key in url), '')
    posted = (job.get('posted_at') or job.get('first_seen_at') or '')[:10]   # a crawled job's dates (Tracker._create_row's Posted)
    return {'source': os.getenv('JOBADABRA_SOURCE') or 'Telegram', 'origin': 'Outbound',
            **({'ats': ats} if ats else {}), **({'posted': posted} if posted else {}),
            **({} if job.get('posted_at') else {'notes': 'Posted date is when Jobadabra first saw the job.'}),
            **{k: v for k, v in job.items() if k in base.APPLICATION_FIELDS and v not in (None, '')}}


def mark(stores, job, stage, today=None):
    """A button's stage (Telegram, the app): (record, created | updated | unchanged).

    Saved/Dismissed never replace a real stage (Applied, Interviewing, ...); Applied replaces Saved/Dismissed.
    Kit ready only lands on a new row or one with no stage: drafting a kit never overrides a ⭐ or a later stage."""
    today = today.isoformat() if hasattr(today, 'isoformat') else today
    current = stores.applications.get(job['url'])
    if current:
        stage_now = current['stage'] or None
        if stage_now == stage or (stage in SOFT_STAGES and stage_now not in SOFT_STAGES and stage_now is not None) \
                or (stage == 'Kit ready' and stage_now is not None):
            return current, base.UNCHANGED
        row, _ = stores.applications.set_stage(job, stage, today)
        return row, UPDATED
    row, _ = stores.applications.set_stage(new_job(job), stage, today)
    return row, base.CREATED


def revert_applying(stores, url):
    """A session that ended without a submission: Applying goes back to Kit ready (the kit is still there).
    Only from Applying. Returns 'updated' | 'unchanged'."""
    current = stores.applications.get(url)
    if not current or current['stage'] != 'Applying':
        return base.UNCHANGED
    stores.applications.update(current['id'], {'stage': 'Kit ready'})
    return UPDATED


def revert_unsubmitted(stores, url):
    """The owner says an Applied was wrong (nothing was submitted): back to Applying, Applied on cleared. A stage
    the employer's side produced is left alone. Returns (outcome, record): 'updated' | 'unchanged' | 'past'."""
    current = stores.applications.get(url)
    if not current:
        return base.UNCHANGED, None
    if current['stage'] in EMPLOYER_STAGES:
        return PAST, current
    if current['stage'] != 'Applied':
        return base.UNCHANGED, current
    return UPDATED, stores.applications.update(current['id'], {'stage': 'Applying', 'applied_on': ''})


def existing_event(stores, app, kind, *, source_id='', interview_at='', at=None):
    """The event this one would repeat, or None when it is genuinely new: the same message (source_id) on any job; else
    an outcome of the same kind, the same interview (by its time, whenever the message came), or within a day. The
    rule itself is repeat_of (src/notion/ledger_events_util.py), the one copy the Notion tracker path asks too."""
    from ..notion.ledger import OUTCOME_STAGES  # local: the ledger module is heavy and imports the Notion client
    from ..notion.ledger_events_util import repeat_of
    by_source = stores.events.list(source_id=source_id) if source_id else ()
    return repeat_of(stores.events.list(app_id=app['id']), kind, OUTCOME_STAGES, source_id=source_id,
                     interview_at=interview_at, at=at, by_source=by_source)


def add_event(stores, app, kind, source, *, at=None, note='', source_id='', interview_at='', changes=None):
    """One outcome event of a job (`app`: its record), unless it repeats one already there (existing_event): then that
    one, not a second. Returns (event, existing). An Applied with no time takes the job's applied_on; an impossible
    interview time is never stored (plausible_interview). What src/notion/ledger.py add_event did for Notion alone."""
    from datetime import datetime, timezone
    from ..notion.ledger_events_util import plausible_interview
    interview_at = plausible_interview(interview_at, at)
    if not at and kind == 'Applied':
        at = app.get('applied_on') or ''
    at = at or datetime.now(timezone.utc).isoformat(timespec='seconds')
    found = existing_event(stores, app, kind, source_id=source_id, interview_at=interview_at, at=at)
    if found:
        return found, True
    if interview_at and changes is None:
        changes = {'fields': {}}  # the Changes JSON an interview's event has always had beside its time
    fields = {k: v for k, v in (('note', note), ('source_id', source_id), ('interview_at', interview_at),
                                ('changes', changes)) if v}
    return stores.events.add(app['id'], kind, at, source=source, **fields), False
