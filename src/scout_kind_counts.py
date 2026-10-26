"""Source scout, kind counts by country: how many of a feed's jobs in each country are of each kind of work (the index's `kind_counts`), so an
install reads an employer only when its jobs in the person's countries are their kind (owner, 26 Oct 2026, audit PR 4).
A job's kind is the AI's answer for its title (src/role_kinds.py, job-title-kind); its country the AI's answer for its place (src/geo.py: this
machine's cache, then what 3+ installs' own AIs shared through the meanings pack, then the scout's AI within src/ai/decide.py's per-run cap; owner:
"using any user's machine/installation ... but also using the central scout"). A job not judged on both is left out, never guessed; remote and
unknown places count nowhere (local jobs only). A big employer is judged on a sample of SAMPLE jobs and its counts scaled to all of them
(owner, 26 Oct 2026: "Higher cap + sample"; judging half of thousands of titles left 2,508 of 2,517 employers uncounted). Tests: tests/test_kind_counts.py."""
import random
import threading

from . import geo, pool_tags, role_kinds
from .ai import decide

LOCK = threading.Lock()
SAMPLE = 60   # jobs judged per employer: a share of 60 says what it hires for, and where


def places(locations):
    """{normalized place: geo entry} for these job places: what is known, plus the AI's answers for the rest while the run's calls last."""
    known = geo.resolve(locations, ask=False)
    todo = [k for k in dict.fromkeys(geo.norm(place) for place in locations if place) if k and k not in known]
    from .ai import engine
    if not todo or not engine.ready():
        return known
    with LOCK:   # feeds are checked side by side: one share of the cap each
        calls = max(0, min(decide.limit() - decide._calls['n'], -(-len(todo) // geo.BATCH)))
        decide._calls['n'] += calls
    if calls:
        known.update(geo.resolve(todo[:calls * geo.BATCH]))
    return known


def sample(jobs):
    """Up to SAMPLE of these jobs, drawn at random but the same each run for the same count (kept answers are reused; even steps would
    see only one kind of a list that alternates), in list order; every job of a smaller employer."""
    if len(jobs) <= SAMPLE:
        return jobs
    return [jobs[i] for i in sorted(random.Random(len(jobs)).sample(range(len(jobs)), SAMPLE))]


def of_jobs(jobs):
    """(kind mix, kind counts by country) of an employer's jobs, both from one sample (src/scout_index.py)."""
    jobs = [job for job in jobs if str(job.get('title') or '').strip()]
    return role_kinds.mix([job['title'] for job in sample(jobs)]), kind_counts(jobs)


def kind_counts(jobs):
    """{country id: {kind: jobs}} of these jobs (from a sample, scaled to all), or None until enough of the sample is judged (role_kinds.mix's rule)."""
    jobs = [job for job in jobs if str(job.get('title') or '').strip()]
    total, jobs = len(jobs), sample(jobs)
    kinds = role_kinds.judged([job['title'] for job in jobs], 'job-title-kind')
    where = places([job.get('location') or '' for job in jobs])
    counts, judged = {}, 0
    for job in jobs:
        kind, entry = kinds.get(str(job['title']).strip()), where.get(geo.norm(job.get('location') or ''))
        if kind not in role_kinds.KINDS or not entry:
            continue
        judged += 1
        country = str(entry.get('cc') or '').lower()
        if entry['kind'] in ('remote', 'unknown') or country not in pool_tags.COUNTRIES:
            continue
        counts.setdefault(country, {})
        counts[country][kind] = counts[country].get(kind, 0) + 1
    if not judged or judged < min(role_kinds.MIN_TITLES, len(jobs)) or judged < role_kinds.MIN_JUDGED * len(jobs):
        return None
    scale = total / len(jobs)
    return {country: {kind: max(1, round(n * scale)) for kind, n in by_kind.items()} for country, by_kind in counts.items()} or None
