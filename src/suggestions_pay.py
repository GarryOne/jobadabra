"""Pay holding back good matches, as a Focus Suggestion (spec docs/superpowers/specs/2026-10-28-insights-with-actions-design.md, PR 3, #15).

Your minimum salary is a line of your Profile that the scorer compares a posting's stated pay with (src/ai/score.py): no number is filtered
by it. When jobs that match your role and place (80+) score under the app's High fit (70) and their Compensation part is the lowest of their
parts, the pay is what pulls them down: the row names them, opens them in Jobs, and opens the minimum for you to change. Counts of saved
scores only: no AI call. Guarded by tests/test_suggestions_pay.py.
"""
import os
import sys

from .suggestions import _entry

KIND = 'pay'
MATCH = 80      # role fit and location both this high: a match (the spec's "scored 80+")
HIGH_FIT = 70   # the app's High fit (desktop/renderer/skill-entries.js TARGET_FIT): below it a job is not offered as a strong one
MIN_JOBS = 3    # Why (insights PR 3, 28 Oct 2026): one or two jobs is a coincidence, not a minimum that costs you matches
SHOWN = 3       # jobs named in the evidence


def held_back(scored, stages=None):
    """The jobs (dicts with title, company, url) whose pay alone keeps them under High fit. scored: [(job, fit)]; stages: {url: stage} of
    jobs you acted on, which are left out."""
    stages = stages or {}
    found = []
    for job, fit in scored:
        parts = (fit or {}).get('components') or {}
        number = lambda key: parts.get(key) if isinstance(parts.get(key), (int, float)) and not isinstance(parts.get(key), bool) else None
        role, place, pay, growth = number('role_fit'), number('location'), number('compensation'), number('growth')
        if role is None or place is None or pay is None or stages.get((job.get('url') or '').strip()):
            continue
        if (fit.get('score') or 0) < HIGH_FIT and role >= MATCH and place >= MATCH and pay < min(role, place, 101 if growth is None else growth):
            found.append(job)
    return found


def entry(jobs):
    """The pay row: Show these N jobs · Edit minimum salary; None under MIN_JOBS."""
    if len(jobs) < MIN_JOBS:
        return None
    count = len(jobs)
    names = [f"{job.get('title') or 'A job'} at {job.get('company') or 'an employer'}" for job in jobs[:SHOWN]]
    return _entry(KIND, home='strategy', topic='search', source='Search strategy', key='pay:minimum',
                  title=f'{count} jobs match you but their pay is under your minimum',
                  detail='They fit your role and place (80+), and pay is what keeps them under High fit (70).',
                  evidence=[*names, f'and {count - SHOWN} more' if count > SHOWN else ''],
                  actions=[{'label': f'Show these {count} jobs', 'do': 'show_jobs', 'urls': [job['url'] for job in jobs if job.get('url')]},
                           {'label': 'Edit minimum salary', 'do': 'edit_minimum'}])


def now(rows):
    """Focus's pay entries from the jobs cache and its saved scores; [] when there is no cache yet or it can't be read (Focus never fails on
    them). rows: the applications already read, whose jobs are left out."""
    from . import digest, store
    from .ai import score
    from .paths import jobs_db
    path = jobs_db()
    if not os.path.exists(path):
        return []
    try:
        with store.connect(path) as db:
            fits = score.load(db)
            candidates, _ = digest.eligible_jobs(db)
            stages = {r['url'].strip(): r.get('stage') for r in rows if r.get('url')}
            found = entry(held_back([(job, fits.get(job['id'])) for job in candidates if job['id'] in fits], stages))
            return [found] if found else []
    except Exception as error:  # noqa: BLE001 - said in the engine log, then no pay entry
        print(f'Warning: pay suggestion not read ({type(error).__name__}: {error})', file=sys.stderr)
        return []
