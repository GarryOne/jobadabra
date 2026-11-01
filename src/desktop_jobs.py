"""The desktop app's job list and posting: stage_status, jobs(), posting(), store_posting() (a pure move out of desktop.py).

Guarded by tests/test_desktop.py, tests/test_desktop_notion_list.py, tests/test_refresh_batch.py, tests/test_places_strict.py.
"""
import sqlite3
from datetime import datetime, timedelta, timezone

from . import digest, store
from .ai import enrich, provenance, score
from .notion.client import job_code

# Notion Applications Stage -> the app's status. With Notion connected the Stage is the only source of truth;
# the local applications.status column is a cache refreshed from it on every list.
def stage_status(stage):
    if not stage or stage == 'Kit ready':
        return 'unreviewed'
    if stage in ('Saved', 'Recruiter lead'):  # a recruiter's pitch you haven't answered yet: worth a look, not applied
        return 'saved'
    if stage in ('Dismissed', 'Closed'):
        return 'dismissed'
    return 'applied'  # Applying, Applied and everything after it (replies, interviews, rejection, offer)


NOT_ELIGIBLE = '⛔ Not eligible: '
GONE = ('Not seen', 'Closed')  # Job Matches statuses of postings no longer listed
# Applications stages that don't keep a gone posting in the list: not applied yet (owner, 7 Oct 2026: a refresh removes jobs that are at most
# saved or have a prepared kit; applied, interviewing and the rest stay).
NOT_YET = ('', 'Saved', 'Kit ready')


def skills_of(value):
    """The skills the AI read from a posting, as a list: a '; '-joined store column or the facts' own list, distinct, at most 8."""
    items = value.split(';') if isinstance(value, str) else (value or [])
    return list(dict.fromkeys(str(item).strip() for item in items if str(item).strip()))[:8]


def blank_profile(profile, local=None, readable=True):
    """Whether fit scores are paused for want of a Profile (score.unfilled): the one test behind Strategy's and Jobs' "Your Profile is empty" notice (#2759).
    `local`: the Profile file on this Mac (paths.local_profile()), which wins when there is one. `profile`: the store's Profile text, or None when it
    could not be read; `readable` False when no store holds it (Notion not connected): nothing is said then."""
    if local:
        return score.unfilled(local)
    return score.unfilled(profile) if readable and profile is not None else False


def _kit(stage, step):
    return stage == 'Kit ready' or step.startswith(('📝 Kit ready', NOT_ELIGIBLE))


_place_unclear = digest.place_unclear   # one rule for the Jobs list and the digest


def jobs(db, limit=200, stages=None, notion=False, notion_jobs=None, kit_inputs=None, hide_unscored=False):
    """The Jobs list, best fit first (unscored after scored, then the rule-based rank).

    notion_jobs (Tracker.notion_jobs): the list itself, from Notion (the source of truth), with Notion's fields only;
    the cache is kept in step with it, and adds only jobs a search found but couldn't write to Notion yet (marked
    unsynced). Without it (Notion unreachable, or not connected) the list comes from the cache, marked stale.
    stages: job URL -> (Stage, Next step, page URL), for the cache-only list."""
    stages = stages or {}
    waiting = 0
    candidates, blocked = digest.eligible_jobs(db)
    fits = score.load(db)
    facts = enrich.load(db)   # the AI's reading of each posting: the skills shown as tags under a job
    local = {(job.get('url') or '').strip(): job for job in candidates}
    # A link you added stays in the list even when a crawl would have filtered that company or that wording out.
    asked = {(job.get('url') or '').strip() for job in candidates + blocked if (job.get('notes') or '') == 'imported'}
    hidden = {(job.get('url') or '').strip() for job in blocked} - asked
    # Deleted here (delete_job): left out even while Notion's query still returns its trashed page (it lags; the totals settled 3 refreshes later).
    hidden |= _deleted_urls(db)
    # Closed on this Mac (gone from its site, or outside your places) while its Notion row still says Open: Notion is told at the end of the
    # refresh; the list leaves it out now, so the count drops as the refresh works (owner, 7 Oct 2026). A job you acted on stays (NOT_YET).
    try:
        closed_here = {(row[0] or '').strip() for row in db.execute("SELECT url FROM jobs WHERE state IN ('unmatched', 'expired', 'closed')")}
    except sqlite3.Error:   # a test's bare database
        closed_here = set()
    rows = []

    def row(job, fit, reason, status, stage, step, page, **extra):
        return {'id': job.get('id'), 'code': job_code(job['url']) if job.get('url') else '',
                'title': job.get('title') or '', 'company': job.get('company') or '', 'location': job.get('location') or '',
                'work_mode': job.get('work_mode') or '', 'url': job.get('url') or '',
                'posted_at': job.get('posted_at') or '', 'first_seen_at': job.get('first_seen_at') or '',
                'status': status, 'fit': fit, 'reason': reason or '', 'skills': skills_of(extra.pop('technologies', '') or (facts.get(job.get('id')) or {}).get('technologies')), 'rank': digest.rank_score(job) if job.get('id') else 0,
                'notion_url': page or '',  # the job's Applications page: kit, verdict, notes
                'stage': stage or '',  # the Applications Stage (Applied, Interviewing, Rejected…): the app's application counters
                # A kit writes Next step (Kit ready / Not eligible); the stage can stay Saved if the job was starred first.
                'kit': _kit(stage, step or ''),
                'ineligible': step[len(NOT_ELIGIBLE):] if (step or '').startswith(NOT_ELIGIBLE) else '', **extra}

    if notion_jobs is not None:
        seen = set()
        for item in notion_jobs:
            url, stage = item['url'], item.get('stage')
            seen.add(url)
            if url in hidden or (digest.company_excluded(item) and url not in asked) or (
                    (item.get('match_status') in GONE or url in closed_here) and (stage or '') in NOT_YET):
                continue
            status = stage_status(stage) if stage else {'Applied': 'applied', 'Dismissed': 'dismissed'}.get(item.get('match_status'), 'unreviewed')
            cached = local.get(url)
            if cached and status != (cached.get('application_status') or 'unreviewed'):  # keep the cache in step
                store.set_application_status(db, cached['id'], status)
            # Only Notion's fields: a field the list needs is a Notion column (config/notion_schema.json), never cache-only.
            job = {'url': url, 'title': item.get('title'), 'company': item.get('company'), 'location': item.get('location'),
                   'work_mode': item.get('work_mode'), 'first_seen_at': item.get('first_seen', '')}
            # A kit's inputs vs today's: current, earlier (drafted before the CV, Profile or answers changed), unknown.
            kit_state = provenance.kit_state(item.get('kit_inputs'), kit_inputs) if _kit(stage, item.get('next_step') or '') else ''
            rows.append(row(job, item.get('fit'), item.get('reason'), status, stage, item.get('next_step'), item.get('notion_url'),
                            rejection=item.get('rejection') or '', rejection_lesson=item.get('rejection_lesson') or '',
                            feedback_status=item.get('feedback_status') or '', employer_feedback=item.get('employer_feedback') or '',
                            page_id=item.get('page_id') or '', fit_detail=item.get('fit_detail') or None, technologies=item.get('technologies') or '',
                            kit_state=kit_state, next_interview=item.get('next_interview') or '',
                            # Outbound or inbound (desktop/renderer/origin.js), and what the "In conversation" rows show.
                            origin=item.get('origin') or '', source=item.get('source') or '', notes=item.get('notes') or '',
                            applied_on=item.get('applied_on') or '',
                            via=item.get('via') or '', next_step=item.get('next_step') or ''))
        for url, job in local.items():  # found by a search, not in Notion yet (its sync failed): shown, marked
            if url and url not in seen:
                fit = fits.get(job['id'])
                # Found, not read and scored yet: a refresh takes them a batch at a time (src/daily.py), so they wait, counted, not listed as
                # matches (owner, 7 Oct 2026: half the list showed "–"). Without an AI nothing would ever score them: then they are listed.
                unclear = not fit and _place_unclear(job)
                if hide_unscored and not fit and not unclear and (job.get('application_status') or 'unreviewed') == 'unreviewed' and (job.get('notes') or '') != 'imported':
                    waiting += 1
                    continue
                rows.append(row(job, fit.get('score') if fit else None, (fit.get('summary') or fit.get('reason')) if fit else '',
                                job.get('application_status') or 'unreviewed', None, '', '', unsynced=True, fit_detail=_fit_detail(fit),
                                place_unclear=unclear))
    else:
        def notion_row(job):  # (Stage, Next step, Notion page URL); tests may pass plain stages
            value = stages.get((job.get('url') or '').strip(), (None, '', ''))
            return (tuple(value) + ('', ''))[:3] if isinstance(value, tuple) else (value, '', '')
        for job in candidates:
            fit = fits.get(job['id'])
            stage, step, page = notion_row(job)
            if notion:  # Notion wins; keep the local cache in step
                truth = stage_status(stage)
                if truth != (job.get('application_status') or 'unreviewed'):
                    store.set_application_status(db, job['id'], truth)
                    job = {**job, 'application_status': truth}
            rows.append(row(job, fit.get('score') if fit else None, (fit.get('summary') or fit.get('reason')) if fit else '',
                            job.get('application_status') or 'unreviewed', stage, step, page, fit_detail=_fit_detail(fit),
                            place_unclear=not fit and _place_unclear(job)))
    rows.sort(key=lambda r: (r['fit'] is not None, r['fit'] or 0, r['rank']), reverse=True)
    # Every application stays in the list, however low its fit, so the app's application counters are complete.
    kept = rows[:limit] + [r for r in rows[limit:] if r['status'] == 'applied']
    # New this week among the rows not sent: the app adds them to its own count, so a cut list's counts stay whole (7 Oct 2026: "200 new
    # this week" of 1,335). Rows past `limit` are unscored or low-fit job matches, never applications.
    week = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()
    return {'jobs': kept, 'total': len(rows), 'filtered': len(blocked), 'waiting': waiting,
            'review_beyond': sum(1 for r in rows[limit:] if r['status'] == 'unreviewed'),   # the Jobs badge counts them too
            # Scored / high fit among the rows not loaded: the app's counts (renderer/jobs-view.js jobCounts) stay whole on a cut list.
            'scored_beyond': sum(1 for r in rows[limit:] if r['status'] != 'applied' and r['fit'] is not None),
            'high_beyond': sum(1 for r in rows[limit:] if r['status'] != 'applied' and (r['fit'] or 0) >= 70),
            'week_beyond': sum(1 for r in rows[limit:] if r['status'] != 'applied' and (r.get('first_seen_at') or '')[:10] >= week)}


def posting(db, code):
    """The job whose code (job_code of its URL) is given, with the posting text stored by the crawl."""
    rows = db.execute("""SELECT jobs.title, jobs.url, jobs.location, jobs.description, jobs.posted_at, jobs.first_seen_at,
                                companies.name company, sources.name source, sources.kind source_kind
                          FROM jobs JOIN companies ON companies.id=jobs.company_id LEFT JOIN sources ON sources.id=jobs.source_id
                          WHERE jobs.url IS NOT NULL""").fetchall()
    for row in rows:
        if job_code(row['url']) == code:
            return {'ok': True, 'code': code, 'title': row['title'], 'company': row['company'], 'url': row['url'],
                    'location': row['location'] or '', 'description': row['description'] or '',
                    # where and when: the Description tab's facts (the source and its kind, when the search first found it, when it was posted)
                    'source': row['source'] or '', 'source_kind': row['source_kind'] or '',
                    'first_seen_at': row['first_seen_at'] or '', 'posted_at': row['posted_at'] or ''}
    return {'ok': False, 'error': 'job not found'}


NO_POSTING = 'This job has no description yet. Add it first (⋯ → Log job activity, or paste it in the job page), then tailor.'
MIN_POSTING = 200  # characters that really describe the role (prep.about_role): a Teams invite or a greeting is not a posting


def store_posting(stores, code):
    """A job kept only in the store, not in the crawl (a recruiter's message, a LinkedIn chat pasted as screenshots, Add
    details): its posting is the description saved with it (inbox.py / prep.py), read by prep.role_text from the job's
    sections. {'ok': False, 'error'} says what is missing."""
    from .ai import prep
    record = next((app for app in stores.applications.list() if app['url'] and job_code(app['url']) == code), None)
    if not record:
        return {'ok': False, 'error': 'job not found'}
    text = prep.role_text(stores, record)
    if prep.about_role(text) < MIN_POSTING:
        return {'ok': False, 'error': NO_POSTING}
    return {'ok': True, 'code': code, 'title': record['title'], 'company': record['company'] or record['via'] or '',
            'url': record['url'], 'location': record['location'] or '', 'description': text}

def _deleted_urls(db):
    """Jobs deleted on this Mac (delete_job); none in a store without its tables yet."""
    try:
        return {row[0] for row in db.execute("SELECT url FROM jobs WHERE state='deleted'")}
    except sqlite3.OperationalError:
        return set()


def _fit_detail(fit):
    """A local score's parts, strengths and gaps, in the shape Notion's Job Matches row gives (the score card)."""
    if not fit:
        return None
    joined = lambda items: '; '.join(items) if isinstance(items, list) else (items or '')
    return {'strengths': joined(fit.get('strengths')), 'gaps': joined(fit.get('gaps')),
            'parts': {key: (fit.get('components') or {}).get(key) for key in ('role_fit', 'location', 'compensation', 'growth', 'risk')}}
