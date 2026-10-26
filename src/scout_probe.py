"""Source scout, probing: which candidates are due (`next_batch`), whether a feed belongs to the company (`belongs_to`, `job_hosts`),
finding its feed (`find_feed`), and judging it (`quality`, `relevant_roles`, `job_places`). The judges are fingerprinted into READERS
(src/sources/readers.py): a change to them wakes the employers judged by older readers.
Tests: tests/test_scout.py, tests/test_careers.py, tests/test_unread_systems.py, tests/test_jobsch_employer.py.
"""

import re
import urllib.parse
from collections import Counter
from datetime import timedelta
from .paths import keyword_regex, place_regex
from .sources import ats, careers, feeds
from . import scout_core
from .scout_core import SMALL_GUESS, _SEARCH, ensure_tables, now


# The code that decides whether an employer has a readable job feed: when it changes (a release with better readers), the employers an older
# version judged "no feed", "low" or "watch" are looked at again instead of waiting out their 21 or 90 days (owner, 6 Oct 2026: the employers
# probed while the readers were wrong stayed skipped). A fingerprint of that code only (src/sources/readers.py): the reader modules and the
# functions here that judge a site, without comments, docstrings or print lines, so a wording change elsewhere in this file wakes no one.
READER_FILES = ('sources/ats.py', 'sources/careers.py', 'sources/web_search.py', 'sources/render.py', 'scout_probe.py')
JUDGES = ('belongs_to', 'job_hosts', 'find_feed', 'counted_jobs', 'quality', 'relevant_roles', 'job_places')


def readers_version():
    from .sources.readers import code_fingerprint
    return code_fingerprint(READER_FILES, only={'scout_probe.py': JUDGES})


READERS = readers_version()


def next_batch(db, size, skip=()):
    """The next candidates to probe, best first; a search outside IT skips those a tech-only list queued earlier (or before its roles changed).
    Names never checked come first, all of them; an employer checked before waits at the end, even when newer readers would judge it again
    (owner, 7 Oct 2026: a run of 92 checked 36 again and 4 new names while 548 waited)."""
    ensure_tables(db)   # a table from before 6 Oct 2026 lacks checked_with, and run() may skip harvest
    stamp = now().isoformat(timespec='seconds')
    where, params = skipping(skip)
    from . import scout_queue   # names never checked first, by their source's yield (src/scout_queue.py), then re-checks
    rows = [dict(row) for row in db.execute(f"""SELECT * FROM scout_candidates
        WHERE (status = 'pending' OR (status = 'manual' AND checked_at IS NULL)
           OR (status IN ('low', 'none', 'watch') AND (next_check <= ? OR COALESCE(checked_with, '') != ?))) {where}""",
        (stamp, READERS, *params))]
    return scout_queue.ordered(rows, scout_queue.yields(db), READERS)[:size]


def skipping(skip):
    """SQL (and its parameters) that leaves out the candidates whose origin starts with one of `skip`."""
    if not skip:
        return '', []
    return 'AND NOT (' + ' OR '.join('origin LIKE ?' for _ in skip) + ')', [origin + '%' for origin in skip]


STACK = keyword_regex(_SEARCH['quality_stack_keywords'])
SWISS_OR_ZURICH = place_regex([*_SEARCH['locations']['top_tier'], *_SEARCH['locations']['country_wide']])   # the user's own places only

STOP_WORDS = {'gmbh', 'sagl', 'ltd', 'inc', 'llc', 'plc', 'the', 'and', 'group', 'holding', 'switzerland', 'schweiz', 'suisse', 'international', 'solutions', 'services', 'systems', 'technologies', 'technology', 'software'}


def belongs_to(candidate, slug, jobs, exact):
    """A guessed feed is the company's: its slug is the whole name or the website's domain (`exact`), or its jobs name the rest of the
    company's name. "Stellar Alpina" must not take the feed `stellar` of another company; `Puzzle ITC` may take `puzzle` if its jobs say ITC."""
    if exact:
        return True
    words = [w for w in re.findall(r'[a-z0-9]+', candidate['name'].lower()) if len(w) >= 3 and w not in STOP_WORDS and w != slug.lower()]
    if not words:
        return False
    blob = ' '.join(f"{j.get('title', '')} {j.get('location', '')} {j.get('url', '')} {(j.get('description') or '')[:400]}" for j in jobs[:40]).lower()
    return any(word in blob for word in words)


JOB_SUBDOMAINS = ('jobs', 'careers', 'career', 'karriere')


def job_hosts(website):
    """The usual addresses of a company's job site (jobs.coop.ch, careers.manor.ch), from its website: tried when its home page links to no
    job system (6 Oct 2026: coop.ch led nowhere, jobs.coop.ch is SuccessFactors with 3,142 jobs)."""
    host = (urllib.parse.urlsplit(website if '//' in website else f'https://{website}').hostname or '').lower().removeprefix('www.')
    if not host or host.split('.')[0] in JOB_SUBDOMAINS:
        return []
    return [f'https://{sub}.{host}' for sub in JOB_SUBDOMAINS]


def find_feed(candidate, probe=ats.probe, discover=careers.discover, note=None, search=None, jobsch_lookup=None):
    """(ats, slug, jobs) for the candidate's public feed, or None. In order: the address already known; slugs guessed from the name and
    from the website's domain on the common job systems; then the website itself (an embedded job system, or a careers page with job data)."""
    if candidate.get('ats') and candidate.get('slug'):
        jobs = probe(candidate['ats'], candidate['slug'])
        if jobs:
            return candidate['ats'], candidate['slug'], jobs
    jobs_site = candidate.get('careers') or ''
    if jobs_site and careers.own_site(jobs_site) and candidate.get('status') != 'manual':   # its own job site, when known: read first
        page = discover(jobs_site)
        if page and (page.get('jobs') or page.get('empty')):
            return page['ats'], page['slug'], page.get('jobs') or []
        jobs = probe(page['ats'], page['slug']) if page else None
        if jobs:
            return page['ats'], page['slug'], jobs
    website = candidate.get('website') or ''
    website = website if careers.own_site(website) else ''   # a job board or network is not the employer's address
    names = ats.slug_guesses(candidate['name'])
    if website:
        names = ats.name_slugs(candidate['name'])   # the first word alone ("Data" for Data Purpose AG) is a guess; with an address to go by it is left out
    exact_slugs = {*ats.name_slugs(candidate['name']), *ats.domain_guesses(website)}
    guessed = None
    for slug in list(dict.fromkeys([*names, *ats.domain_guesses(website)]))[:6]:
        for system in ats.GUESSABLE:
            jobs = probe(system, slug)
            if jobs and belongs_to(candidate, slug, jobs, slug in exact_slugs):
                guessed = (system, slug, jobs)
                break
        if guessed:
            break
    # A guess with a handful of jobs may be another company of that name (Coop Suisse Romande took JOIN's "coop", 1 job, while its own
    # careers site runs SuccessFactors with 3,142: 6 Oct 2026). With the company's address known, its own careers page decides then.
    if guessed and (not website or len(guessed[2]) >= SMALL_GUESS):
        return guessed
    page = discover(website) if website else None
    for host in [] if page or not website else job_hosts(website):   # the home page led nowhere: the usual job site of that domain
        page = discover(host)
        if page:
            break
    # Nothing by name, website or the usual job hosts: the employer's page on jobs.ch, where Swiss employers post (6 Oct 2026: Manor, 287 jobs,
    # and its job site careers.manor.ch; coop.ch refuses automated visitors). Its own job site first, else its jobs.ch listings as its feed.
    if not page and not guessed and jobsch_lookup:
        try:
            board = jobsch_lookup(candidate['name'])
        except Exception:  # noqa: BLE001 — jobs.ch not answering leaves the other ways
            board = None
        if board:
            own = discover(board['site']) if board.get('site') and careers.own_site(board['site']) else None
            own_jobs = own and (own.get('jobs') or (own.get('ats') != 'careers' and probe(own['ats'], own['slug'])))
            if own_jobs:
                return own['ats'], own['slug'], own_jobs
            listed = probe('jobsch', board['slug'])
            if listed:
                return 'jobsch', board['slug'], listed
    # Nothing by name, website or the usual job hosts: a web search for "<company> jobs", as a person would (web_search.py), its results
    # read like any careers page. Once per employer per recheck period: a "none" is not looked at again for RECHECK_DAYS['none'].
    for url in [] if page or guessed or not search else search(candidate['name']):
        candidate.setdefault('found_site', url)   # the search's own find is kept even when it cannot be read (Hublot answers 403): opened by the person
        page = discover(url)
        if page and (page.get('jobs') or page.get('ats') != 'careers'):
            break
        page = None
    if page:
        if page.get('empty'):
            return guessed or (page['ats'], page['slug'], [])   # a careers page with no open jobs right now: watched, not dropped
        jobs = page.get('jobs') or probe(page['ats'], page['slug'])
        if jobs and (not guessed or len(jobs) > len(guessed[2])):
            return page['ats'], page['slug'], jobs
        if guessed:
            return guessed
        if note and page.get('ats') != 'careers':
            # A job system the page names that gave back nothing: no adapter, or one that does not fit this company's pages. Said out loud, because a
            # silent None looked like "this employer has no jobs" (Ringier on Umantis, 5 Oct 2026).
            note(page['ats'], page['slug'], 'no adapter' if page['ats'] not in ats.FETCHERS else 'read no jobs')
    return None


def counted_jobs(jobs):
    """The jobs that count for the judges below. The central scout: every job (it serves every role across Europe; owner, 19 Oct 2026: its
    example search's data-analyst titles judged care homes and hauliers "low"). An install's own scout: jobs whose title the AI judged one of the
    search's kinds of work (role_kinds, job-title-kind: shared and kept, mostly answered already), or for a search no kind fits, whose title the
    AI's title sort kept; a title the AI has not judged (past its cap) counts for nothing, and only with no AI at all do the search's role words
    decide (owner, 26 Oct 2026: "The AI decides"; audit PR 5: a pilot search's words missed "Erster Offizier" and counted "Pilot Project Manager")."""
    jobs = [job for job in jobs if job.get('title')]
    if scout_core.CENTRAL:
        return jobs
    from . import role_kinds
    from .ai import engine
    if not engine.ready():
        return [job for job in jobs if feeds.TITLES.search(job['title'])]
    kinds = role_kinds.of_search(_SEARCH)
    if not kinds or role_kinds.UNKNOWN in kinds:
        feeds.triage(jobs)
        return [job for job in jobs if feeds.judged_title(job['title'])]
    judged = role_kinds.judged([job['title'] for job in jobs], 'job-title-kind')
    return [job for job in jobs if judged.get(str(job['title']).strip()) in kinds]


def quality(jobs):
    """Deterministic 0-100 score of how useful a feed is for this search, with its evidence."""
    relevant = counted_jobs(jobs)
    preferred = [j for j in relevant if feeds.wanted_location(j)]
    swiss = [j for j in preferred if SWISS_OR_ZURICH.search(j['location'] or '')]
    stack = [j for j in relevant if STACK.search(j.get('description') or '')]
    cutoff = (now() - timedelta(days=90)).date().isoformat()
    fresh = [j for j in relevant if (j.get('date_posted') or '')[:10] >= cutoff] if relevant else []
    dated = [j for j in relevant if j.get('date_posted')]
    fresh_share = (len(fresh) / len(dated)) if dated else 0.5
    salary = any(j.get('salary') for j in preferred)
    # Up to 20 for matching roles anywhere, 40 for roles in preferred places, 10 each for Switzerland,
    # stack overlap with the CV, freshness and published salaries.
    score = (min(20, 4 * len(relevant)) + min(40, 10 * len(preferred)) + (10 if swiss else 0)
             + round(10 * (len(stack) / len(relevant) if relevant else 0)) + round(10 * fresh_share if relevant else 0)
             + (10 if salary else 0))
    places = sorted({(j['location'] or '').split(',')[0].strip() for j in preferred if j['location']})[:6]
    return min(100, score), {'jobs': len(jobs), 'relevant': len(relevant), 'preferred': len(preferred),
                             'swiss': len(swiss), 'stack_share': round(len(stack) / len(relevant), 2) if relevant else 0,
                             'salary_published': salary, 'places': places}


def board_url(system, slug):
    return {
        'greenhouse': f'https://job-boards.greenhouse.io/{slug}', 'lever': f'https://jobs.lever.co/{slug}',
        'ashby': f'https://jobs.ashbyhq.com/{slug}', 'workable': f'https://apply.workable.com/{slug}',
        'recruitee': f'https://{slug}.recruitee.com', 'personio': f'https://{slug}.jobs.personio.de',
        'smartrecruiters': f'https://jobs.smartrecruiters.com/{slug}', 'amazon': 'https://www.amazon.jobs',
        'netflix': 'https://explore.jobs.netflix.net/careers', 'teamtailor': f'https://{slug}.teamtailor.com/jobs',
        'join': f'https://join.com/companies/{slug}', 'workday': workday_url(slug) if system == 'workday' else '', 'umantis': f'https://{slug}.umantis.com/Jobs/All',
        'successfactors': f'https://{slug}/search/', 'oracle': oracle_url(slug) if system == 'oracle' else '',
        'phenom': f'https://{slug}/', 'eightfold': f'https://{slug}/',
        'careers': careers.decode(slug) if system == 'careers' else '', 'jobsch': f'https://www.jobs.ch/en/companies/{slug}/',
        'visit': slug}[system]   # a page read through the user's own visit: its address is the slug


def oracle_url(slug):
    tenant, region, site = slug.split('.', 2)
    return f'https://{tenant}.fa.{region}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/{site}'


def workday_url(slug):
    tenant, cluster, site = slug.split('.', 2)
    return f'https://{tenant}.{cluster}.myworkdayjobs.com/{site}'


def relevant_roles(jobs):
    """A feed's open roles that count (counted_jobs: every role for the central scout, the search's kinds for an install's), each title once
    (the same role listed for several cities is one role): the honest number for the website, since `jobs` counts every posting."""
    return len({str(j['title']).strip().lower() for j in counted_jobs(jobs)})


def job_places(jobs, limit=40):
    """Where a feed has matching roles: its most common location strings, so a client can skip feeds with none in
    its own places without downloading them."""
    counts = Counter((j.get('location') or '').strip()[:60] for j in counted_jobs(jobs))
    return [place for place, _ in counts.most_common(limit + 1) if place][:limit]
